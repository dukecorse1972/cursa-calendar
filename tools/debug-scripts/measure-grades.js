const fs = require('fs');

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('calendar.google.com'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: {
          expression: `(() => {
            const trigger = document.getElementById('cursa-brand-logo-trigger') || 
                            Array.from(document.querySelectorAll('*')).find(e => (e.textContent || '').trim() === 'Calendar' && e.getBoundingClientRect().top < 70);
            if (trigger) trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 120, clientY: 30 }));
            const items = Array.from(document.querySelectorAll('.cursa-dd-menu-item, *'));
            const calif = items.find(e => e.textContent && e.textContent.includes('Calificaciones') && e.offsetParent !== null);
            if (calif) calif.click();
            return 'opened';
          })()`
        }
      })
    );
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.id === 1) {
      setTimeout(() => {
        ws.send(
          JSON.stringify({
            id: 2,
            method: 'Runtime.evaluate',
            params: {
              expression: `(() => {
                const tabs = document.querySelector('.cursa-grades-tabs-scroll');
                if (!tabs) return null;
                const cs = window.getComputedStyle(tabs);
                const firstTab = tabs.querySelector('.cursa-grade-subj-tab');
                const ftCs = firstTab ? window.getComputedStyle(firstTab) : null;
                return {
                  tabsDisplay: cs.display,
                  tabsHeight: cs.height,
                  tabsMaxHeight: cs.maxHeight,
                  tabsOverflow: cs.overflow,
                  tabsFlexWrap: cs.flexWrap,
                  tabsPaddingTop: cs.paddingTop,
                  tabsPaddingBottom: cs.paddingBottom,
                  tabsBoxSizing: cs.boxSizing,
                  firstTabDisplay: ftCs ? ftCs.display : null,
                  firstTabPosition: ftCs ? ftCs.position : null,
                  firstTabMargin: ftCs ? ftCs.margin : null
                };
              })()`,
              returnByValue: true
            }
          })
        );
      }, 500);
    } else if (data.id === 2) {
      console.log('TABS COMPUTED STYLES:', data.result?.result?.value);
      process.exit(0);
    }
  };
}

main().catch(console.error);
