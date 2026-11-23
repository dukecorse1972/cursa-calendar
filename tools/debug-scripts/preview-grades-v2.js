/**
 * Isolated visual preview workbench for Cursa Grades Simulator v2.
 * Launches an independent Electron process with a temporary userData directory
 * (never collides with running Cursa.exe or real user data) and captures
 * Dark Mode, Light Mode, and Term Overview screenshots for visual verification.
 */
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpUserData = path.join(os.tmpdir(), `cursa-grades-preview-${Date.now()}`);
app.setPath('userData', tmpUserData);

const outDir = path.resolve(__dirname, '..', '..', 'artifacts', 'grades-v2-preview');
fs.mkdirSync(outDir, { recursive: true });

const previewHtmlPath = path.join(tmpUserData, 'preview.html');
fs.mkdirSync(tmpUserData, { recursive: true });
fs.writeFileSync(
  previewHtmlPath,
  `<!DOCTYPE html>
<html lang="es" data-gcal-theme="dark">
<head>
  <meta charset="UTF-8" />
  <title>Cursa Grades v2 Preview</title>
  <style>
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
    #mount { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="mount"></div>
</body>
</html>`
);

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '..', '..', 'dist', 'preload', 'bundle.js'),
      backgroundThrottling: false,
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.webContents.on('console-message', (_e, level, msg) => {
    if (level >= 2) console.error('[Preview Console]', msg);
  });

  await win.loadFile(previewHtmlPath);

  // Seed realistic test data in isolated localStorage
  await win.webContents.executeJavaScript(`(() => {
    const subjects = [
      { name: 'Arquitectura de Computadores', color: '#8ab4f8' },
      { name: 'Sistemas Operativos', color: '#81c995' },
      { name: 'Inteligencia Artificial', color: '#c58af9' },
      { name: 'Bases de Datos', color: '#fdd663' }
    ];
    localStorage.setItem('gcal_academic_subjects', JSON.stringify(subjects));
    localStorage.setItem('gcal_academic_plan', JSON.stringify({
      totalYears: 4, periodType: 'cuatrimestre', periodsPerYear: 2, currentYear: 2, currentPeriod: 1, autoBackupOnAdvance: true
    }));

    localStorage.setItem('gcal_subject_grades_arquitectura de computadores', JSON.stringify({
      subjectName: 'Arquitectura de Computadores',
      credits: 6,
      blockCutoffs: { 'Teoría': 4.0, 'Prácticas': 4.0 },
      items: [
        { id: 't1', name: 'Test (Temas 1 y 2)', type: 'EXAMEN', weight: 15, grade: 6.8, category: 'Teoría', dateHint: '14 Nov' },
        { id: 't2', name: 'Examen de problemas', type: 'EXAMEN', weight: 35, grade: null, minGradeRequired: 4.5, category: 'Teoría', linkedCalendarEventId: 'ev1', linkedEventTitle: 'Examen Problemas AC · 25 Ene' },
        { id: 'p1', name: 'Examen práctico', type: 'EXAMEN', weight: 12.5, grade: 7.33, category: 'Prácticas', subcategory: 'Tema 1' },
        { id: 'p2m', name: 'Memoria técnica', type: 'ENTREGA', weight: 2.5, grade: 8.5, category: 'Prácticas', subcategory: 'Tema 2' },
        { id: 'p2e', name: 'Examen práctico', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 2' },
        { id: 'p3m', name: 'Memoria técnica', type: 'ENTREGA', weight: 2.5, grade: null, category: 'Prácticas', subcategory: 'Tema 3' },
        { id: 'p3e', name: 'Examen práctico', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 3' },
        { id: 'p4m', name: 'Memoria técnica', type: 'ENTREGA', weight: 2.5, grade: null, category: 'Prácticas', subcategory: 'Tema 4' },
        { id: 'p4e', name: 'Examen práctico', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 4' }
      ],
      updatedAt: Date.now()
    }));

    localStorage.setItem('gcal_subject_grades_sistemas operativos', JSON.stringify({
      subjectName: 'Sistemas Operativos',
      credits: 6,
      minFinalGradeRequired: 4.0,
      items: [
        { id: 'so1', name: 'Parcial 1', type: 'EXAMEN', weight: 25, grade: 8.4, category: 'Teoría' },
        { id: 'so2', name: 'Práctica Shell en C', type: 'ENTREGA', weight: 35, grade: 9.2, category: 'Prácticas' },
        { id: 'so3', name: 'Examen Final', type: 'EXAMEN', weight: 40, grade: null, minGradeRequired: 4.0, category: 'Teoría' }
      ],
      updatedAt: Date.now()
    }));

    window.cursaMountSimulator(document.getElementById('mount'), 'Arquitectura de Computadores');
  })()`);

  await new Promise((r) => setTimeout(r, 400));

  // 1. Dark Mode screenshot
  const darkImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '01_dark_subject.png'), darkImg.toPNG());

  // 2. Activate a What-If simulation on Examen de problemas (e.g. 6.5) and scroll slightly
  await win.webContents.executeJavaScript(`(() => {
    const simBtn = document.querySelector('.cursa-sim-mode-btn[data-item-id="t2"]');
    if (simBtn) simBtn.click();
    const inp = document.querySelector('.cursa-item-grade-input[data-item-id="t2"]');
    if (inp) {
      inp.value = '6.5';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  const simImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '02_dark_whatif.png'), simImg.toPNG());

  // 3. Light Mode screenshot (re-render cleanly in light mode)
  await win.webContents.executeJavaScript(`(() => {
    document.documentElement.setAttribute('data-gcal-theme', 'light');
    const root = document.documentElement.style;
    root.setProperty('--gcal-bg', '#f6f8fa');
    root.setProperty('--gcal-surface', '#ffffff');
    root.setProperty('--gcal-surface-hover', '#f1f3f5');
    root.setProperty('--gcal-border', '#dadce0');
    root.setProperty('--gcal-text', '#1f1f1f');
    root.setProperty('--gcal-secondary-text', '#5f6368');
    root.setProperty('--gcal-accent', '#1a73e8');
    window.cursaMountSimulator(document.getElementById('mount'), 'Arquitectura de Computadores');
    const rootEl = document.getElementById('cursa-grades-view-root');
    if (rootEl) rootEl.setAttribute('data-cg-theme', 'light');
  })()`);
  await new Promise((r) => setTimeout(r, 350));
  const lightImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '03_light_subject.png'), lightImg.toPNG());

  // 4. Overview Tab screenshot (Dark Mode)
  await win.webContents.executeJavaScript(`(() => {
    document.documentElement.setAttribute('data-gcal-theme', 'dark');
    const root = document.documentElement.style;
    root.removeProperty('--gcal-bg');
    root.removeProperty('--gcal-surface');
    root.removeProperty('--gcal-surface-hover');
    root.removeProperty('--gcal-border');
    root.removeProperty('--gcal-text');
    root.removeProperty('--gcal-secondary-text');
    root.removeProperty('--gcal-accent');
    const overviewBtn = document.querySelector('.cursa-grade-subj-tab[data-subj="__CURSA_OVERVIEW__"]');
    if (overviewBtn) overviewBtn.click();
    const rootEl = document.getElementById('cursa-grades-view-root');
    if (rootEl) rootEl.setAttribute('data-cg-theme', 'dark');
  })()`);
  await new Promise((r) => setTimeout(r, 250));
  const overviewImg = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, '04_dark_overview.png'), overviewImg.toPNG());

  console.log('Saved all 4 preview screenshots to:', outDir);
  win.destroy();
  try { fs.rmSync(tmpUserData, { recursive: true, force: true }); } catch (_) {}
  app.quit();
});
