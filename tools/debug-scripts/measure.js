const fs = require('fs');

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('calendar.google.com'));

  if (!page) {
    console.error('Calendar page not found');
    process.exit(1);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const elements = Array.from(document.querySelectorAll('*')).filter(e => {
              const rect = e.getBoundingClientRect();
              return rect.top === 0 && rect.height > 40 && rect.width > 500;
            });
            return elements.map(e => {
              const r = e.getBoundingClientRect();
              return {
                tag: e.tagName,
                id: e.id,
                className: e.className,
                top: r.top,
                bottom: r.bottom,
                height: r.height
              };
            });
          })()`,
          returnByValue: true
        }
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) {
      console.log('TOP BANNERS:', data.result?.result?.value);
      process.exit(0);
    }
  };
}

main().catch(console.error);
