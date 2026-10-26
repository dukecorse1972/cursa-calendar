import { app, BrowserWindow, shell, ipcMain, IpcMainInvokeEvent, Session } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { GOOGLE_CALENDAR_URL } from '../shared/constants';
import { setupSession } from './session';
import { AcademicEventPayload } from '../shared/types';
import { formatAcademicEvent } from '../shared/formatters';
import {
  validateAcademicEventPayload,
  isValidEventId,
  isTrustedCalendarOrigin,
  isAllowedGoogleHost,
  isSafeExternalUrl,
  validateCalendarNames
} from '../shared/validators';
import { logger } from '../shared/logger';
import { setupTray, destroyTray } from './tray';
import { setIsQuitting, getIsQuitting } from './lifecycle';
import {
  buildSaveEventScript,
  buildDeleteEventWindowScript,
  buildInPlaceRescheduleScript,
  buildUpdateDescriptionScript,
  buildCheckCalendarExistsScript,
  buildCreateCalendarScript
} from './gcalAutomation';

export { setIsQuitting, getIsQuitting };

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;

function isDebugMode(): boolean {
  return process.env.ENABLE_REMOTE_DEBUG === '1' || process.env.NODE_ENV === 'development';
}

function isAuthorizedIpcSender(event: IpcMainInvokeEvent): boolean {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || '';
  if (isTrustedCalendarOrigin(senderUrl)) {
    return true;
  }
  if (isDebugMode() && senderUrl.startsWith('file:')) {
    return true;
  }
  logger.warn('IPCGuard', `Rejected IPC invocation from untrusted sender: ${senderUrl || '<empty>'}`);
  return false;
}

export function resolveSafeDebugScreenshotPath(filePath: unknown): string | null {
  if (typeof filePath !== 'string' || !filePath.trim() || filePath.includes('\0')) {
    return null;
  }
  const resolved = path.resolve(filePath.trim());
  if (path.extname(resolved).toLowerCase() !== '.png') {
    return null;
  }
  const allowedRoots = [path.resolve(process.cwd())];
  try {
    allowedRoots.push(path.resolve(app.getPath('temp')));
  } catch (_) {}

  const isInsideAllowedRoot = allowedRoots.some((root) => {
    const normalizedRoot = root.toLowerCase();
    const normalizedTarget = resolved.toLowerCase();
    return normalizedTarget.startsWith(normalizedRoot + path.sep);
  });

  return isInsideAllowedRoot ? resolved : null;
}

export function waitForEventEditExit(win: BrowserWindow, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;

    const isOffEventEdit = (): boolean => {
      if (win.isDestroyed()) return false;
      const url = win.webContents.getURL() || '';
      return Boolean(url) && !url.includes('/eventedit');
    };

    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (maxTimer) clearTimeout(maxTimer);
      if (!win.isDestroyed()) {
        win.webContents.removeListener('did-navigate', checkNav);
        win.webContents.removeListener('did-navigate-in-page', checkNav);
      }
      resolve(result);
    };

    const checkNav = () => {
      if (isOffEventEdit()) {
        finish(true);
      }
    };

    if (isOffEventEdit()) {
      finish(true);
      return;
    }

    win.webContents.on('did-navigate', checkNav);
    win.webContents.on('did-navigate-in-page', checkNav);
    pollTimer = setInterval(checkNav, 150);
    maxTimer = setTimeout(() => finish(isOffEventEdit()), timeoutMs);
  });
}

export function getActiveAccountIndex(): string {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const currentUrl = mainWindow.webContents.getURL() || '';
    const match = currentUrl.match(/\/calendar\/u\/(\d+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return '0';
}

class AsyncOperationQueue {
  private queue: Promise<any> = Promise.resolve();

  public enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this.queue.then(op, op);
    this.queue = next.catch(() => {});
    return next;
  }
}

const bgTaskQueue = new AsyncOperationQueue();

function setupBackgroundEventCreation(customSession: Session): void {
  if (ipcRegistered) return;
  ipcRegistered = true;

  ipcMain.handle('create-academic-event-background', async (event, payload: AcademicEventPayload) => {
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    return bgTaskQueue.enqueue(async () => {
      // 1. Strict runtime payload validation on IPC boundary
      const validation = validateAcademicEventPayload(payload);
      if (!validation.valid) {
        logger.error('BackgroundEventCreate', 'Validation failed: ' + validation.errors.join('; '));
        return { success: false, error: validation.errors.join('; ') };
      }

      // 2. Format standardized academic event payload and edit URL with dynamic account index
      const accountIndex = getActiveAccountIndex();
      const { targetUrl } = formatAcademicEvent(payload, accountIndex);
      logger.info('BackgroundEventCreate', `Creating event: ${payload.title} (${payload.type}) for account index ${accountIndex}`);

      const bgWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);
        const isEntrega = payload.type === 'ENTREGA';
        const saveRes = await bgWindow.webContents.executeJavaScript(buildSaveEventScript(isEntrega));

        // Verify navigation out of /eventedit to confirm Google Calendar saved the event
        const saved = await waitForEventEditExit(bgWindow, 6500);
        if (!saved) {
          logger.error('BackgroundEventCreate', `Event save was not confirmed (remained on /eventedit): ${payload.title}`);
          return { success: false, error: 'Google Calendar did not confirm event creation' };
        }

        // Allow Google Calendar's in-flight batchexecute/sync write to finish before tearing down bgWindow
        await new Promise((r) => setTimeout(r, 650));

        const usedPrimaryFallback = !saveRes?.selectedAcademicCalendar;
        logger.info('BackgroundEventCreate', `Event created successfully: ${payload.title} (primaryFallback=${usedPrimaryFallback})`);
        return { success: true, usedPrimaryFallback };
      } catch (err: any) {
        logger.error('BackgroundEventCreate', 'Failed to create event in background: ' + err.message, err);
        return { success: false, error: err.message };
      } finally {
        if (!bgWindow.isDestroyed()) {
          bgWindow.destroy();
        }
      }
    });
  });

  ipcMain.handle('delete-academic-event-background', async (event, eventId: string) => {
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    return bgTaskQueue.enqueue(async () => {
      // 1. Validate eventId strictly
      if (!isValidEventId(eventId)) {
        logger.warn('BackgroundEventDelete', 'Invalid or malformed eventId provided: ' + eventId);
        return { success: false, error: 'Invalid or malformed eventId provided' };
      }

      const accountIndex = getActiveAccountIndex();
      logger.info('BackgroundEventDelete', `Deleting event: ${eventId} for account index ${accountIndex}`);

      // Dedicated background window with full desktop dimensions to ensure direct action buttons are visible
      const targetUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(eventId)}`;
      const bgWindow = new BrowserWindow({
        show: false,
        width: 1366,
        height: 900,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);
        const scriptRes = await bgWindow.webContents.executeJavaScript(buildDeleteEventWindowScript());

        if (scriptRes && scriptRes.success === false) {
          logger.error('BackgroundEventDelete', `Deletion script failed: ${scriptRes.error}`);
          return { success: false, error: scriptRes.error };
        }

        logger.info('BackgroundEventDelete', 'Event deleted and verified successfully: ' + eventId);
        return { success: true };
      } catch (err: any) {
        logger.error('BackgroundEventDelete', 'Failed to delete event in background: ' + err.message, err);
        return { success: false, error: err.message };
      } finally {
        if (!bgWindow.isDestroyed()) {
          bgWindow.destroy();
        }
      }
    });
  });

  // Atomic in-place reschedule without duplicate risks [P2-03]
  ipcMain.handle('move-academic-event-background', async (event, data: { eventId?: string; payload: AcademicEventPayload }) => {
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    return bgTaskQueue.enqueue(async () => {
      // 1. Strict validation of new payload
      const validation = validateAcademicEventPayload(data?.payload);
      if (!validation.valid) {
        logger.error('BackgroundEventMove', 'Validation failed: ' + validation.errors.join('; '));
        return { success: false, error: validation.errors.join('; ') };
      }

      const bgWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        let editedInPlace = false;
        const accountIndex = getActiveAccountIndex();

        // Try atomic in-place edit on existing event to avoid duplicate risk [P2-03]
        if (data.eventId && isValidEventId(data.eventId)) {
          try {
            logger.info('BackgroundEventMove', `Attempting atomic in-place reschedule for event ${data.eventId} on account ${accountIndex}`);
            const editUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(data.eventId)}`;
            await bgWindow.loadURL(editUrl);

            const effectiveStart = data.payload.startTime || data.payload.time;
            await bgWindow.webContents.executeJavaScript(
              buildInPlaceRescheduleScript(data.payload.date, effectiveStart, data.payload.endTime)
            );

            const savedInPlace = await waitForEventEditExit(bgWindow, 4500);
            if (!savedInPlace) {
              throw new Error('Google Calendar remained on /eventedit after in-place reschedule');
            }
            await new Promise((r) => setTimeout(r, 500));

            editedInPlace = true;
            logger.info('BackgroundEventMove', `Atomic in-place reschedule succeeded for ${data.eventId}`);
          } catch (inPlaceErr: any) {
            logger.warn('BackgroundEventMove', `In-place edit failed, falling back to safe recreate: ${inPlaceErr.message}`);
          }
        }

        if (!editedInPlace) {
          // Fallback: Create new event first, and only delete old on success
          const { targetUrl } = formatAcademicEvent(data.payload, accountIndex);
          const isEntrega = data.payload.type === 'ENTREGA';
          await bgWindow.loadURL(targetUrl);

          await bgWindow.webContents.executeJavaScript(buildSaveEventScript(isEntrega));

          const fallbackSaved = await waitForEventEditExit(bgWindow, 4500);
          if (!fallbackSaved) {
            throw new Error('Fallback event creation was not confirmed by Google Calendar');
          }

          // Delete old event ONLY after new event is confirmed saved
          if (data.eventId && isValidEventId(data.eventId)) {
            try {
              const deleteUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(data.eventId)}`;
              await bgWindow.loadURL(deleteUrl);
              await bgWindow.webContents.executeJavaScript(buildDeleteEventWindowScript());
              logger.info('BackgroundEventMove', `Old event ${data.eventId} deleted successfully`);
            } catch (deleteOldErr: any) {
              logger.warn('BackgroundEventMove', `New event created successfully, but deleting old event ${data.eventId} failed: ${deleteOldErr.message}`);
              return { success: true, warning: 'Event rescheduled, but could not delete original instance' };
            }
          }
        }

        return { success: true };
      } catch (err: any) {
        logger.error('BackgroundEventMove', 'Failed to move event in background: ' + err.message, err);
        return { success: false, error: err.message };
      } finally {
        if (!bgWindow.isDestroyed()) {
          bgWindow.destroy();
        }
      }
    });
  });

  // Sync event notes with Google Calendar event cloud description [P2-01]
  ipcMain.handle('update-event-description-background', async (event, data: { eventId?: string; eventTitle?: string; description: string }) => {
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    return bgTaskQueue.enqueue(async () => {
      const eventId = data?.eventId;
      const description = typeof data?.description === 'string' ? data.description.slice(0, 5000) : '';

      if (!eventId || !isValidEventId(eventId)) {
        logger.warn('BackgroundEventDescUpdate', 'Invalid or missing eventId: ' + eventId);
        return { success: false, error: 'Invalid or missing eventId' };
      }

      const accountIndex = getActiveAccountIndex();
      logger.info('BackgroundEventDescUpdate', `Syncing description for event ${eventId} on account index ${accountIndex}`);
      const targetUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(eventId)}`;

      const bgWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);
        await bgWindow.webContents.executeJavaScript(buildUpdateDescriptionScript(description));

        const updated = await waitForEventEditExit(bgWindow, 4000);
        if (!updated) {
          logger.error('BackgroundEventDescUpdate', `Description save was not confirmed for event ${eventId}`);
          return { success: false, error: 'Google Calendar did not confirm description update' };
        }

        logger.info('BackgroundEventDescUpdate', `Description updated successfully for event ${eventId}`);
        return { success: true };
      } catch (err: any) {
        logger.error('BackgroundEventDescUpdate', 'Failed to update description: ' + err.message, err);
        return { success: false, error: err.message };
      } finally {
        if (!bgWindow.isDestroyed()) {
          bgWindow.destroy();
        }
      }
    });
  });

  ipcMain.handle('ensure-academic-calendars-background', async (event, calendarNames?: string[]) => {
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    return bgTaskQueue.enqueue(async () => {
      const namesToCreate = validateCalendarNames(calendarNames);

      for (const calName of namesToCreate) {
        // Prevent duplicate creation: check if calendar already exists in active mainWindow DOM
        let alreadyExists = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            alreadyExists = await mainWindow.webContents.executeJavaScript(buildCheckCalendarExistsScript(calName));
          } catch (_) {}
        }

        if (alreadyExists) {
          logger.info('EnsureAcademicCalendars', `Secondary calendar "${calName}" already exists. Skipping.`);
          continue;
        }

        const bgWindow = new BrowserWindow({
          show: false,
          width: 1024,
          height: 768,
          webPreferences: {
            session: customSession,
            backgroundThrottling: false,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
          }
        });

        const accountIndex = getActiveAccountIndex();
        try {
          await bgWindow.loadURL(`https://calendar.google.com/calendar/u/${accountIndex}/r/settings/createcalendar`);
          await bgWindow.webContents.executeJavaScript(buildCreateCalendarScript(calName));
        } catch (err: any) {
          logger.warn('EnsureAcademicCalendars', `Background creation note: ${err.message}`);
        } finally {
          if (!bgWindow.isDestroyed()) {
            bgWindow.destroy();
          }
        }
      }
      return { success: true };
    });
  });

  ipcMain.handle('take-debug-screenshot', async (event, filePath: string) => {
    if (!isDebugMode()) {
      return { success: false, error: 'Debug screenshots are disabled in production' };
    }
    if (!isAuthorizedIpcSender(event)) {
      return { success: false, error: 'Unauthorized IPC sender' };
    }
    const safePath = resolveSafeDebugScreenshotPath(filePath);
    if (!safePath) {
      return { success: false, error: 'Invalid or disallowed screenshot output path' };
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      const image = await mainWindow.webContents.capturePage();
      fs.mkdirSync(path.dirname(safePath), { recursive: true });
      fs.writeFileSync(safePath, image.toPNG());
      logger.info('Screenshot', `Captured window to ${safePath}`);
      return { success: true, filePath: safePath };
    }
    return { success: false, error: 'No main window' };
  });
}

export function createMainWindow(): BrowserWindow {
  const customSession = setupSession();
  setupBackgroundEventCreation(customSession);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 600,
    title: 'Cursa — Google Calendar',
    icon: path.join(__dirname, '../../assets/icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      session: customSession,
      preload: path.join(__dirname, '../preload/bundle.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });

  // Log all console output from renderer/preload
  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[Renderer L${level}] ${message} (${sourceId}:${line})`);
  });

  // Desktop Navigation: DevTools, History Back (Alt + Left / BrowserBack / Esc from eventedit)
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools();
    } else if (input.key === 'Escape' || (input.alt && input.key === 'ArrowLeft') || input.key === 'BrowserBack') {
      const currentUrl = mainWindow?.webContents.getURL() || '';
      if (currentUrl.includes('/r/eventedit') || currentUrl.includes('/eventedit')) {
        const accountIndex = getActiveAccountIndex();
        mainWindow?.loadURL(`https://calendar.google.com/calendar/u/${accountIndex}/r`);
      } else if (mainWindow?.webContents.canGoBack() && input.key !== 'Escape') {
        mainWindow.webContents.goBack();
      }
    }
  });

  // Handle hardware mouse back button
  (mainWindow as any).on('app-command', (_e: any, cmd: string) => {
    if (cmd === 'browser-backward') {
      const currentUrl = mainWindow?.webContents.getURL() || '';
      if (currentUrl.includes('/r/eventedit') || currentUrl.includes('/eventedit')) {
        const accountIndex = getActiveAccountIndex();
        mainWindow?.loadURL(`https://calendar.google.com/calendar/u/${accountIndex}/r`);
      } else if (mainWindow?.webContents.canGoBack()) {
        mainWindow.webContents.goBack();
      }
    }
  });

  let isAuthFlowActive = false;

  // Handle external links vs Google sign-in/calendar navigation
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsedUrl = new URL(url);
      const allowedHosts = [
        'calendar.google.com',
        'accounts.google.com',
        'myaccount.google.com',
        'workspace.google.com',
        'ogs.google.com',
        'content.googleapis.com'
      ];

      const isAllowed =
        parsedUrl.protocol === 'https:' &&
        allowedHosts.some(
          (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host)
        );

      if (isAllowed) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              session: customSession,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true
            }
          }
        };
      }

      // External links open safely in default OS browser
      if (isSafeExternalUrl(url)) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    } catch {
      return { action: 'deny' };
    }
  });

  mainWindow.webContents.on('will-redirect', (event, redirectUrl) => {
    try {
      const parsedUrl = new URL(redirectUrl);
      if (parsedUrl.hostname.includes('workspace.google.com')) {
        event.preventDefault();
        isAuthFlowActive = true;
        mainWindow?.loadURL(
          'https://accounts.google.com/ServiceLogin?service=cl&passive=1209600&continue=https://calendar.google.com/calendar/render'
        );
        return;
      }

      if (parsedUrl.hostname === 'accounts.google.com') {
        isAuthFlowActive = true;
      }

      const isGoogle = parsedUrl.protocol === 'https:' && isAllowedGoogleHost(parsedUrl.hostname);
      const isUniversitySso = isAuthFlowActive && parsedUrl.protocol === 'https:';

      if (!isGoogle && !isUniversitySso) {
        event.preventDefault();
        if (isSafeExternalUrl(redirectUrl)) {
          shell.openExternal(redirectUrl);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  const notifyCalendarLoaded = () => {
    const currentUrl = mainWindow?.webContents.getURL() || '';
    if (currentUrl.includes('workspace.google.com')) {
      isAuthFlowActive = true;
      mainWindow?.loadURL(
        'https://accounts.google.com/ServiceLogin?service=cl&passive=1209600&continue=https://calendar.google.com/calendar/render'
      );
    } else if (isTrustedCalendarOrigin(currentUrl)) {
      isAuthFlowActive = false;
      mainWindow?.webContents.send('init-custom-layer');
    } else if (currentUrl.startsWith('https://accounts.google.com')) {
      isAuthFlowActive = true;
    }
  };

  mainWindow.webContents.on('did-finish-load', notifyCalendarLoaded);
  mainWindow.webContents.on('did-navigate', notifyCalendarLoaded);
  mainWindow.webContents.on('did-navigate-in-page', notifyCalendarLoaded);

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      if (parsedUrl.hostname === 'accounts.google.com') {
        isAuthFlowActive = true;
      }

      const isGoogle = parsedUrl.protocol === 'https:' && isAllowedGoogleHost(parsedUrl.hostname);
      const isUniversitySso = isAuthFlowActive && parsedUrl.protocol === 'https:';

      if (!isGoogle && !isUniversitySso) {
        event.preventDefault();
        if (isSafeExternalUrl(navigationUrl)) {
          shell.openExternal(navigationUrl);
        }
        return;
      }

      // Detect Google account sign-out to clean session state [P1-03]
      if (parsedUrl.pathname.includes('/Logout') || parsedUrl.pathname.includes('/SignOut') || parsedUrl.pathname.includes('/accounts/Logout2')) {
        isAuthFlowActive = true;
        logger.info('Auth', 'Detected Google account sign-out navigation. Emitting session reset signal.');
        mainWindow?.webContents.send('user-logged-out');
      }
    } catch {
      event.preventDefault();
    }
  });

  mainWindow.loadURL(GOOGLE_CALENDAR_URL);

  mainWindow.on('close', (event) => {
    if (!getIsQuitting()) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    destroyTray();
  });

  setupTray(mainWindow);

  return mainWindow;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
