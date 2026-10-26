const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

async function main() {
  const exePath = path.resolve(__dirname, '..', 'release', 'win-unpacked', 'Google Calendar.exe');
  const cwd = path.dirname(exePath);

  console.log('Spawning executable:', exePath);
  const child = spawn(exePath, ['--enable-logging'], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  });

  child.stdout.on('data', (d) => console.log('[EXE stdout]', d.toString().trim()));
  child.stderr.on('data', (d) => console.log('[EXE stderr]', d.toString().trim()));
  child.on('exit', (code) => console.log('[EXE exited] code:', code));

  console.log('Waiting for CDP on port 9222...');
  let page = null;
  for (let i = 0; i < 20; i++) {
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
    console.error('Failed to connect to Google Calendar page on CDP port 9222');
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
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  });

  await new Promise(resolve => ws.addEventListener('open', resolve));

  async function evaluate(expression) {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true });
    return res.result?.value;
  }

  async function takeScreenshot(fileName) {
    const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
    fs.mkdirSync(outDir, { recursive: true });
    const filePath = path.join(outDir, fileName);
    const res = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(filePath, Buffer.from(res.data, 'base64'));
    console.log(`Saved screenshot to ${filePath}`);
  }

  // Wait 3 seconds for initial load
  await new Promise(r => setTimeout(r, 3000));

  // TEST 1: Verify tabs mounted, no +Nuevo button, and initial state
  console.log('\n--- TEST 1: Header Tabs Verification ---');
  const tabsInfo = await evaluate(`(() => {
    const box = document.querySelector('#gcal-header-academic-tabs');
    const buttons = box ? Array.from(box.querySelectorAll('button')) : [];
    return {
      boxFound: Boolean(box),
      buttonCount: buttons.length,
      buttonTexts: buttons.map(b => b.textContent.trim()),
      hasPlusNuevo: Boolean(box?.textContent.includes('+ Nuevo') || box?.textContent.includes('Nuevo'))
    };
  })()`);
  console.log('Tabs info:', JSON.stringify(tabsInfo, null, 2));
  await takeScreenshot('TEST_NEW_TABS.png');

  // TEST 2: Test Week Navigation with ArrowLeft / ArrowRight
  console.log('\n--- TEST 2: Week Navigation with Keys ---');
  const navTest = await evaluate(`(() => {
    const titleBefore = document.title;
    // Dispatch ArrowRight
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    return { titleBefore };
  })()`);
  await new Promise(r => setTimeout(r, 1000));
  const navTestAfter = await evaluate(`document.title`);
  console.log('Nav week test: before="' + navTest.titleBefore + '", after ArrowRight="' + navTestAfter + '"');
  await takeScreenshot('TEST_KEY_NAV_NEXT.png');

  // Dispatch ArrowLeft to go back
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))`);
  await new Promise(r => setTimeout(r, 1000));
  const navBack = await evaluate(`document.title`);
  console.log('Nav week back: after ArrowLeft="' + navBack + '"');

  // TEST 3: Fluid Tab Navigation
  console.log('\n--- TEST 3: Switching to EXÁMENES Y ENTREGAS ---');
  const switchStats = await evaluate(`(() => {
    const t0 = performance.now();
    const btn = document.querySelector('#gcal-hdr-tab-entregas');
    btn.click();
    const t1 = performance.now();
    return {
      durationMs: t1 - t0,
      activeTab: document.body.getAttribute('data-gcal-tab')
    };
  })()`);
  console.log('Switch duration:', switchStats.durationMs, 'ms');
  // Wait 300ms for fluid CSS animation
  await new Promise(r => setTimeout(r, 350));
  await takeScreenshot('TEST_ENTREGAS_FLUID.png');

  // TEST 4: Clicking "+ Crear" button in EXÁMENES Y ENTREGAS (should open custom modal!)
  console.log('\n--- TEST 4: Clicking "+ Crear" in EXÁMENES Y ENTREGAS ---');
  const modalTest = await evaluate(`(() => {
    const createBtn = document.querySelector('button[jsname="todz4c"]') || document.querySelector('.nUt0vb');
    if (!createBtn) return { error: 'Crear button not found' };
    createBtn.click();
    const modal = document.querySelector('#gcal-academic-creator-modal');
    return {
      btnFound: true,
      modalDisplay: modal ? window.getComputedStyle(modal).display : 'not in dom'
    };
  })()`);
  console.log('Modal test in EXÁMENES:', JSON.stringify(modalTest, null, 2));
  await takeScreenshot('TEST_CREAR_MODAL_OPEN.png');

  // Close modal
  await evaluate(`(() => {
    const closeBtn = document.querySelector('#gcal-creator-close');
    closeBtn?.click();
  })()`);
  await new Promise(r => setTimeout(r, 300));

  // TEST 5: Switch to CLASES and click "+ Crear" (should NOT open custom modal!)
  console.log('\n--- TEST 5: Switching to CLASES and testing "+ Crear" ---');
  await evaluate(`(() => {
    document.querySelector('#gcal-hdr-tab-clases')?.click();
  })()`);
  await new Promise(r => setTimeout(r, 350));

  const clasesCrearTest = await evaluate(`(() => {
    const createBtn = document.querySelector('button[jsname="todz4c"]') || document.querySelector('.nUt0vb');
    createBtn?.click();
    const modal = document.querySelector('#gcal-academic-creator-modal');
    return {
      modalDisplay: modal ? window.getComputedStyle(modal).display : 'none',
      createBtnExpanded: createBtn?.getAttribute('aria-expanded')
    };
  })()`);
  console.log('Crear in CLASES test:', JSON.stringify(clasesCrearTest, null, 2));
  await takeScreenshot('TEST_CLASES_NATIVE_MENU.png');

  // Dismiss native menu
  await evaluate(`document.body.click()`);

  console.log('\nAll tests complete!');
  ws.close();
  child.kill();
  process.exit(0);
}

main().catch(console.error);
