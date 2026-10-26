const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

async function main() {
  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Google Calendar.exe');
  const cwd = path.dirname(exePath);

  const child = spawn(exePath, [], { cwd, stdio: 'ignore', detached: false });

  let page = null;
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const list = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9222/json', (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
      });
      page = list.find(x => x.type === 'page' && x.url.includes('calendar.google.com'));
      if (page) break;
    } catch (_) {}
  }

  if (!page) process.exit(1);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const msgId = id++;
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === msgId) {
        ws.removeEventListener('message', onMsg);
        if (m.error) rej(m.error); else res(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  await new Promise(r => ws.addEventListener('open', r));

  await new Promise(r => setTimeout(r, 2000));

  // Select EXÁMENES Y ENTREGAS tab
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const tabs = Array.from(document.querySelectorAll('#gcal-tab-selector button'));
        const academicTab = tabs.find(b => b.textContent.includes('EXÁMENES') || b.textContent.includes('ENTREGAS'));
        if (academicTab) academicTab.click();
      })()
    `
  });

  // Navigate 3 weeks forward to reach the exam
  for (let i = 0; i < 3; i++) {
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const nextBtn = document.querySelector('button[aria-label*="siguiente" i], button[aria-label*="next" i]');
          if (nextBtn) nextBtn.click();
        })()
      `
    });
    await new Promise(r => setTimeout(r, 1000));
  }

  // Scroll chip into view
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chip = document.querySelector('[data-eventchip]');
        if (chip) chip.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()
    `
  });

  await new Promise(r => setTimeout(r, 1500));

  const chipDetails = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chips = Array.from(document.querySelectorAll('[data-eventchip]'));
        return chips.map(c => ({
          text: c.innerText.replace(/\\n/g, ' '),
          enhanced: c.getAttribute('data-gcal-enhanced'),
          containerBg: c.querySelector('.custom-academic-container')?.style.backgroundColor,
          containerBorder: c.querySelector('.custom-academic-container')?.style.border,
          containerBorderLeft: c.querySelector('.custom-academic-container')?.style.borderLeft,
          html: c.querySelector('.custom-academic-container')?.innerHTML
        }));
      })()
    `,
    returnByValue: true
  });

  console.log('Chip details in Week 3:', JSON.stringify(chipDetails.result.value, null, 2));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'VERIFIED_DYNAMIC_COLOR.png');
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved screenshot to:', outPath);

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch(console.error);
