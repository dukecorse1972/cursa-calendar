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

  // Load a blank page or HTML page where injected code runs
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>Google Calendar</title>
        <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap" rel="stylesheet">
        <style>
          :root {
            --gcal-background: #ffffff;
            --gcal-surface: #ffffff;
            --gcal-surface-hover: #f1f3f4;
            --gcal-border: #dadce0;
            --gcal-text: #1f1f1f;
            --gcal-secondary-text: #5f6368;
            --gcal-accent: #1a73e8;
          }
          body {
            margin: 0;
            padding: 0;
            font-family: 'Google Sans', Roboto, sans-serif;
            background: #ffffff;
            color: #1f1f1f;
            overflow: hidden;
          }
          #top-mock-header {
            height: 64px;
            border-bottom: 1px solid #dadce0;
            display: flex;
            align-items: center;
            padding: 0 24px;
            gap: 16px;
          }
          #mock-content {
            width: 100vw;
            height: calc(100vh - 64px);
            position: relative;
          }
        </style>
      </head>
      <body>
        <div id="top-mock-header">
          <div style="font-size: 20px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 24px;">📅</span>
            <span id="cursa-brand-logo-trigger"><span class="cursa-brand-text-label">Calificaciones</span></span>
          </div>
        </div>
        <div id="mock-content"></div>
      </body>
    </html>
  `;

  const testPagePath = path.join(__dirname, 'test-page.html');
  fs.writeFileSync(testPagePath, htmlContent, 'utf-8');

  win.webContents.on('console-message', (_e, level, msg) => console.log('[BrowserConsole]', msg));

  await win.loadFile(testPagePath);

  // Initialize and populate realistic student grades in the DOM via executeJavaScript
  await win.webContents.executeJavaScript(`
    (async () => {
      try {
        console.log('In browser page, setting localStorage...');
        // Setup mock academic subjects
        localStorage.setItem('gcal_academic_subjects', JSON.stringify([
          { name: 'Sistemas Distribuidos', color: '#1a73e8' },
          { name: 'Inteligencia Artificial', color: '#8e24aa' },
          { name: 'Ingeniería del Software', color: '#137333' },
          { name: 'Bases de Datos', color: '#d97706' }
        ]));

        // Populate realistic subject configuration matching user's exact syllabus
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

        console.log('Loading GradesSimulatorView module...');
        const { GradesSimulatorView } = require(${JSON.stringify(path.join(__dirname, '../dist/injected/ui/grades/gradesSimulatorView.js'))});
        const container = document.getElementById('mock-content');
        const view = GradesSimulatorView.getInstance();
        view.setActiveSubject('Sistemas Distribuidos');
        view.mount(container);
        console.log('View mounted successfully!');
      } catch (innerErr) {
        console.error('INNER ERROR:', innerErr.message, innerErr.stack);
      }
    })()
  `).catch(err => console.log('executeJavaScript ERROR:', err));

  // Wait for rendering
  await new Promise(r => setTimeout(r, 1200));

  // Capture screenshot of Simulator View
  const screenshotDir = path.join(__dirname, '../artifacts');
  if (!fs.existsSync(screenshotDir)) {
    fs.mkdirSync(screenshotDir, { recursive: true });
  }

  const image1 = await win.webContents.capturePage();
  const file1 = path.join(screenshotDir, 'grades_simulator_redesign.png');
  fs.writeFileSync(file1, image1.toPNG());
  console.log('CAPTURED_MAIN_VIEW:', file1);

  // Scroll down to see full table and footer
  await win.webContents.executeJavaScript(`
    (() => {
      const footer = document.querySelector('#cursa-grades-view-root table')?.parentElement?.lastElementChild;
      if (footer) footer.scrollIntoView({ behavior: 'instant', block: 'end' });
    })()
  `);
  await new Promise(r => setTimeout(r, 400));
  const imageFooter = await win.webContents.capturePage();
  const fileFooter = path.join(screenshotDir, 'grades_table_footer_redesign.png');
  fs.writeFileSync(fileFooter, imageFooter.toPNG());
  console.log('CAPTURED_FOOTER_VIEW:', fileFooter);

  // Scroll back to top before opening modal
  await win.webContents.executeJavaScript(`
    (() => {
      const root = document.getElementById('cursa-grades-view-root');
      if (root) root.scrollTop = 0;
    })()
  `);
  await new Promise(r => setTimeout(r, 300));

  // Now trigger the Gemini Assistant Modal
  await win.webContents.executeJavaScript(`
    (() => {
      const btn = document.getElementById('cursa-reconfigure-ai-btn');
      if (btn) btn.click();
    })()
  `);

  await new Promise(r => setTimeout(r, 800));

  // In modal, click the quick starter pill to see Gemini generate the syllabus proposal!
  await win.webContents.executeJavaScript(`
    (() => {
      const pill = document.querySelector('.cursa-quick-starter-btn');
      if (pill) pill.click();
    })()
  `);

  // Wait for offline fallback reasoning to respond
  await new Promise(r => setTimeout(r, 1500));

  const image2 = await win.webContents.capturePage();
  const file2 = path.join(screenshotDir, 'grades_gemini_modal_redesign.png');
  fs.writeFileSync(file2, image2.toPNG());
  console.log('CAPTURED_GEMINI_MODAL:', file2);

  win.destroy();
  app.quit();
});
