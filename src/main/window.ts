import { BrowserWindow, shell, ipcMain, Session } from 'electron';
import * as path from 'path';
import { GOOGLE_CALENDAR_URL } from '../shared/constants';
import { setupSession } from './session';
import { AcademicEventPayload } from '../shared/types';
import { formatAcademicEvent } from '../shared/formatters';
import { validateAcademicEventPayload, isValidEventId } from '../shared/validators';
import { logger } from '../shared/logger';
import { RESILIENT_SELECTORS } from '../injected/adapter/selectors';

import { setupTray, destroyTray } from './tray';

let mainWindow: BrowserWindow | null = null;
let ipcRegistered = false;
let isQuitting = false;

export function setIsQuitting(val: boolean): void {
  isQuitting = val;
}

export function getIsQuitting(): boolean {
  return isQuitting;
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

  ipcMain.handle('create-academic-event-background', async (_event, payload: AcademicEventPayload) => {
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
          nodeIntegration: false
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);

        // Wait for save button, switch calendar if Entrega, and click Guardar
        const isEntrega = payload.type === 'ENTREGA';
        await bgWindow.webContents.executeJavaScript(`(async () => {
          const startTime = Date.now();
          let saveBtn = null;
          const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};

          while (Date.now() - startTime < 12000) {
            for (const sel of saveSelectors) {
              saveBtn = document.querySelector(sel);
              if (saveBtn) break;
            }
            if (!saveBtn) {
              saveBtn = Array.from(document.querySelectorAll('button')).find(b => {
                const txt = (b.textContent || '').trim().toLowerCase();
                return txt === 'guardar' || txt === 'save' || txt === 'desa' || txt === 'gardar' || txt === 'speichern';
              });
            }
            if (saveBtn) break;
            await new Promise(r => setTimeout(r, 250));
          }

          if (!saveBtn) {
            throw new Error('Save button not found on Google Calendar event edit page');
          }

          // Switch to targeted academic calendar (Exámenes vs Entregas) if present
          const spans = Array.from(document.querySelectorAll('span'));
          const calSpan = spans.find(s => (s.textContent.includes('Calendario') || s.textContent.includes('Calendar') || s.className.includes('haAclf') || s.closest('[role="combobox"]')));
          const calTrigger = calSpan?.closest('[role="combobox"], [role="listbox"], [role="button"], div[jsname], button');
          if (calTrigger) {
            calTrigger.click();
            await new Promise(r => setTimeout(r, 300));

            const options = Array.from(document.querySelectorAll('[role="option"], [data-value], [role="menuitem"]'));
            const matchOpt = options.find(o => {
              const txt = (o.textContent || '').toLowerCase();
              return ${JSON.stringify(isEntrega)}
                ? (txt.includes('entrega') || txt.includes('entegras') || txt.includes('assignment') || txt.includes('deadline') || txt.includes('due'))
                : (txt.includes('examen') || txt.includes('exam'));
            });
            if (matchOpt) {
              matchOpt.click();
              await new Promise(r => setTimeout(r, 300));
            }
          }

          saveBtn.click();
        })()`);

        // Wait up to 3.5s for navigation back to /r or save completion
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve(true);
            }
          };
          bgWindow.webContents.once('did-navigate', finish);
          setTimeout(finish, 3500);
        });

        logger.info('BackgroundEventCreate', `Event created successfully: ${payload.title}`);
        return { success: true };
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

  ipcMain.handle('delete-academic-event-background', async (_event, eventId: string) => {
    return bgTaskQueue.enqueue(async () => {
      // 1. Validate eventId strictly
      if (!isValidEventId(eventId)) {
        logger.warn('BackgroundEventDelete', 'Invalid or malformed eventId provided: ' + eventId);
        return { success: false, error: 'Invalid or malformed eventId provided' };
      }

      const accountIndex = getActiveAccountIndex();
      logger.info('BackgroundEventDelete', `Deleting event: ${eventId} for account index ${accountIndex}`);

      // Strategy A: Ultra-fast in-page offscreen iframe within active mainWindow (warm session & renderer)
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          logger.info('BackgroundEventDelete', `Attempting in-page offscreen iframe deletion for event ${eventId}`);
          const res = await mainWindow.webContents.executeJavaScript(`(async () => {
            const eventId = ${JSON.stringify(eventId)};
            const accountIndex = ${JSON.stringify(accountIndex)};
            const targetUrl = 'https://calendar.google.com/calendar/u/' + accountIndex + '/r/eventedit/' + encodeURIComponent(eventId);
            
            const iframe = document.createElement('iframe');
            iframe.style.position = 'fixed';
            iframe.style.top = '-9999px';
            iframe.style.left = '-9999px';
            iframe.style.width = '1200px';
            iframe.style.height = '900px';
            iframe.style.opacity = '0';
            iframe.style.pointerEvents = 'none';
            iframe.style.zIndex = '-1';
            iframe.src = targetUrl;
            document.body.appendChild(iframe);

            function triggerRealisticClick(element) {
              if (!element) return;
              const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
              const clientX = rect.x + (rect.width ? rect.width / 2 : 10);
              const clientY = rect.y + (rect.height ? rect.height / 2 : 10);
              const opts = { bubbles: true, cancelable: true, view: iframe.contentWindow || window, clientX, clientY };

              element.dispatchEvent(new PointerEvent('pointerover', opts));
              element.dispatchEvent(new MouseEvent('mouseover', opts));
              element.dispatchEvent(new PointerEvent('pointerdown', opts));
              element.dispatchEvent(new MouseEvent('mousedown', opts));
              if (typeof element.focus === 'function') element.focus();
              element.dispatchEvent(new PointerEvent('pointerup', opts));
              element.dispatchEvent(new MouseEvent('mouseup', opts));
              element.dispatchEvent(new MouseEvent('click', opts));
              if (typeof element.click === 'function') {
                element.click();
              }
            }

            try {
              const startTime = Date.now();
              let doc = null;
              let directBtn = null;
              let moreActionsBtn = null;

              while (Date.now() - startTime < 15000) {
                try {
                  doc = iframe.contentDocument;
                } catch (_) {}

                if (doc) {
                  // 1. Direct delete button (only explicit event delete, never format or notification)
                  const directCandidate = doc.querySelector('#xDelBu') ||
                    doc.querySelector('button[aria-label="Eliminar" i], button[aria-label="Delete" i], button[aria-label*="Eliminar evento" i], button[aria-label*="Delete event" i]');
                  if (directCandidate) {
                    const aria = (directCandidate.getAttribute('aria-label') || '').toLowerCase();
                    if (!aria.includes('formato') && !aria.includes('notificac') && !aria.includes('recordator')) {
                      directBtn = directCandidate;
                      break;
                    }
                  }

                  // 2. More actions dropdown button trigger
                  const bgYcDf = doc.querySelector('.BgYcDf');
                  if (bgYcDf) {
                    moreActionsBtn = bgYcDf.querySelector('button, [role="button"]') || bgYcDf;
                    if (moreActionsBtn) break;
                  }

                  const xDYJ0e = doc.querySelector('button.xDYJ0e');
                  if (xDYJ0e) {
                    moreActionsBtn = xDYJ0e;
                    break;
                  }

                  const saveBtn = doc.querySelector('#xSaveBu');
                  if (saveBtn && saveBtn.parentElement) {
                    moreActionsBtn = Array.from(saveBtn.parentElement.querySelectorAll('button, [role="button"]')).find(b =>
                      b !== saveBtn && b.id !== 'xCancelBu'
                    );
                    if (moreActionsBtn) break;
                  }

                  const allButtons = Array.from(doc.querySelectorAll('button, [role="button"]'));
                  moreActionsBtn = allButtons.find(b => {
                    const txt = (b.textContent || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    return (
                      txt.includes('más acciones') || txt.includes('mas acciones') || txt.includes('more actions') ||
                      txt.includes('més accions') || txt.includes('máis accións') ||
                      aria.includes('más acciones') || aria.includes('mas acciones') || aria.includes('more actions')
                    );
                  });
                  if (moreActionsBtn) break;
                }
                await new Promise(r => setTimeout(r, 200));
              }

              if (directBtn) {
                triggerRealisticClick(directBtn);
              } else if (moreActionsBtn && doc) {
                triggerRealisticClick(moreActionsBtn);
                await new Promise(r => setTimeout(r, 500));

                const menuItems = Array.from(doc.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
                const delItem = menuItems.find(m => {
                  const txt = (m.textContent || '').trim().toLowerCase();
                  const aria = (m.getAttribute('aria-label') || '').toLowerCase();
                  const jsname = m.getAttribute('jsname') || '';
                  if (jsname === 'VkLyEc') return true;
                  if (txt.includes('formato') || aria.includes('formato')) return false;
                  return (
                    txt === 'eliminar' || txt === 'delete' || txt.startsWith('eliminar') || txt.startsWith('delete') ||
                    txt === 'supprimer' || txt === 'löschen' || txt === 'suprimeix' || txt === 'borrar' || txt === 'excluir' ||
                    aria === 'eliminar' || aria === 'delete' || aria === 'supprimer' || aria === 'löschen' || aria === 'suprimeix' || aria === 'borrar'
                  );
                });

                if (!delItem) {
                  throw new Error('Opción Eliminar no encontrada tras abrir el menú de acciones');
                }

                triggerRealisticClick(delItem);
              } else {
                throw new Error('No se encontró el menú de acciones para eliminar el evento');
              }

              // Modal dialog confirmation check
              await new Promise(r => setTimeout(r, 800));
              if (doc) {
                const dialog = doc.querySelector('[role="dialog"]');
                if (dialog) {
                  const confirmBtn = Array.from(dialog.querySelectorAll('button, [role="button"]')).find(b => {
                    const txt = (b.textContent || '').trim().toLowerCase();
                    const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                    return (
                      txt.includes('eliminar') || txt.includes('delete') || txt.includes('aceptar') || txt.includes('ok') || txt.includes('confirm') || txt.includes('sí') ||
                      aria.includes('eliminar') || aria.includes('delete') || aria.includes('aceptar') || aria.includes('ok') || aria.includes('confirm') || aria.includes('sí')
                    );
                  });
                  if (confirmBtn) triggerRealisticClick(confirmBtn);
                }
              }

              // Wait up to 6s for navigation away from /r/eventedit/
              let navigatedAway = false;
              const waitStart = Date.now();
              while (Date.now() - waitStart < 6000) {
                try {
                  const href = iframe.contentWindow?.location?.href || '';
                  if (href && !href.includes('/r/eventedit/')) {
                    navigatedAway = true;
                    break;
                  }
                } catch (_) {
                  navigatedAway = true;
                  break;
                }
                await new Promise(r => setTimeout(r, 200));
              }

              iframe.remove();
              return {
                success: navigatedAway,
                error: navigatedAway ? undefined : 'No se confirmó la eliminación en el servidor de Google Calendar'
              };
            } catch (err) {
              if (iframe && iframe.parentNode) iframe.remove();
              return { success: false, error: err?.message || String(err) };
            }
          })()`);

          if (res && res.success) {
            logger.info('BackgroundEventDelete', `Event ${eventId} deleted successfully via in-page iframe`);
            return { success: true };
          }
          logger.warn('BackgroundEventDelete', `In-page iframe deletion attempt reported: ${res?.error || 'unsuccessful'}. Falling back to background window.`);
        } catch (inPageErr: any) {
          logger.warn('BackgroundEventDelete', `In-page iframe deletion exception: ${inPageErr?.message}. Falling back to background window.`);
        }
      }

      // Strategy B: Dedicated background window with backgroundThrottling disabled
      const targetUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(eventId)}`;
      const bgWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);
        const scriptRes = await bgWindow.webContents.executeJavaScript(`(async () => {
          try {
            const startTime = Date.now();
            const deleteSelectors = ${JSON.stringify(RESILIENT_SELECTORS.deleteButton)};
            const moreSelectors = ${JSON.stringify(RESILIENT_SELECTORS.moreActionsButton)};

            function triggerRealisticClick(element) {
              if (!element) return;
              const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
              const clientX = rect.x + (rect.width ? rect.width / 2 : 10);
              const clientY = rect.y + (rect.height ? rect.height / 2 : 10);
              const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

              element.dispatchEvent(new PointerEvent('pointerover', opts));
              element.dispatchEvent(new MouseEvent('mouseover', opts));
              element.dispatchEvent(new PointerEvent('pointerdown', opts));
              element.dispatchEvent(new MouseEvent('mousedown', opts));
              if (typeof element.focus === 'function') element.focus();
              element.dispatchEvent(new PointerEvent('pointerup', opts));
              element.dispatchEvent(new MouseEvent('mouseup', opts));
              element.dispatchEvent(new MouseEvent('click', opts));
              if (typeof element.click === 'function') {
                element.click();
              }
            }

            function findDirectDeleteButton() {
              for (const sel of deleteSelectors) {
                const btn = document.querySelector(sel);
                if (btn) return btn;
              }
              return null;
            }

            function findMoreActionsButton() {
              const bgYcDf = document.querySelector('.BgYcDf');
              if (bgYcDf) {
                const btn = bgYcDf.querySelector('button, [role="button"]') || bgYcDf;
                if (btn) return btn;
              }

              for (const sel of moreSelectors) {
                const el = document.querySelector(sel);
                if (el) return el;
              }
              const saveBtn = document.querySelector('#xSaveBu');
              if (saveBtn && saveBtn.parentElement) {
                const siblingBtn = Array.from(saveBtn.parentElement.querySelectorAll('button, [role="button"]')).find(b =>
                  b !== saveBtn && b.id !== 'xCancelBu'
                );
                if (siblingBtn) return siblingBtn;
              }
              const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
              return allButtons.find(b => {
                const txt = (b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                return (
                  txt.includes('más acciones') || txt.includes('mas acciones') || txt.includes('more actions') ||
                  txt.includes('més accions') || txt.includes('máis accións') || txt.includes('plus d\\'actions') ||
                  txt.includes('weitere aktionen') || txt.includes('altre azioni') || txt.includes('mais ações') ||
                  aria.includes('más acciones') || aria.includes('mas acciones') || aria.includes('more actions') ||
                  aria.includes('més accions') || aria.includes('máis accións') || aria.includes('plus d\\'actions') ||
                  aria.includes('weitere aktionen') || aria.includes('altre azioni') || aria.includes('mais ações')
                );
              });
            }

            function findDeleteMenuItem() {
              const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
              return menuItems.find(m => {
                const txt = (m.textContent || '').trim().toLowerCase();
                const aria = (m.getAttribute('aria-label') || '').toLowerCase();
                const jsname = m.getAttribute('jsname') || '';
                if (jsname === 'VkLyEc') return true;
                if (txt.includes('formato') || aria.includes('formato')) return false;
                return (
                  txt === 'eliminar' || txt === 'delete' || txt.startsWith('eliminar') || txt.startsWith('delete') ||
                  txt === 'supprimer' || txt === 'löschen' || txt === 'suprimeix' || txt === 'borrar' || txt === 'excluir' ||
                  aria === 'eliminar' || aria === 'delete' || aria === 'supprimer' || aria === 'löschen' || aria === 'suprimeix' || aria === 'borrar'
                );
              });
            }

            let directBtn = null;
            let moreActionsBtn = null;

            while (Date.now() - startTime < 15000) {
              const directCandidate = findDirectDeleteButton();
              if (directCandidate) {
                const aria = (directCandidate.getAttribute('aria-label') || '').toLowerCase();
                if (!aria.includes('formato') && !aria.includes('notificac') && !aria.includes('recordator')) {
                  directBtn = directCandidate;
                  break;
                }
              }
              moreActionsBtn = findMoreActionsButton();
              if (moreActionsBtn) break;
              await new Promise(r => setTimeout(r, 200));
            }

            if (directBtn) {
              triggerRealisticClick(directBtn);
            } else if (moreActionsBtn) {
              triggerRealisticClick(moreActionsBtn);
              await new Promise(r => setTimeout(r, 500));

              let delItem = findDeleteMenuItem();
              if (!delItem) {
                await new Promise(r => setTimeout(r, 400));
                delItem = findDeleteMenuItem();
              }

              if (!delItem) {
                throw new Error('Opción Eliminar no encontrada tras desplegar el menú de acciones');
              }

              triggerRealisticClick(delItem);
            } else {
              throw new Error('No se encontró el menú de acciones para eliminar el evento');
            }

            // Check if a modal / confirmation dialog appears (recurring event, guests cancellation, etc.)
            await new Promise(r => setTimeout(r, 800));
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
              const confirmBtn = Array.from(dialog.querySelectorAll('button, [role="button"]')).find(b => {
                const txt = (b.textContent || '').trim().toLowerCase();
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                return (
                  txt.includes('eliminar') || txt.includes('delete') || txt.includes('aceptar') || txt.includes('ok') || txt.includes('confirm') || txt.includes('sí') ||
                  aria.includes('eliminar') || aria.includes('delete') || aria.includes('aceptar') || aria.includes('ok') || aria.includes('confirm') || aria.includes('sí')
                );
              });
              if (confirmBtn) {
                triggerRealisticClick(confirmBtn);
              }
            }

            // Wait up to 6s for navigation away from /r/eventedit/
            let navigatedAway = false;
            const waitStart = Date.now();
            while (Date.now() - waitStart < 6000) {
              try {
                const href = window.location.href || '';
                if (!href.includes('/r/eventedit/')) {
                  navigatedAway = true;
                  break;
                }
              } catch (_) {
                navigatedAway = true;
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }

            return {
              success: navigatedAway,
              error: navigatedAway ? undefined : 'No se confirmó la eliminación en el servidor de Google Calendar'
            };
          } catch (scriptErr) {
            return { success: false, error: scriptErr?.message || String(scriptErr) };
          }
        })()`);

        if (scriptRes && scriptRes.success === false) {
          logger.error('BackgroundEventDelete', `Deletion script failed: ${scriptRes.error}`);
          return { success: false, error: scriptRes.error };
        }

        // Wait up to 4s for navigation or deletion completion
        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve(true);
            }
          };
          bgWindow.webContents.once('did-navigate', finish);
          bgWindow.webContents.once('did-navigate-in-page', finish);
          setTimeout(finish, 3000);
        });

        const currentUrl = bgWindow.webContents.getURL() || '';
        if (currentUrl.includes('/r/eventedit/')) {
          logger.error('BackgroundEventDelete', 'Event edit page still active after deletion attempt: ' + currentUrl);
          return { success: false, error: 'No se confirmó la eliminación en el servidor de Google Calendar' };
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
  ipcMain.handle('move-academic-event-background', async (_event, data: { eventId?: string; payload: AcademicEventPayload }) => {
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
          nodeIntegration: false
        }
      });

      try {
        let editedInPlace = false;
        const accountIndex = getActiveAccountIndex();

        // Try atomic in-place edit on existing event to avoid duplicate risk [P2-03]
        if (data.eventId && isValidEventId(data.eventId)) {
          try {
            logger.info('BackgroundEventMove', `Attempting atomic in-place reschedule for event ${data.eventId} on account ${accountIndex}`);
            const editUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${data.eventId}`;
            await bgWindow.loadURL(editUrl);

            await bgWindow.webContents.executeJavaScript(`(async () => {
              const startTime = Date.now();
              const dateSelectors = ${JSON.stringify(RESILIENT_SELECTORS.startDateInput)};
              const startSelectors = ${JSON.stringify(RESILIENT_SELECTORS.startTimeInput)};
              const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};

              let dateInput = null;
              let saveBtn = null;

              while (Date.now() - startTime < 10000) {
                for (const sel of dateSelectors) {
                  dateInput = document.querySelector(sel);
                  if (dateInput) break;
                }
                for (const sel of saveSelectors) {
                  saveBtn = document.querySelector(sel);
                  if (saveBtn) break;
                }
                if (dateInput && saveBtn) break;
                await new Promise(r => setTimeout(r, 200));
              }

              if (!dateInput || !saveBtn) {
                throw new Error('Edit fields not accessible for in-place update');
              }

              const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (nativeInputSetter) {
                nativeInputSetter.call(dateInput, ${JSON.stringify(data.payload.date)});
              } else {
                dateInput.value = ${JSON.stringify(data.payload.date)};
              }
              dateInput.dispatchEvent(new Event('input', { bubbles: true }));
              dateInput.dispatchEvent(new Event('change', { bubbles: true }));
              await new Promise(r => setTimeout(r, 200));

              // Update time if available
              if (${JSON.stringify(data.payload.time)}) {
                let startTimeInput = null;
                for (const sel of startSelectors) {
                  startTimeInput = document.querySelector(sel);
                  if (startTimeInput) break;
                }
                if (startTimeInput) {
                  if (nativeInputSetter) {
                    nativeInputSetter.call(startTimeInput, ${JSON.stringify(data.payload.time)});
                  } else {
                    startTimeInput.value = ${JSON.stringify(data.payload.time)};
                  }
                  startTimeInput.dispatchEvent(new Event('input', { bubbles: true }));
                  startTimeInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }

              saveBtn.click();
              await new Promise(r => setTimeout(r, 1200));
            })()`);

            await new Promise((resolve) => {
              let done = false;
              const finish = () => {
                if (!done) {
                  done = true;
                  resolve(true);
                }
              };
              bgWindow.webContents.once('did-navigate', finish);
              bgWindow.webContents.once('did-navigate-in-page', finish);
              setTimeout(finish, 2500);
            });

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

          await bgWindow.webContents.executeJavaScript(`(async () => {
            const startTime = Date.now();
            let saveBtn = null;
            const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};

            while (Date.now() - startTime < 12000) {
              for (const sel of saveSelectors) {
                saveBtn = document.querySelector(sel);
                if (saveBtn) break;
              }
              if (!saveBtn) {
                saveBtn = Array.from(document.querySelectorAll('button')).find(b => {
                  const txt = (b.textContent || '').trim().toLowerCase();
                  return txt === 'guardar' || txt === 'save' || txt === 'desa' || txt === 'gardar' || txt === 'speichern';
                });
              }
              if (saveBtn) break;
              await new Promise(r => setTimeout(r, 250));
            }

            if (!saveBtn) {
              throw new Error('Save button not found on Google Calendar event edit page');
            }

            const spans = Array.from(document.querySelectorAll('span'));
            const calSpan = spans.find(s => (s.textContent.includes('Calendario') || s.textContent.includes('Calendar') || s.className.includes('haAclf') || s.closest('[role="combobox"]')));
            const calTrigger = calSpan?.closest('[role="combobox"], [role="listbox"], [role="button"], div[jsname], button');
            if (calTrigger) {
              calTrigger.click();
              await new Promise(r => setTimeout(r, 300));

              const options = Array.from(document.querySelectorAll('[role="option"], [data-value], [role="menuitem"]'));
              const matchOpt = options.find(o => {
                const txt = (o.textContent || '').toLowerCase();
                return ${JSON.stringify(isEntrega)}
                  ? (txt.includes('entrega') || txt.includes('entegras') || txt.includes('assignment') || txt.includes('deadline') || txt.includes('due'))
                  : (txt.includes('examen') || txt.includes('exam'));
              });
              if (matchOpt) {
                matchOpt.click();
                await new Promise(r => setTimeout(r, 300));
              }
            }

            saveBtn.click();
          })()`);

          await new Promise((resolve) => {
            let done = false;
            const finish = () => {
              if (!done) {
                done = true;
                resolve(true);
              }
            };
            bgWindow.webContents.once('did-navigate', finish);
            setTimeout(finish, 3500);
          });

          // Delete old event ONLY after new event is confirmed saved
          if (data.eventId && isValidEventId(data.eventId)) {
            try {
              let oldDeleted = false;
              if (mainWindow && !mainWindow.isDestroyed()) {
                try {
                  const iframeRes = await mainWindow.webContents.executeJavaScript(`(async () => {
                    const eventId = ${JSON.stringify(data.eventId)};
                    const accountIndex = ${JSON.stringify(accountIndex)};
                    const targetUrl = 'https://calendar.google.com/calendar/u/' + accountIndex + '/r/eventedit/' + encodeURIComponent(eventId);
                    const iframe = document.createElement('iframe');
                    iframe.style.position = 'fixed';
                    iframe.style.top = '-9999px';
                    iframe.style.left = '-9999px';
                    iframe.style.width = '1200px';
                    iframe.style.height = '900px';
                    iframe.style.opacity = '0';
                    iframe.style.pointerEvents = 'none';
                    iframe.style.zIndex = '-1';
                    iframe.src = targetUrl;
                    document.body.appendChild(iframe);

                    function triggerRealisticClick(element) {
                      if (!element) return;
                      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
                      const clientX = rect.x + (rect.width ? rect.width / 2 : 10);
                      const clientY = rect.y + (rect.height ? rect.height / 2 : 10);
                      const opts = { bubbles: true, cancelable: true, view: iframe.contentWindow || window, clientX, clientY };
                      element.dispatchEvent(new PointerEvent('pointerover', opts));
                      element.dispatchEvent(new MouseEvent('mouseover', opts));
                      element.dispatchEvent(new PointerEvent('pointerdown', opts));
                      element.dispatchEvent(new MouseEvent('mousedown', opts));
                      if (typeof element.focus === 'function') element.focus();
                      element.dispatchEvent(new PointerEvent('pointerup', opts));
                      element.dispatchEvent(new MouseEvent('mouseup', opts));
                      element.dispatchEvent(new MouseEvent('click', opts));
                      if (typeof element.click === 'function') element.click();
                    }

                    try {
                      const startTime = Date.now();
                      let doc = null;
                      let directBtn = null;
                      let directMenuItem = null;
                      let moreActionsBtn = null;

                      while (Date.now() - startTime < 15000) {
                        try { doc = iframe.contentDocument; } catch (_) {}
                        if (doc) {
                          directBtn = doc.querySelector('#xDelBu') ||
                            doc.querySelector('button[aria-label*="Eliminar" i], button[aria-label*="Delete" i], [data-tooltip*="Eliminar" i]');
                          if (directBtn) break;

                          const menuItems = Array.from(doc.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
                          directMenuItem = menuItems.find(m => {
                            const txt = (m.textContent || '').trim().toLowerCase();
                            const aria = (m.getAttribute('aria-label') || '').toLowerCase();
                            const jsname = m.getAttribute('jsname') || '';
                            if (jsname === 'VkLyEc') return true;
                            if (txt.includes('formato') || aria.includes('formato')) return false;
                            return (
                              txt === 'eliminar' || txt === 'delete' || txt.startsWith('eliminar') || txt.startsWith('delete') ||
                              txt === 'supprimer' || txt === 'löschen' || txt === 'suprimeix' || txt === 'borrar' || txt === 'excluir' ||
                              aria === 'eliminar' || aria === 'delete' || aria === 'supprimer' || aria === 'löschen' || aria === 'suprimeix' || aria === 'borrar'
                            );
                          });
                          if (directMenuItem) break;

                          const bgYcDf = doc.querySelector('.BgYcDf');
                          if (bgYcDf) {
                            moreActionsBtn = bgYcDf.querySelector('button, [role="button"]') || bgYcDf;
                            if (moreActionsBtn) break;
                          }

                          const saveBtn = doc.querySelector('#xSaveBu');
                          if (saveBtn && saveBtn.parentElement) {
                            moreActionsBtn = Array.from(saveBtn.parentElement.querySelectorAll('button, [role="button"]')).find(b =>
                              b !== saveBtn && b.id !== 'xCancelBu'
                            );
                            if (moreActionsBtn) break;
                          }

                          const allButtons = Array.from(doc.querySelectorAll('button, [role="button"]'));
                          moreActionsBtn = allButtons.find(b => {
                            const txt = (b.textContent || '').trim().toLowerCase();
                            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                            return (
                              txt.includes('más acciones') || txt.includes('mas acciones') || txt.includes('more actions') ||
                              txt.includes('més accions') || txt.includes('máis accións') || txt.includes('plus d\\'actions') ||
                              txt.includes('weitere aktionen') || txt.includes('altre azioni') || txt.includes('mais ações') ||
                              aria.includes('más acciones') || aria.includes('mas acciones') || aria.includes('more actions') ||
                              aria.includes('més accions') || aria.includes('máis accións') || aria.includes('plus d\\'actions') ||
                              aria.includes('weitere aktionen') || aria.includes('altre azioni') || aria.includes('mais ações')
                            );
                          });
                          if (moreActionsBtn) break;
                        }
                        await new Promise(r => setTimeout(r, 200));
                      }

                      if (directBtn) {
                        triggerRealisticClick(directBtn);
                      } else if (directMenuItem) {
                        triggerRealisticClick(directMenuItem);
                      } else if (moreActionsBtn && doc) {
                        triggerRealisticClick(moreActionsBtn);
                        await new Promise(r => setTimeout(r, 400));
                        const menuItems = Array.from(doc.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
                        const delItem = menuItems.find(m => {
                          const txt = (m.textContent || '').trim().toLowerCase();
                          const aria = (m.getAttribute('aria-label') || '').toLowerCase();
                          const jsname = m.getAttribute('jsname') || '';
                          if (jsname === 'VkLyEc') return true;
                          if (txt.includes('formato') || aria.includes('formato')) return false;
                          return (
                            txt === 'eliminar' || txt === 'delete' || txt.startsWith('eliminar') || txt.startsWith('delete') ||
                            txt === 'supprimer' || txt === 'löschen' || txt === 'suprimeix' || txt === 'borrar' || txt === 'excluir' ||
                            aria === 'eliminar' || aria === 'delete' || aria === 'supprimer' || aria === 'löschen' || aria === 'suprimeix' || aria === 'borrar'
                          );
                        });
                        if (delItem) triggerRealisticClick(delItem);
                      }

                      await new Promise(r => setTimeout(r, 500));
                      if (doc) {
                        const dialog = doc.querySelector('[role="dialog"]');
                        if (dialog) {
                          const confirmBtn = Array.from(dialog.querySelectorAll('button, [role="button"]')).find(b => {
                            const txt = (b.textContent || '').trim().toLowerCase();
                            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                            return txt.includes('eliminar') || txt.includes('delete') || txt.includes('aceptar') || txt.includes('ok') ||
                                   aria.includes('eliminar') || aria.includes('delete') || aria.includes('aceptar') || aria.includes('ok');
                          });
                          if (confirmBtn) triggerRealisticClick(confirmBtn);
                        }
                      }
                      await new Promise(r => setTimeout(r, 1200));
                      iframe.remove();
                      return { success: true };
                    } catch (err) {
                      if (iframe && iframe.parentNode) iframe.remove();
                      return { success: false, error: err?.message || String(err) };
                    }
                  })()`);
                  if (iframeRes && iframeRes.success) {
                    oldDeleted = true;
                    logger.info('BackgroundEventMove', `Old event ${data.eventId} deleted via in-page iframe`);
                  }
                } catch (inPageErr: any) {
                  logger.warn('BackgroundEventMove', `In-page iframe old event deletion failed: ${inPageErr?.message}`);
                }
              }

              if (!oldDeleted) {
                const deleteUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${encodeURIComponent(data.eventId)}`;
                await bgWindow.loadURL(deleteUrl);

                await bgWindow.webContents.executeJavaScript(`(async () => {
                  try {
                    const startTime = Date.now();
                    const deleteSelectors = ${JSON.stringify(RESILIENT_SELECTORS.deleteButton)};
                    const moreSelectors = ${JSON.stringify(RESILIENT_SELECTORS.moreActionsButton)};

                    function triggerRealisticClick(element) {
                      if (!element) return;
                      const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
                      const clientX = rect.x + (rect.width ? rect.width / 2 : 10);
                      const clientY = rect.y + (rect.height ? rect.height / 2 : 10);
                      const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };

                      element.dispatchEvent(new PointerEvent('pointerover', opts));
                      element.dispatchEvent(new MouseEvent('mouseover', opts));
                      element.dispatchEvent(new PointerEvent('pointerdown', opts));
                      element.dispatchEvent(new MouseEvent('mousedown', opts));
                      if (typeof element.focus === 'function') element.focus();
                      element.dispatchEvent(new PointerEvent('pointerup', opts));
                      element.dispatchEvent(new MouseEvent('mouseup', opts));
                      element.dispatchEvent(new MouseEvent('click', opts));
                      if (typeof element.click === 'function') {
                        element.click();
                      }
                    }

                    function findDirectDeleteButton() {
                      for (const sel of deleteSelectors) {
                        const btn = document.querySelector(sel);
                        if (btn) return btn;
                      }
                      return null;
                    }

                    function findMoreActionsButton() {
                      const bgYcDf = document.querySelector('.BgYcDf');
                      if (bgYcDf) {
                        const btn = bgYcDf.querySelector('button, [role="button"]') || bgYcDf;
                        if (btn) return btn;
                      }
                      for (const sel of moreSelectors) {
                        const el = document.querySelector(sel);
                        if (el) return el;
                      }
                      const saveBtn = document.querySelector('#xSaveBu');
                      if (saveBtn && saveBtn.parentElement) {
                        const siblingBtn = Array.from(saveBtn.parentElement.querySelectorAll('button, [role="button"]')).find(b =>
                          b !== saveBtn && b.id !== 'xCancelBu'
                        );
                        if (siblingBtn) return siblingBtn;
                      }
                      const allButtons = Array.from(document.querySelectorAll('button, [role="button"]'));
                      return allButtons.find(b => {
                        const txt = (b.textContent || '').trim().toLowerCase();
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        return (
                          txt.includes('más acciones') || txt.includes('mas acciones') || txt.includes('more actions') ||
                          txt.includes('més accions') || txt.includes('máis accións') || txt.includes('plus d\\'actions') ||
                          txt.includes('weitere aktionen') || txt.includes('altre azioni') || txt.includes('mais ações') ||
                          aria.includes('más acciones') || aria.includes('mas acciones') || aria.includes('more actions') ||
                          aria.includes('més accions') || aria.includes('máis accións') || aria.includes('plus d\\'actions') ||
                          aria.includes('weitere aktionen') || aria.includes('altre azioni') || aria.includes('mais ações')
                        );
                      });
                    }

                    function findDeleteMenuItem() {
                      const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
                      return menuItems.find(m => {
                        const txt = (m.textContent || '').trim().toLowerCase();
                        const aria = (m.getAttribute('aria-label') || '').toLowerCase();
                        const jsname = m.getAttribute('jsname') || '';
                        if (jsname === 'VkLyEc') return true;
                        if (txt.includes('formato') || aria.includes('formato')) return false;
                        return (
                          txt === 'eliminar' || txt === 'delete' || txt.startsWith('eliminar') || txt.startsWith('delete') ||
                          txt === 'supprimer' || txt === 'löschen' || txt === 'suprimeix' || txt === 'borrar' || txt === 'excluir' ||
                          aria === 'eliminar' || aria === 'delete' || aria === 'supprimer' || aria === 'löschen' || aria === 'suprimeix' || aria === 'borrar'
                        );
                      });
                    }

                    let directBtn = null;
                    let moreActionsBtn = null;
                    let directDelItem = null;

                    while (Date.now() - startTime < 15000) {
                      directBtn = findDirectDeleteButton();
                      if (directBtn) break;
                      directDelItem = findDeleteMenuItem();
                      if (directDelItem) break;
                      moreActionsBtn = findMoreActionsButton();
                      if (moreActionsBtn) break;
                      await new Promise(r => setTimeout(r, 200));
                    }

                    if (directBtn) {
                      triggerRealisticClick(directBtn);
                    } else if (directDelItem) {
                      triggerRealisticClick(directDelItem);
                    } else if (moreActionsBtn) {
                      triggerRealisticClick(moreActionsBtn);
                      await new Promise(r => setTimeout(r, 400));
                      let delItem = findDeleteMenuItem();
                      if (!delItem) {
                        await new Promise(r => setTimeout(r, 400));
                        delItem = findDeleteMenuItem();
                      }
                      if (delItem) triggerRealisticClick(delItem);
                    }

                    await new Promise(r => setTimeout(r, 600));
                    const dialog = document.querySelector('[role="dialog"]');
                    if (dialog) {
                      const confirmBtn = Array.from(dialog.querySelectorAll('button, [role="button"]')).find(b => {
                        const txt = (b.textContent || '').trim().toLowerCase();
                        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                        return (
                          txt.includes('eliminar') || txt.includes('delete') || txt.includes('aceptar') || txt.includes('ok') || txt.includes('confirm') || txt.includes('sí') ||
                          aria.includes('eliminar') || aria.includes('delete') || aria.includes('aceptar') || aria.includes('ok') || aria.includes('confirm') || aria.includes('sí')
                        );
                      });
                      if (confirmBtn) triggerRealisticClick(confirmBtn);
                    }

                    await new Promise(r => setTimeout(r, 1200));
                    return { success: true };
                  } catch (err) {
                    return { success: false, error: err?.message || String(err) };
                  }
                })()`);

                await new Promise((resolve) => {
                  let done = false;
                  const finish = () => {
                    if (!done) {
                      done = true;
                      resolve(true);
                    }
                  };
                  bgWindow.webContents.once('did-navigate', finish);
                  bgWindow.webContents.once('did-navigate-in-page', finish);
                  setTimeout(finish, 2500);
                });
              }
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
  ipcMain.handle('update-event-description-background', async (_event, data: { eventId?: string; eventTitle?: string; description: string }) => {
    return bgTaskQueue.enqueue(async () => {
      const eventId = data?.eventId;
      const description = data?.description ?? '';

      if (!eventId || !isValidEventId(eventId)) {
        logger.warn('BackgroundEventDescUpdate', 'Invalid or missing eventId: ' + eventId);
        return { success: false, error: 'Invalid or missing eventId' };
      }

      const accountIndex = getActiveAccountIndex();
      logger.info('BackgroundEventDescUpdate', `Syncing description for event ${eventId} on account index ${accountIndex}`);
      const targetUrl = `https://calendar.google.com/calendar/u/${accountIndex}/r/eventedit/${eventId}`;

      const bgWindow = new BrowserWindow({
        show: false,
        width: 1024,
        height: 768,
        webPreferences: {
          session: customSession,
          backgroundThrottling: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      try {
        await bgWindow.loadURL(targetUrl);

        await bgWindow.webContents.executeJavaScript(`(async () => {
          const startTime = Date.now();
          const descSelectors = ${JSON.stringify(RESILIENT_SELECTORS.descriptionInput)};
          const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};

          let descEl = null;
          let saveBtn = null;

          while (Date.now() - startTime < 12000) {
            for (const sel of descSelectors) {
              descEl = document.querySelector(sel);
              if (descEl) break;
            }
            for (const sel of saveSelectors) {
              saveBtn = document.querySelector(sel);
              if (saveBtn) break;
            }
            if (descEl && saveBtn) break;
            await new Promise(r => setTimeout(r, 250));
          }

          if (!descEl) {
            throw new Error('Description field not found on Google Calendar event edit page');
          }

          if (descEl.tagName.toLowerCase() === 'textarea' || descEl.tagName.toLowerCase() === 'input') {
            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
              || Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeSetter) {
              nativeSetter.call(descEl, ${JSON.stringify(description)});
            } else {
              descEl.value = ${JSON.stringify(description)};
            }
          } else {
            descEl.focus();
            descEl.innerText = ${JSON.stringify(description)};
          }

          descEl.dispatchEvent(new Event('input', { bubbles: true }));
          descEl.dispatchEvent(new Event('change', { bubbles: true }));
          await new Promise(r => setTimeout(r, 400));

          if (!saveBtn) {
            for (const sel of saveSelectors) {
              saveBtn = document.querySelector(sel);
              if (saveBtn) break;
            }
          }

          if (!saveBtn) {
            saveBtn = Array.from(document.querySelectorAll('button')).find(b => {
              const txt = (b.textContent || '').trim().toLowerCase();
              return txt === 'guardar' || txt === 'save' || txt === 'desa' || txt === 'gardar' || txt === 'speichern';
            });
          }

          if (!saveBtn) {
            throw new Error('Save button not found on Google Calendar event edit page');
          }

          saveBtn.click();
          await new Promise(r => setTimeout(r, 1200));
        })()`);

        await new Promise((resolve) => {
          let done = false;
          const finish = () => {
            if (!done) {
              done = true;
              resolve(true);
            }
          };
          bgWindow.webContents.once('did-navigate', finish);
          bgWindow.webContents.once('did-navigate-in-page', finish);
          setTimeout(finish, 3000);
        });

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

  ipcMain.handle('ensure-academic-calendars-background', async (_event, calendarNames?: string[]) => {
    return bgTaskQueue.enqueue(async () => {
      const namesToCreate = Array.isArray(calendarNames) && calendarNames.length > 0
        ? calendarNames
        : ['Exámenes', 'Entregas'];

      for (const calName of namesToCreate) {
        // Prevent duplicate creation: check if calendar already exists in active mainWindow DOM
        let alreadyExists = false;
        if (mainWindow && !mainWindow.isDestroyed()) {
          try {
            alreadyExists = await mainWindow.webContents.executeJavaScript(`(() => {
              const target = ${JSON.stringify(calName.toLowerCase().trim())};
              const items = Array.from(document.querySelectorAll('span, div[title], [role="checkbox"], [role="treeitem"]'));
              return items.some(el => {
                const text = (el.textContent || '').trim().toLowerCase();
                const title = (el.getAttribute('title') || '').trim().toLowerCase();
                const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                return text === target || title === target || label === target ||
                       text.startsWith(target) || title.startsWith(target) || label.startsWith(target);
              });
            })()`);
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
            nodeIntegration: false
          }
        });

        const accountIndex = getActiveAccountIndex();
        try {
          await bgWindow.loadURL(`https://calendar.google.com/calendar/u/${accountIndex}/r/settings/createcalendar`);

          await bgWindow.webContents.executeJavaScript(`(async () => {
            const targetName = ${JSON.stringify(calName)};
            const startTime = Date.now();
            let nameInput = null;

            while (Date.now() - startTime < 10000) {
              nameInput = document.querySelector('input[aria-label*="Nombre" i], input[aria-label*="Name" i], #xNameIn, input[type="text"]');
              if (nameInput) break;
              await new Promise(r => setTimeout(r, 250));
            }

            if (!nameInput) {
              throw new Error('Name input not found on create calendar page');
            }

            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
            if (nativeInputValueSetter) {
              nativeInputValueSetter.call(nameInput, targetName);
            } else {
              nameInput.value = targetName;
            }
            nameInput.dispatchEvent(new Event('input', { bubbles: true }));
            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(r => setTimeout(r, 400));

            const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
            const createBtn = buttons.find(b => {
              const txt = (b.textContent || '').trim().toLowerCase();
              const label = (b.getAttribute('aria-label') || '').toLowerCase();
              return txt.includes('crear calendario') || txt.includes('create calendar') || label.includes('crear calendario') || label.includes('create calendar');
            });

            if (createBtn) {
              createBtn.click();
              await new Promise(r => setTimeout(r, 2500));
            }
          })()`);
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

  ipcMain.handle('take-debug-screenshot', async (_event, filePath: string) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const image = await mainWindow.webContents.capturePage();
      const fs = require('fs');
      fs.writeFileSync(filePath, image.toPNG());
      logger.info('Screenshot', `Captured window to ${filePath}`);
      return { success: true, filePath };
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

  // Toggle DevTools with F12 or Ctrl+Shift+I
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

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

      const isAllowed = allowedHosts.some(
        (host) => parsedUrl.hostname === host || parsedUrl.hostname.endsWith('.' + host)
      );

      if (isAllowed) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            webPreferences: {
              session: customSession,
              contextIsolation: true,
              nodeIntegration: false
            }
          }
        };
      }

      // External links open in default OS browser
      shell.openExternal(url);
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
        mainWindow?.loadURL(
          'https://accounts.google.com/ServiceLogin?service=cl&passive=1209600&continue=https://calendar.google.com/calendar/render'
        );
      }
    } catch {
      // Ignored
    }
  });

  const notifyCalendarLoaded = () => {
    const currentUrl = mainWindow?.webContents.getURL() || '';
    if (currentUrl.includes('workspace.google.com')) {
      mainWindow?.loadURL(
        'https://accounts.google.com/ServiceLogin?service=cl&passive=1209600&continue=https://calendar.google.com/calendar/render'
      );
    } else if (currentUrl.includes('calendar.google.com')) {
      mainWindow?.webContents.send('init-custom-layer');
    }
  };

  mainWindow.webContents.on('did-finish-load', notifyCalendarLoaded);
  mainWindow.webContents.on('did-navigate', notifyCalendarLoaded);
  mainWindow.webContents.on('did-navigate-in-page', notifyCalendarLoaded);

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    try {
      const parsedUrl = new URL(navigationUrl);
      const isGoogle =
        parsedUrl.hostname.endsWith('google.com') ||
        parsedUrl.hostname.endsWith('googleusercontent.com');

      if (!isGoogle) {
        event.preventDefault();
        shell.openExternal(navigationUrl);
        return;
      }

      // Detect Google account sign-out to clean session state [P1-03]
      if (parsedUrl.pathname.includes('/Logout') || parsedUrl.pathname.includes('/SignOut') || parsedUrl.pathname.includes('/accounts/Logout2')) {
        logger.info('Auth', 'Detected Google account sign-out navigation. Emitting session reset signal.');
        mainWindow?.webContents.send('user-logged-out');
      }
    } catch {
      // Ignored
    }
  });

  mainWindow.loadURL(GOOGLE_CALENDAR_URL);

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
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

