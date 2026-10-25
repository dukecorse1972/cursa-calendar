const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1366,
    height: 920,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  const walkthroughPath = path.join(__dirname, '../walkthrough-1to1.html');
  await win.loadFile(walkthroughPath);

  const outDir = path.join(__dirname, '../artifacts/audit_screenshots');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const scenes = [
    { num: 1, name: 'scene1_initial_clean' },
    { num: 2, name: 'scene2_onboarding_palettes' },
    { num: 3, name: 'scene3_creator_modal' },
    { num: 4, name: 'scene4_calendar_grid_badge_pro' },
    { num: 5, name: 'scene5_detail_modal' }
  ];

  for (const theme of ['dark', 'light']) {
    await win.webContents.executeJavaScript(`
      document.body.setAttribute('data-theme', '${theme}');
      isDarkTheme = ${theme === 'dark'};
    `);
    await new Promise(r => setTimeout(r, 200));

    for (const scene of scenes) {
      await win.webContents.executeJavaScript(`
        switchScene(${scene.num});
      `);
      await new Promise(r => setTimeout(r, 400));

      const img = await win.webContents.capturePage();
      const filename = path.join(outDir, `${scene.name}_${theme}.png`);
      fs.writeFileSync(filename, img.toPNG());
      console.log(`Captured: ${filename}`);
    }
  }

  // Also test a narrower window (1024x768) on Scene 4 to verify responsiveness
  win.setSize(1024, 768);
  await new Promise(r => setTimeout(r, 400));
  await win.webContents.executeJavaScript(`switchScene(4);`);
  const imgNarrow = await win.webContents.capturePage();
  const narrowFile = path.join(outDir, `scene4_calendar_grid_1024x768_dark.png`);
  fs.writeFileSync(narrowFile, imgNarrow.toPNG());
  console.log(`Captured: ${narrowFile}`);

  win.destroy();
  app.quit();
});
