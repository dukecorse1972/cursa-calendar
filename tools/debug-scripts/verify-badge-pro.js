const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

async function main() {
  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Google Calendar.exe');
  const cwd = path.dirname(exePath);

  console.log('Spawning executable:', exePath);
  const child = spawn(exePath, [], {
    cwd,
    stdio: 'ignore',
    detached: false
  });

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

  if (!page) {
    console.error('Failed to connect to Google Calendar');
    child.kill();
    process.exit(1);
  }

  console.log('Connected to Google Calendar page:', page.title);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const pending = new Map();

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = id++;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
    }
  });

  await new Promise(r => ws.addEventListener('open', r));

  // Wait 2s for UI to stabilize and select EXÁMENES Y ENTREGAS
  await new Promise(r => setTimeout(r, 2000));

  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const tabs = Array.from(document.querySelectorAll('#gcal-tab-selector button'));
        const academicTab = tabs.find(b => b.textContent.includes('EXÁMENES') || b.textContent.includes('ENTREGAS'));
        if (academicTab) academicTab.click();

        // Find scrollable containers and scroll them
        document.querySelectorAll('*').forEach(el => {
          if (el.scrollHeight > el.clientHeight && el.clientHeight > 200) {
            el.scrollTop = 320;
          }
        });

        const chip = document.querySelector('[data-eventchip]');
        if (chip) chip.scrollIntoView({ block: 'center' });
      })()
    `
  });

  // Wait for Google Calendar to load chips over the network
  let chipCount = 0;
  for (let i = 0; i < 15; i++) {
    const checkRes = await send('Runtime.evaluate', {
      expression: `document.querySelectorAll('[data-eventchip]').length`,
      returnByValue: true
    });
    chipCount = checkRes.result?.value || 0;
    if (chipCount > 0) {
      console.log('Found chips count:', chipCount);
      break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Scroll chip into center
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chip = document.querySelector('[data-eventchip]');
        if (chip) chip.scrollIntoView({ block: 'center', behavior: 'instant' });
      })()
    `
  });

  await new Promise(r => setTimeout(r, 1500));

  // Inspect chips
  const inspectRes = await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chips = Array.from(document.querySelectorAll('[data-eventchip]'));
        return chips.map(c => {
          const els = Array.from(c.querySelectorAll('*')).map(el => ({
            tag: el.tagName,
            cls: el.className,
            bg: window.getComputedStyle(el).backgroundColor,
            display: window.getComputedStyle(el).display,
            visibility: window.getComputedStyle(el).visibility,
            text: el.childNodes.length === 1 && el.childNodes[0].nodeType === 3 ? el.textContent.trim() : ''
          })).filter(x => x.text || (x.bg && x.bg !== 'rgba(0, 0, 0, 0)'));
          return {
            chipBg: window.getComputedStyle(c).backgroundColor,
            els
          };
        });
      })()
    `,
    returnByValue: true
  });

  console.log('Chips structure:', JSON.stringify(inspectRes.result.value, null, 2));

  // Capture screenshot
  const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'VERIFIED_BADGE_PRO.png');
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved verification screenshot to', outPath);

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
