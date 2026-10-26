import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import {
  buildInPlaceRescheduleScript,
  buildSaveEventScript,
  buildUpdateDescriptionScript,
  buildCheckCalendarExistsScript,
  buildCreateCalendarScript
} from '../main/gcalAutomation';
import { resolveSafeDebugScreenshotPath, waitForEventEditExit } from '../main/window';

describe('25. Background Automation Script Builders & IPC Runtime Guards', () => {
  test('buildInPlaceRescheduleScript embeds date, startTime and endTime and produces valid JS', () => {
    const script = buildInPlaceRescheduleScript('2026-11-24', '16:00', '18:30');
    assert.ok(script.includes('"2026-11-24"'));
    assert.ok(script.includes('"16:00"'));
    assert.ok(script.includes('"18:30"'));
    assert.doesNotThrow(() => new Function(`return ${script};`));
  });

  test('all gcalAutomation script builders generate syntactically valid JavaScript expressions', () => {
    const scripts = [
      buildSaveEventScript(false),
      buildSaveEventScript(true),
      buildUpdateDescriptionScript('Temas 1-4: Traer calculadora científica\nAula 2.1'),
      buildCheckCalendarExistsScript('Exámenes'),
      buildCreateCalendarScript('Entregas')
    ];

    for (const src of scripts) {
      assert.doesNotThrow(() => new Function(`return ${src};`));
    }
  });

  test('resolveSafeDebugScreenshotPath confines output strictly to .png inside allowed workspace/temp roots', () => {
    const insideWorkspace = path.join(process.cwd(), 'artifacts', 'test_shot.png');
    assert.equal(resolveSafeDebugScreenshotPath(insideWorkspace), path.resolve(insideWorkspace));

    assert.equal(resolveSafeDebugScreenshotPath('C:\\Windows\\System32\\evil.png'), null);
    assert.equal(resolveSafeDebugScreenshotPath(path.join(process.cwd(), 'package.json')), null);
    assert.equal(resolveSafeDebugScreenshotPath(path.join(process.cwd(), 'artifacts', 'bad\0.png')), null);
    assert.equal(resolveSafeDebugScreenshotPath(''), null);
  });

  test('waitForEventEditExit resolves false on timeout if window remains stuck on /eventedit, and true once navigated out', async () => {
    let currentUrl = 'https://calendar.google.com/calendar/u/0/r/eventedit/abc123';
    const listeners: Record<string, Array<() => void>> = {};

    const mockWin: any = {
      isDestroyed: () => false,
      webContents: {
        getURL: () => currentUrl,
        on: (evt: string, cb: () => void) => {
          listeners[evt] = listeners[evt] || [];
          listeners[evt].push(cb);
        },
        removeListener: (evt: string, cb: () => void) => {
          listeners[evt] = (listeners[evt] || []).filter((fn) => fn !== cb);
        }
      }
    };

    // Case 1: Remains stuck on /eventedit -> must return false (triggering safe recreate fallback)
    const stuckResult = await waitForEventEditExit(mockWin, 120);
    assert.equal(stuckResult, false);

    // Case 2: Navigates back to /calendar/u/0/r -> must return true immediately
    const navPromise = waitForEventEditExit(mockWin, 1000);
    setTimeout(() => {
      currentUrl = 'https://calendar.google.com/calendar/u/0/r/week';
      (listeners['did-navigate'] || []).forEach((fn) => fn());
    }, 30);
    const okResult = await navPromise;
    assert.equal(okResult, true);
  });

  test('buildSaveEventScript ignores Recurrence combobox, matches accented Exámenes calendar, and clicks Save', async () => {
    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    const prevPointer = (global as any).PointerEvent;
    const prevMouse = (global as any).MouseEvent;
    const prevKb = (global as any).KeyboardEvent;

    try {
      let recurrenceClicked = false;
      let calendarComboClicked = false;
      let examenesOptionClicked = false;
      let saveClicked = false;

      class FakeEvent {
        type: string;
        constructor(type: string) {
          this.type = type;
        }
      }
      (global as any).PointerEvent = FakeEvent;
      (global as any).MouseEvent = FakeEvent;
      (global as any).KeyboardEvent = FakeEvent;

      const makeEl = (overrides: Record<string, any> = {}) => ({
        textContent: '',
        matches: () => true,
        querySelector: () => null,
        getAttribute: () => null,
        getBoundingClientRect: () => ({ x: 10, y: 10, width: 120, height: 32 }),
        dispatchEvent: () => true,
        focus: () => {},
        click: () => {},
        ...overrides
      });

      const recurrenceCombo = makeEl({
        textContent: 'No se repite',
        getAttribute: (k: string) => (k === 'aria-label' ? 'Periodicidad' : null),
        click: () => {
          recurrenceClicked = true;
        }
      });

      const primaryOpt = makeEl({ textContent: 'Dario Personal' });
      const examenesOpt = makeEl({
        textContent: '📋 Exámenes',
        click: () => {
          examenesOptionClicked = true;
        }
      });

      let popupOpen = false;
      const calendarCombo = makeEl({
        textContent: 'Dario Personal',
        getAttribute: (k: string) => (k === 'aria-label' ? 'Calendario' : null),
        click: () => {
          calendarComboClicked = true;
          popupOpen = true;
        }
      });

      const saveBtn = makeEl({
        textContent: 'Guardar',
        click: () => {
          saveClicked = true;
        }
      });

      (global as any).window = {};
      (global as any).document = {
        querySelector: (sel: string) => {
          if (sel === '#xSaveBu') return saveBtn;
          if (sel.includes('aria-label*="Calendario"')) return calendarCombo;
          return null;
        },
        querySelectorAll: (sel: string) => {
          if (sel.includes('[role="combobox"]')) return [recurrenceCombo, calendarCombo];
          if (sel.includes('[role="option"]')) return popupOpen ? [primaryOpt, examenesOpt] : [];
          return [];
        },
        dispatchEvent: () => true
      };

      const fn = new Function(`return ${buildSaveEventScript(false)};`);
      const res = await fn();

      assert.equal(recurrenceClicked, false, 'Must NOT click Recurrence combobox');
      assert.equal(calendarComboClicked, true, 'Must open Calendar combobox');
      assert.equal(examenesOptionClicked, true, 'Must match accented "Exámenes" option');
      assert.equal(saveClicked, true, 'Must click Save button');
      assert.equal(res?.selectedAcademicCalendar, true);
    } finally {
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
      (global as any).PointerEvent = prevPointer;
      (global as any).MouseEvent = prevMouse;
      (global as any).KeyboardEvent = prevKb;
    }
  });
});
