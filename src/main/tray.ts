import { app, Menu, Tray, BrowserWindow } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { setIsQuitting } from './lifecycle';

let tray: Tray | null = null;

function getTrayIconPath(): string {
  const directPath = path.join(__dirname, '../../assets/icon.ico');
  if (fs.existsSync(directPath)) return directPath;

  const resourcesPath = path.join(process.resourcesPath || '', 'assets/icon.ico');
  if (fs.existsSync(resourcesPath)) return resourcesPath;

  return path.join(app.getAppPath(), 'assets/icon.ico');
}

export function setupTray(mainWindow: BrowserWindow): Tray {
  if (tray) return tray;

  const iconPath = getTrayIconPath();
  tray = new Tray(iconPath);
  tray.setToolTip('Cursa — Google Calendar');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Mostrar Cursa',
      click: () => {
        if (!mainWindow.isVisible()) {
          mainWindow.show();
        }
        if (mainWindow.isMinimized()) {
          mainWindow.restore();
        }
        mainWindow.focus();
      }
    },
    { type: 'separator' },
    {
      label: 'Pestaña: Clases',
      click: () => {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('switch-academic-tab', 'CLASES');
      }
    },
    {
      label: 'Pestaña: Exámenes y Entregas',
      click: () => {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('switch-academic-tab', 'ENTREGAS_EXAMENES');
      }
    },
    {
      label: 'Pestaña: Todo',
      click: () => {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('switch-academic-tab', 'TODO');
      }
    },
    { type: 'separator' },
    {
      label: '🎓 Configurar Asignaturas y Paleta...',
      click: () => {
        if (!mainWindow.isVisible()) mainWindow.show();
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('open-academic-settings');
      }
    },
    { type: 'separator' },
    {
      label: 'Salir',
      click: () => {
        setIsQuitting(true);
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow.isVisible()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
        mainWindow.focus();
      } else if (mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.focus();
      }
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.on('double-click', () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}
