const fs = require('fs');
const path = require('path');

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
    console.log('Reloading page...');
    await send('Page.reload');

    console.log('Waiting 3.5 seconds for full initialization...');
    await new Promise(r => setTimeout(r, 3500));

    console.log('Taking screenshot...');
    const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, 'VERIFIED_VIEW.png');
    const ss = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(outPath, Buffer.from(ss.data, 'base64'));
    console.log('Done! Saved to', outPath);
    process.exit(0);
  };
}

main().catch(console.error);
