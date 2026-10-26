const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 950,
    height: 800,
    show: false,
    webPreferences: {
      offscreen: false
    }
  });

  const htmlPath = path.join(__dirname, 'preview-enfoques.html');
  await win.loadFile(htmlPath);
  await new Promise(r => setTimeout(r, 800));

  const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'debug-screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const mockups = [
    { id: 'mockup-a', file: path.join(outDir, 'ENFOQUE_A_BENTO.png') },
    { id: 'mockup-b', file: path.join(outDir, 'ENFOQUE_B_STUDIO.png') },
    { id: 'mockup-c', file: path.join(outDir, 'ENFOQUE_C_TIMELINE.png') },
  ];

  for (const m of mockups) {
    try {
      await win.webContents.executeJavaScript(`
        document.getElementById('${m.id}').scrollIntoView();
      `);
      await new Promise(r => setTimeout(r, 200));

      const rect = await win.webContents.executeJavaScript(`
        (() => {
          const el = document.getElementById('${m.id}');
          const r = el.getBoundingClientRect();
          return { x: Math.max(0, Math.round(r.left)), y: Math.max(0, Math.round(r.top)), width: Math.round(r.width), height: Math.round(r.height) };
        })()
      `);

      const img = await win.webContents.capturePage(rect);
      fs.writeFileSync(m.file, img.toPNG());
      console.log('Saved:', m.file);
    } catch (err) {
      console.error('Error capturing', m.id, err);
    }
  }

  app.quit();
});
