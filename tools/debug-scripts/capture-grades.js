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
    // 1. Click brand area to open dropdown, then click Calificaciones
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const trigger = document.getElementById('cursa-brand-logo-trigger') || 
                            Array.from(document.querySelectorAll('*')).find(e => {
                              const t = (e.textContent || '').trim();
                              return (t === 'Calendar' || t === 'Calendario') && e.getBoundingClientRect().top < 70;
                            });
            if (trigger) {
              const evt = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 120, clientY: 30 });
              trigger.dispatchEvent(evt);
              return 'clicked trigger';
            }
            return 'no trigger found';
          })()`
        }
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) {
      console.log('Result 1:', data.result);
      setTimeout(() => {
        // Step 2: click the Calificaciones item
        ws.send(
          JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const items = Array.from(document.querySelectorAll('.cursa-dd-menu-item, *'));
                const calif = items.find(e => e.textContent && e.textContent.includes('Calificaciones') && e.offsetParent !== null);
                if (calif) {
                  calif.click();
                  return 'clicked Calificaciones';
                }
                return 'Calificaciones item not found';
              })()`
            }
          })
        );
      }, 300);
    } else if (data.id === 2) {
      console.log('Result 2:', data.result);
      setTimeout(() => {
        // Step 3: Capture top view
        ws.send(
          JSON.stringify({
            id: 3,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
          })
        );
      }, 1000);
    } else if (data.id === 3) {
      const buffer = Buffer.from(data.result.data, 'base64');
      fs.writeFileSync('C:/Users/dario/Downloads/GRADES_LIVE_VIEW.png', buffer);
      console.log('Saved top screenshot to C:/Users/dario/Downloads/GRADES_LIVE_VIEW.png');

      // Step 4: Scroll down to view the rest of the tables
      ws.send(
        JSON.stringify({
          id: 4,
          method: 'Runtime.evaluate',
          params: {
            expression: `(() => {
              const root = document.getElementById('cursa-grades-view-root');
              if (root) {
                root.scrollTop = 550;
                return 'scrolled to 550';
              }
              return 'root not found';
            })()`
          }
        })
      );
    } else if (data.id === 4) {
      console.log('Result 4:', data.result);
      setTimeout(() => {
        // Step 5: Capture scrolled view
        ws.send(
          JSON.stringify({
            id: 5,
            method: 'Page.captureScreenshot',
            params: { format: 'png' }
          })
        );
      }, 500);
    } else if (data.id === 5) {
      const buffer = Buffer.from(data.result.data, 'base64');
      fs.writeFileSync('C:/Users/dario/Downloads/GRADES_LIVE_VIEW_SCROLLED.png', buffer);
      console.log('Saved scrolled screenshot to C:/Users/dario/Downloads/GRADES_LIVE_VIEW_SCROLLED.png');
      process.exit(0);
    }
  };
}

main().catch(console.error);
