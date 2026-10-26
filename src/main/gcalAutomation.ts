/**
 * Google Calendar Background Automation Scripts
 * Centralizes DOM scraping, click simulation, and element interaction scripts
 * executed via Electron's webContents.executeJavaScript in headless windows or iframes.
 */

import { RESILIENT_SELECTORS } from '../injected/adapter/selectors';

/**
 * Common script fragment providing human-like pointer and mouse events
 * to trigger Google Calendar's closure-compiler and Material event listeners reliably.
 */
const REALISTIC_CLICK_FUNCTION = `
function triggerRealisticClick(element, targetWindow) {
  if (!element) return;
  const win = targetWindow || window;
  const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
  const clientX = rect.x + (rect.width ? rect.width / 2 : 10);
  const clientY = rect.y + (rect.height ? rect.height / 2 : 10);
  const opts = { bubbles: true, cancelable: true, view: win, clientX, clientY };

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
`;

/**
 * Common helper to locate the delete menu item across multilingual variants.
 */
const FIND_DELETE_MENU_ITEM_FUNCTION = `
function findDeleteMenuItemInDoc(doc) {
  const menuItems = Array.from(doc.querySelectorAll('[role="menuitem"], .goog-menuitem, .JAPqpe, li[jsname="VkLyEc"], [role="menu"] li, li'));
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
`;

/**
 * Common helper to locate the More Actions button trigger across multilingual variants.
 */
const FIND_MORE_ACTIONS_BUTTON_FUNCTION = `
function findMoreActionsButtonInDoc(doc, moreSelectors) {
  const bgYcDf = doc.querySelector('.BgYcDf');
  if (bgYcDf) {
    const btn = bgYcDf.querySelector('button, [role="button"]') || bgYcDf;
    if (btn) return btn;
  }
  for (const sel of moreSelectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  const saveBtn = doc.querySelector('#xSaveBu');
  if (saveBtn && saveBtn.parentElement) {
    const siblingBtn = Array.from(saveBtn.parentElement.querySelectorAll('button, [role="button"]')).find(b =>
      b !== saveBtn && b.id !== 'xCancelBu'
    );
    if (siblingBtn) return siblingBtn;
  }
  const allButtons = Array.from(doc.querySelectorAll('button, [role="button"]'));
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
`;

/**
 * Common helper to locate direct delete button across multilingual variants.
 */
const FIND_DIRECT_DELETE_BUTTON_FUNCTION = `
function findDirectDeleteButtonInDoc(doc, deleteSelectors) {
  for (const sel of deleteSelectors) {
    const btn = doc.querySelector(sel);
    if (btn) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (!aria.includes('formato') && !aria.includes('notificac') && !aria.includes('recordator')) {
        return btn;
      }
    }
  }
  return null;
}
`;

/**
 * Builds the script for saving an event and routing to target calendar.
 */
export function buildSaveEventScript(isEntrega: boolean): string {
  return `(async () => {
    ${REALISTIC_CLICK_FUNCTION}
    const norm = (str) => (str || '')
      .normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '')
      .toLowerCase()
      .trim();

    const startTime = Date.now();
    let saveBtn = null;
    const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};
    const calSelectors = ${JSON.stringify(RESILIENT_SELECTORS.calendarDropdownTrigger)};

    while (Date.now() - startTime < 12000) {
      for (const sel of saveSelectors) {
        saveBtn = document.querySelector(sel);
        if (saveBtn) break;
      }
      if (!saveBtn) {
        saveBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
          const txt = norm(b.textContent);
          return txt === 'guardar' || txt === 'save' || txt === 'desa' || txt === 'gardar' || txt === 'speichern' || txt === 'enregistrer';
        });
      }
      if (saveBtn) break;
      await new Promise(r => setTimeout(r, 200));
    }

    if (!saveBtn) {
      throw new Error('Save button not found on Google Calendar event edit page');
    }

    // Locate the Calendar dropdown combobox/listbox accurately (excluding Recurrence / Visibility / Notification comboboxes)
    let calTrigger = null;
    const explicitCalSelectors = [
      '#xCalSel [role="combobox"]',
      '#xCalSel [role="listbox"]',
      '#xCalSel [role="button"]',
      '#xCalSel',
      ...calSelectors,
      '[data-key="calendar"] [role="combobox"]',
      '[data-key="calendar"] [role="listbox"]'
    ];
    for (const sel of explicitCalSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        calTrigger = el.matches('[role="combobox"], [role="listbox"], [role="button"], button')
          ? el
          : (el.querySelector('[role="combobox"], [role="listbox"], [role="button"], button') || el);
        break;
      }
    }

    if (!calTrigger) {
      const comboboxes = Array.from(document.querySelectorAll('[role="combobox"], [role="listbox"]'));
      calTrigger = comboboxes.find(cb => {
        const aria = norm(cb.getAttribute('aria-label'));
        return aria.includes('calendario') || aria.includes('calendar') || aria.includes('calendari');
      }) || comboboxes.find(cb => {
        const aria = norm(cb.getAttribute('aria-label'));
        const txt = norm(cb.textContent);
        const combined = aria + ' ' + txt;
        const isNonCalendarCombo = /repite|repeat|visibilidad|visibility|disponible|busy|free|minut|hora|hour|dia|day|semana|week|notificac|correo|email|zona horaria|time zone/.test(combined);
        return !isNonCalendarCombo && txt.length > 0;
      }) || null;
    }

    let selectedAcademicCalendar = false;
    const matchesTargetType = (rawText) => {
      const t = norm(rawText);
      return ${JSON.stringify(isEntrega)}
        ? (t.includes('entrega') || t.includes('entegras') || t.includes('assignment') || t.includes('deadline') || t.includes('due') || t.includes('devoir'))
        : (t.includes('examen') || t.includes('exam') || t.includes('parcial') || t.includes('control') || t.includes('klausur') || t.includes('prufung'));
    };
    const matchesAnyAcademic = (rawText) => {
      const t = norm(rawText);
      return /examen|exam|entrega|entegra|assignment|deadline|parcial|academ/.test(t);
    };

    if (calTrigger) {
      if (matchesTargetType(calTrigger.textContent)) {
        selectedAcademicCalendar = true;
      } else {
        triggerRealisticClick(calTrigger, window);

        let options = [];
        const optPollStart = Date.now();
        while (Date.now() - optPollStart < 1500) {
          options = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"], li[data-value]')).filter(o => {
            const rect = o.getBoundingClientRect ? o.getBoundingClientRect() : { width: 1, height: 1 };
            return rect.width > 0 && rect.height > 0 && norm(o.textContent).length > 0;
          });
          if (options.length > 1) break;
          await new Promise(r => setTimeout(r, 120));
        }

        const matchOpt = options.find(o => matchesTargetType(o.textContent))
          || options.find(o => matchesAnyAcademic(o.textContent));

        if (matchOpt) {
          triggerRealisticClick(matchOpt, window);
          selectedAcademicCalendar = true;
          await new Promise(r => setTimeout(r, 350));
        } else {
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
          await new Promise(r => setTimeout(r, 150));
        }
      }
    }

    await new Promise(r => setTimeout(r, 150));
    triggerRealisticClick(saveBtn, window);
    return { selectedAcademicCalendar };
  })()`;
}

/**
 * Builds the script for dedicated background window event deletion.
 */
export function buildDeleteEventWindowScript(): string {
  return `(async () => {
    try {
      const startTime = Date.now();
      const deleteSelectors = ${JSON.stringify(RESILIENT_SELECTORS.deleteButton)};
      const moreSelectors = ${JSON.stringify(RESILIENT_SELECTORS.moreActionsButton)};

      ${REALISTIC_CLICK_FUNCTION}
      ${FIND_DELETE_MENU_ITEM_FUNCTION}
      ${FIND_MORE_ACTIONS_BUTTON_FUNCTION}
      ${FIND_DIRECT_DELETE_BUTTON_FUNCTION}

      let directBtn = null;
      let moreActionsBtn = null;

      while (Date.now() - startTime < 12000) {
        directBtn = findDirectDeleteButtonInDoc(document, deleteSelectors);
        if (directBtn) break;

        moreActionsBtn = findMoreActionsButtonInDoc(document, moreSelectors);
        if (moreActionsBtn) break;

        await new Promise(r => setTimeout(r, 200));
      }

      if (directBtn) {
        triggerRealisticClick(directBtn, window);
      } else if (moreActionsBtn) {
        triggerRealisticClick(moreActionsBtn, window);
        await new Promise(r => setTimeout(r, 350));

        let delItem = findDeleteMenuItemInDoc(document);
        if (!delItem) {
          await new Promise(r => setTimeout(r, 400));
          delItem = findDeleteMenuItemInDoc(document);
        }

        if (!delItem) {
          throw new Error('Opción Eliminar no encontrada tras desplegar el menú de acciones');
        }

        triggerRealisticClick(delItem, window);
      } else {
        throw new Error('No se encontró el botón de eliminar ni el menú de acciones para este evento');
      }

      // Check and poll if a confirmation modal dialog appears (e.g. recurring event or delete confirm)
      const dialogStartTime = Date.now();
      while (Date.now() - dialogStartTime < 3500) {
        const dialog = document.querySelector('[role="dialog"], [role="alertdialog"], .m3-dialog, .VfPpkd-Bz112c-LgbsSe');
        if (dialog) {
          const confirmBtn = Array.from(dialog.querySelectorAll('button, [role="button"], [data-mdc-dialog-action]')).find(b => {
            const txt = (b.textContent || '').trim().toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            const action = (b.getAttribute('data-mdc-dialog-action') || '').toLowerCase();
            if (txt.includes('cancel') || aria.includes('cancel') || action === 'close') return false;
            return (
              action === 'ok' || action === 'accept' || action === 'delete' ||
              txt.includes('eliminar') || txt.includes('delete') || txt.includes('aceptar') || txt.includes('ok') || txt.includes('confirm') || txt.includes('sí') || txt.includes('borrar') ||
              aria.includes('eliminar') || aria.includes('delete') || aria.includes('aceptar') || aria.includes('ok') || aria.includes('confirm') || aria.includes('sí') || aria.includes('borrar')
            );
          });
          if (confirmBtn) {
            triggerRealisticClick(confirmBtn, window);
            break;
          }
        }
        if (!window.location.href.includes('/r/eventedit/')) break;
        await new Promise(r => setTimeout(r, 150));
      }

      // Wait up to 6s for navigation away from /r/eventedit/ or toast confirmation
      let navigatedAway = false;
      const waitStart = Date.now();
      while (Date.now() - waitStart < 6000) {
        try {
          const href = window.location.href || '';
          if (!href.includes('/r/eventedit/')) {
            navigatedAway = true;
            break;
          }
          const toast = document.querySelector('[role="status"], .Y80hhe, .snByac');
          if (toast && (toast.textContent?.toLowerCase().includes('eliminad') || toast.textContent?.toLowerCase().includes('deleted'))) {
            navigatedAway = true;
            break;
          }
        } catch (_) {
          navigatedAway = true;
          break;
        }
        await new Promise(r => setTimeout(r, 150));
      }

      return {
        success: navigatedAway,
        error: navigatedAway ? undefined : 'No se confirmó la eliminación en el servidor de Google Calendar'
      };
    } catch (scriptErr) {
      return { success: false, error: scriptErr?.message || String(scriptErr) };
    }
  })()`;
}

/**
 * Builds the script for atomic in-place rescheduling (date, startTime and endTime).
 */
export function buildInPlaceRescheduleScript(date: string, startTime?: string, endTime?: string): string {
  return `(async () => {
    const pollStart = Date.now();
    const dateSelectors = ${JSON.stringify(RESILIENT_SELECTORS.startDateInput)};
    const startSelectors = ${JSON.stringify(RESILIENT_SELECTORS.startTimeInput)};
    const endSelectors = ${JSON.stringify(RESILIENT_SELECTORS.endTimeInput)};
    const saveSelectors = ${JSON.stringify(RESILIENT_SELECTORS.saveButton)};

    let dateInput = null;
    let saveBtn = null;

    while (Date.now() - pollStart < 10000) {
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

    const setInputValue = (el, val) => {
      const nativeInputSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      el.focus();
      if (nativeInputSetter) {
        nativeInputSetter.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      el.blur();
    };

    const formatForExistingLocale = (isoStr, sampleVal) => {
      const parts = isoStr.split('-').map(Number);
      if (parts.length !== 3) return isoStr;
      const [y, m, d] = parts;
      const dt = new Date(y, m - 1, d);
      const sample = (sampleVal || '').trim();
      const dd = String(d).padStart(2, '0');
      const mm = String(m).padStart(2, '0');

      if (/^\\d{4}-\\d{2}-\\d{2}$/.test(sample)) return isoStr;
      if (/^\\d{1,2}\\/\\d{1,2}\\/\\d{4}$/.test(sample)) {
        const lang = (document.documentElement.lang || navigator.language || 'es').toLowerCase();
        return lang.startsWith('en-us') ? (mm + '/' + dd + '/' + y) : (dd + '/' + mm + '/' + y);
      }
      const locale = document.documentElement.lang || navigator.language || 'es-ES';
      let formatted = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(dt);
      if (!sample.includes('.')) {
        formatted = formatted.replace(/\\./g, '');
      }
      return formatted;
    };

    const localizedDate = formatForExistingLocale(${JSON.stringify(date)}, dateInput.value);
    setInputValue(dateInput, localizedDate);
    await new Promise(r => setTimeout(r, 200));

    // Also synchronize end date input if present on same-day events
    const endDateInput = document.querySelector('input[aria-label*="Fecha de finalización" i], input[aria-label*="End date" i], input[aria-label*="Data de finalització" i]');
    if (endDateInput && endDateInput !== dateInput) {
      setInputValue(endDateInput, formatForExistingLocale(${JSON.stringify(date)}, endDateInput.value));
      await new Promise(r => setTimeout(r, 150));
    }

    // Update startTime if available
    const targetStart = ${JSON.stringify(startTime || null)};
    if (targetStart) {
      let startTimeInput = null;
      for (const sel of startSelectors) {
        startTimeInput = document.querySelector(sel);
        if (startTimeInput) break;
      }
      if (startTimeInput) {
        setInputValue(startTimeInput, targetStart);
        await new Promise(r => setTimeout(r, 150));
      }
    }

    // Update endTime if available
    const targetEnd = ${JSON.stringify(endTime || null)};
    if (targetEnd) {
      let endTimeInput = null;
      for (const sel of endSelectors) {
        endTimeInput = document.querySelector(sel);
        if (endTimeInput) break;
      }
      if (endTimeInput) {
        setInputValue(endTimeInput, targetEnd);
        await new Promise(r => setTimeout(r, 150));
      }
    }

    saveBtn.click();
    await new Promise(r => setTimeout(r, 800));
  })()`;
}

/**
 * Builds the script to update Google Calendar event description notes.
 */
export function buildUpdateDescriptionScript(description: string): string {
  return `(async () => {
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
  })()`;
}

/**
 * Builds the script to check if a secondary academic calendar already exists in active DOM.
 */
export function buildCheckCalendarExistsScript(calName: string): string {
  const safeTarget = String(calName || '').toLowerCase().trim();
  return `(() => {
    const target = ${JSON.stringify(safeTarget)};
    const items = Array.from(document.querySelectorAll('span, div[title], [role="checkbox"], [role="treeitem"]'));
    return items.some(el => {
      const text = (el.textContent || '').trim().toLowerCase();
      const title = (el.getAttribute('title') || '').trim().toLowerCase();
      const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      return text === target || title === target || label === target ||
             text.startsWith(target) || title.startsWith(target) || label.startsWith(target);
    });
  })()`;
}

/**
 * Builds the script to create a secondary calendar in background.
 */
export function buildCreateCalendarScript(calName: string): string {
  return `(async () => {
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
  })()`;
}
