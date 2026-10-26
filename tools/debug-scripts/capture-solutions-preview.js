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
      page = list.find(x => x.type === 'page' && (x.url.includes('calendar.google.com') || x.url.includes('preview-solutions.html')));
      if (page) break;
    } catch (_) {}
  }

  if (!page) {
    console.error('Failed to connect to page');
    child.kill();
    process.exit(1);
  }

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

  const targetUrl = 'file:///' + path.resolve(__dirname, 'preview-solutions.html').replace(/\\/g, '/');
  console.log('Navigating to:', targetUrl);
  await send('Page.navigate', { url: targetUrl });

  // Wait 1.5s for render
  await new Promise(r => setTimeout(r, 1500));

  // Set viewport for clean rendering
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 980,
    deviceScaleFactor: 1,
    mobile: false
  });

  await new Promise(r => setTimeout(r, 500));

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'SOLUCIONES_COLOR_ASIGNATURA.png');
  fs.writeFileSync(outPath, Buffer.from(shot.data, 'base64'));
  console.log('Saved solutions screenshot to:', outPath);

  ws.close();
  child.kill();
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
