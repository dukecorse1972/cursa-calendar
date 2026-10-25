const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1366,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../dist/preload/bundle.js'),
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  const testPagePath = path.join(__dirname, 'test-components-page.html');
  await win.loadFile(testPagePath);

  const outDir = path.join(__dirname, '../artifacts/real_components_audit');

  await win.webContents.executeJavaScript(`
    (() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.setAttribute('data-theme', 'dark');
      document.documentElement.style.setProperty('--gcal-bg', '#1f1f1f');
      document.documentElement.style.setProperty('--gcal-surface', '#282a2d');
      document.documentElement.style.setProperty('--gcal-surface-hover', '#35373b');
      document.documentElement.style.setProperty('--gcal-border', '#444746');
      document.documentElement.style.setProperty('--gcal-text', '#e8eaed');
      document.documentElement.style.setProperty('--gcal-secondary-text', '#9aa0a6');
      document.documentElement.style.setProperty('--gcal-accent', '#8ab4f8');
      document.documentElement.style.setProperty('--gcal-selected', '#004a77');

      const { saveSubjectGrades } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/services/gradesStorage.js'))});
      const distConfig = {
        subjectName: 'Matemáticas',
        credits: 6,
        minFinalGradeRequired: 4.0,
        items: [
          { id: 'it_1', name: 'Test Temas 1 y 2 (Teoría)', type: 'EXAMEN', weight: 15, grade: 8.50 },
          { id: 'it_2', name: 'Examen de Problemas (Teoría)', type: 'EXAMEN', weight: 35, grade: null, linkedCalendarEventId: 'ev_123', linkedEventTitle: 'Examen Problemas (25 Ene)' },
          { id: 'it_3', name: 'Práctica Tema 1 (Matrices)', type: 'ENTREGA', weight: 12.5, grade: 7.33 },
          { id: 'it_4', name: 'Práctica Tema 2 (Espacios)', type: 'ENTREGA', weight: 12.5, grade: null },
          { id: 'it_5', name: 'Práctica Tema 3 (Diagonalización)', type: 'ENTREGA', weight: 12.5, grade: null },
          { id: 'it_6', name: 'Práctica Tema 4 (Formas Bilineales)', type: 'ENTREGA', weight: 12.5, grade: null }
        ]
      };
      saveSubjectGrades(distConfig);

      const { GradesSimulatorView } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/ui/grades/gradesSimulatorView.js'))});
      const container = document.getElementById('mock-main-content');
      const view = GradesSimulatorView.getInstance();
      view.setActiveSubject('Matemáticas');
      view.mount(container);
    })()
  `);

  await new Promise(r => setTimeout(r, 800));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `grades_simulator_dark_configured.png`), img.toPNG());
  console.log(`Saved: grades_simulator_dark_configured.png`);

  win.destroy();
  app.quit();
});
