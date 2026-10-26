const fs = require('fs');
const path = require('path');

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('calendar.google.com'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Page.captureScreenshot',
        params: { format: 'png' }
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) {
      const buffer = Buffer.from(data.result.data, 'base64');
      const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
      fs.mkdirSync(outDir, { recursive: true });
      const outPath = path.join(outDir, 'VERIFIED_VIEW.png');
      fs.writeFileSync(outPath, buffer);
      console.log('Screenshot saved to', outPath);
      process.exit(0);
    }
  };
}

main().catch(console.error);
