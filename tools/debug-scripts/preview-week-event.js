const fs = require('fs');
const path = require('path');

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json');
  const pages = await res.json();
  const page = pages.find((p) => p.url.includes('calendar.google.com'));

  const ws = new WebSocket(page.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  console.log('Connected to CDP');

  const send = (method, params = {}) => {
    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1000000);
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
  };

  // Variant 1: Badge Pro (1: Tipo badge, 2: Asignatura, 3: Titulo grande, 4: Descripcion, 5: Horas abajo)
  const variant1HTML = `
    <div style="width: 100%; height: 100%; box-sizing: border-box; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; font-family: 'Google Sans', Roboto, sans-serif; color: #fff; overflow: hidden; line-height: 1.25;">
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="background: rgba(0,0,0,0.35); padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase;">
          📋 EXAMEN
        </span>
      </div>
      <div style="font-size: 11px; opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500;">
        🖥️ Fundamentos Comp.
      </div>
      <div style="font-size: 13.5px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">
        EJEMPLO1
      </div>
      <div style="font-size: 10.5px; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        📍 Aula 2.3 · Parcial
      </div>
      <div style="margin-top: auto; font-size: 10.5px; opacity: 0.9; font-weight: 600; display: flex; align-items: center; gap: 4px;">
        <span>⏱️</span> 14:00 – 16:00
      </div>
    </div>
  `;

  // Variant 2: Header Split (1: Tipo + 5: Horas en cabecera, 2: Asignatura, 3: Titulo protagonista, 4: Descripcion)
  const variant2HTML = `
    <div style="width: 100%; height: 100%; box-sizing: border-box; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; font-family: 'Google Sans', Roboto, sans-serif; color: #fff; overflow: hidden; line-height: 1.25;">
      <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.2); padding-bottom: 3px; margin-bottom: 1px;">
        <span style="font-size: 10px; font-weight: 800; letter-spacing: 0.5px; text-transform: uppercase; color: #ffd699;">
          📋 EXAMEN
        </span>
        <span style="font-size: 10px; opacity: 0.85; font-weight: 600;">
          14:00 - 16:00
        </span>
      </div>
      <div style="font-size: 11px; opacity: 0.9; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        🖥️ Fundamentos de los Comp.
      </div>
      <div style="font-size: 14px; font-weight: 800; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        EJEMPLO1
      </div>
      <div style="font-size: 10px; opacity: 0.75; margin-top: auto;">
        📝 Aula 2.3 · Teórica
      </div>
    </div>
  `;

  // Variant 3: Estilo Paso a Paso Limpio (Numerado y estructurado)
  const variant3HTML = `
    <div style="width: 100%; height: 100%; box-sizing: border-box; padding: 6px 8px; display: flex; flex-direction: column; gap: 2px; font-family: 'Google Sans', Roboto, sans-serif; color: #fff; overflow: hidden; line-height: 1.25;">
      <div style="display: flex; align-items: center; gap: 5px;">
        <span style="font-size: 9.5px; background: rgba(0,0,0,0.4); padding: 1px 5px; border-radius: 3px; font-weight: 700;">1. TIPO</span>
        <span style="font-size: 10.5px; font-weight: 700;">📋 Examen</span>
      </div>
      <div style="display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: 0.9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        <span style="font-size: 9.5px; opacity: 0.7;">2.</span> <span>🖥️ Fundamentos Comp.</span>
      </div>
      <div style="font-size: 13px; font-weight: 700; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        3. EJEMPLO1
      </div>
      <div style="font-size: 10px; opacity: 0.75; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        4. Aula 2.3
      </div>
      <div style="font-size: 10px; opacity: 0.85; font-weight: 600; margin-top: auto;">
        5. 14:00 – 16:00
      </div>
    </div>
  `;

  async function renderVariant(html) {
    const fn = `
      (() => {
        const chip = document.querySelector('[data-eventchip]');
        if (!chip) return 'no chip';
        let container = chip.querySelector('.custom-academic-container');
        if (!container) {
          const stdContent = chip.querySelector('.Jcb6qd');
          if (stdContent) stdContent.style.display = 'none';
          container = document.createElement('div');
          container.className = 'custom-academic-container';
          container.style.cssText = 'width: 100%; height: 100%; position: absolute; top: 0; left: 0; pointer-events: none;';
          chip.appendChild(container);
        }
        container.innerHTML = ${JSON.stringify(html)};
        return 'ok';
      })()
    `;
    const res = await send('Runtime.evaluate', {
      expression: fn,
      returnByValue: true
    });
    console.log('Applied variant:', res);
  }

  async function capture(fileName) {
    await new Promise(r => setTimeout(r, 400));
    const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, fileName);
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(shot.data, 'base64'));
    console.log('Saved:', filePath);
  }

  // Capture Variant 1
  await renderVariant(variant1HTML);
  await capture('OPCION_1_BADGE_PRO.png');

  // Capture Variant 2
  await renderVariant(variant2HTML);
  await capture('OPCION_2_HEADER_SPLIT.png');

  // Capture Variant 3
  await renderVariant(variant3HTML);
  await capture('OPCION_3_PASO_A_PASO.png');

  // Restore original
  await send('Runtime.evaluate', {
    expression: `
      (() => {
        const chip = document.querySelector('[data-eventchip]');
        if (!chip) return;
        const container = chip.querySelector('.custom-academic-container');
        if (container) container.remove();
        const stdContent = chip.querySelector('.Jcb6qd');
        if (stdContent) stdContent.style.display = '';
      })()
    `
  });

  ws.close();
  console.log('Done all!');
  process.exit(0);
}

main().catch(console.error);
