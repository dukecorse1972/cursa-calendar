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

  async function setTheme(theme) {
    await win.webContents.executeJavaScript(`
      (() => {
        document.documentElement.setAttribute('data-theme', '${theme}');
        document.body.setAttribute('data-theme', '${theme}');
        if ('${theme}' === 'light') {
          document.documentElement.style.setProperty('--gcal-bg', '#ffffff');
          document.documentElement.style.setProperty('--gcal-surface', '#ffffff');
          document.documentElement.style.setProperty('--gcal-surface-hover', '#f1f3f4');
          document.documentElement.style.setProperty('--gcal-border', '#dadce0');
          document.documentElement.style.setProperty('--gcal-text', '#1f1f1f');
          document.documentElement.style.setProperty('--gcal-secondary-text', '#5f6368');
          document.documentElement.style.setProperty('--gcal-accent', '#1a73e8');
          document.documentElement.style.setProperty('--gcal-selected', '#e8f0fe');
        } else {
          document.documentElement.style.setProperty('--gcal-bg', '#1f1f1f');
          document.documentElement.style.setProperty('--gcal-surface', '#282a2d');
          document.documentElement.style.setProperty('--gcal-surface-hover', '#35373b');
          document.documentElement.style.setProperty('--gcal-border', '#444746');
          document.documentElement.style.setProperty('--gcal-text', '#e8eaed');
          document.documentElement.style.setProperty('--gcal-secondary-text', '#9aa0a6');
          document.documentElement.style.setProperty('--gcal-accent', '#8ab4f8');
          document.documentElement.style.setProperty('--gcal-selected', '#004a77');
        }
      })()
    `);
    await new Promise(r => setTimeout(r, 100));
  }

  function cleanOverlays() {
    return win.webContents.executeJavaScript(`
      (() => {
        document.querySelectorAll('#gcal-academic-creator-modal, #gcal-onboarding-modal-overlay, #gcal-academic-detail-modal').forEach(el => el.remove());
      })()
    `);
  }

  // 1. CAPTURE GRADES SIMULATOR DARK MODE (CLEAN)
  await setTheme('dark');
  await cleanOverlays();
  await win.webContents.executeJavaScript(`
    (() => {
      const distConfig = {
        subjectName: 'Sistemas Distribuidos',
        credits: 6,
        minFinalGradeRequired: 4.0,
        items: [
          { id: 'it_1', name: 'Test Temas 1 y 2 (Teoría)', type: 'EXAMEN', weight: 15, grade: 8.50 },
          { id: 'it_2', name: 'Examen de Problemas (Teoría)', type: 'EXAMEN', weight: 35, grade: null, linkedCalendarEventId: 'ev_123', linkedEventTitle: 'Examen Problemas SD (25 Ene)' },
          { id: 'it_3', name: 'Práctica Tema 1 (Sockets)', type: 'ENTREGA', weight: 12.5, grade: 7.33 },
          { id: 'it_4', name: 'Práctica Tema 2 (RPC/RMI)', type: 'ENTREGA', weight: 12.5, grade: null },
          { id: 'it_5', name: 'Práctica Tema 3 (Mensajería)', type: 'ENTREGA', weight: 12.5, grade: null },
          { id: 'it_6', name: 'Práctica Tema 4 (Consenso Raft)', type: 'ENTREGA', weight: 12.5, grade: null }
        ],
        updatedAt: Date.now()
      };
      localStorage.setItem('gcal_subject_grades_sistemas distribuidos', JSON.stringify(distConfig));

      const { GradesSimulatorView } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/ui/grades/gradesSimulatorView.js'))});
      const container = document.getElementById('mock-main-content');
      const view = GradesSimulatorView.getInstance();
      view.setActiveSubject('Sistemas Distribuidos');
      view.mount(container);
    })()
  `);
  await new Promise(r => setTimeout(r, 800));
  const imgGradesDark = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `grades_simulator_dark_clean.png`), imgGradesDark.toPNG());
  console.log(`Saved: grades_simulator_dark_clean.png`);

  // 2. CAPTURE CALENDAR PICKER MODE (GUIDANCE BANNER)
  await win.webContents.executeJavaScript(`
    (() => {
      const { CalendarPickerMode } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/ui/grades/calendarPickerMode.js'))});
      CalendarPickerMode.getInstance().startPicker('Sistemas Distribuidos', 'it_2', 'Examen de Problemas (Teoría)');
    })()
  `);
  await new Promise(r => setTimeout(r, 400));
  const imgPicker = await win.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, `calendar_picker_mode_dark.png`), imgPicker.toPNG());
  console.log(`Saved: calendar_picker_mode_dark.png`);
  await win.webContents.executeJavaScript(`
    (() => {
      const { CalendarPickerMode } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/ui/grades/calendarPickerMode.js'))});
      CalendarPickerMode.getInstance().stopPicker();
    })()
  `);

  win.destroy();
  app.quit();
});
