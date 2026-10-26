const fs = require('fs');
const path = require('path');
const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
fs.mkdirSync(outDir, { recursive: true });

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('calendar.google.com'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  const send = (method, params) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 100000);
    const handler = (event) => {
      const data = JSON.parse(event.data);
      if (data.id === id) {
        ws.removeEventListener('message', handler);
        resolve(data.result);
      }
    };
    ws.addEventListener('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.onopen = async () => {
    console.log('1. Reloading page with new bundle...');
    await send('Page.reload');
    await new Promise(r => setTimeout(r, 3500));

    // Verify Tab 1: CLASES (default on load)
    console.log('2. Verifying CLASES tab (initial state)...');
    const ssClases = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'VERIFIED_TAB_CLASES.png'), Buffer.from(ssClases.data, 'base64'));
    console.log('Saved VERIFIED_TAB_CLASES.png');

    // Click Tab 2: EXÁMENES Y ENTREGAS
    console.log('3. Clicking EXÁMENES Y ENTREGAS tab...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = document.getElementById('gcal-hdr-tab-entregas');
        if (tab) tab.click();
      })()`,
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 1200));

    const ssEntregas = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'VERIFIED_TAB_ENTREGAS.png'), Buffer.from(ssEntregas.data, 'base64'));
    console.log('Saved VERIFIED_TAB_ENTREGAS.png');

    // Click Tab 3: TODO
    console.log('4. Clicking TODO tab...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = document.getElementById('gcal-hdr-tab-todo');
        if (tab) tab.click();
      })()`,
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 1200));

    const ssTodo = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'VERIFIED_TAB_TODO.png'), Buffer.from(ssTodo.data, 'base64'));
    console.log('Saved VERIFIED_TAB_TODO.png');

    // Return back to CLASES
    console.log('5. Clicking back to CLASES tab...');
    await send('Runtime.evaluate', {
      expression: `(() => {
        const tab = document.getElementById('gcal-hdr-tab-clases');
        if (tab) tab.click();
      })()`,
      returnByValue: true
    });
    await new Promise(r => setTimeout(r, 1200));

    const ssFinal = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, 'VERIFIED_FINAL_CLASES.png'), Buffer.from(ssFinal.data, 'base64'));
    console.log('Saved VERIFIED_FINAL_CLASES.png');

    process.exit(0);
  };
}

main().catch(console.error);
