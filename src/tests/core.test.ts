import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CALENDAR_GROUPS, TARGET_CALENDARS, PARTITION_NAME } from '../shared/constants';
import { getTokens, LIGHT_THEME, DARK_THEME } from '../injected/theme/tokens';
import { AppState } from '../injected/state';

describe('1. Shared Constants & Categories', () => {
  test('CLASES group contains exactly Clase 1 to Clase 6', () => {
    assert.deepEqual(CALENDAR_GROUPS.CLASES, [
      'Clase 1',
      'Clase 2',
      'Clase 3',
      'Clase 4',
      'Clase 5',
      'Clase 6'
    ]);
  });

  test('ACADEMICOS group contains Exámenes and Entregas', () => {
    assert.deepEqual(CALENDAR_GROUPS.ACADEMICOS, ['Exámenes', 'Entregas']);
  });

  test('Cumpleaños is in OCULTO group and excluded from CLASES and ACADEMICOS', () => {
    assert.ok(CALENDAR_GROUPS.OCULTO.includes('Cumpleaños'));
    assert.ok(!CALENDAR_GROUPS.CLASES.includes('Cumpleaños' as any));
    assert.ok(!CALENDAR_GROUPS.ACADEMICOS.includes('Cumpleaños' as any));
    assert.ok(!CALENDAR_GROUPS.OTROS.includes('Cumpleaños' as any));
  });

  test('TARGET_CALENDARS routes EXAMEN and ENTREGA correctly', () => {
    assert.equal(TARGET_CALENDARS.EXAMEN, 'Exámenes');
    assert.equal(TARGET_CALENDARS.ENTREGA, 'Entregas');
  });

  test('Partition name is persistent', () => {
    assert.ok(PARTITION_NAME.startsWith('persist:'));
  });
});

describe('2. Design System and Theme Tokens', () => {
  test('Light theme tokens have proper contrast and structure', () => {
    const tokens = getTokens('LIGHT');
    assert.equal(tokens.background, LIGHT_THEME.background);
    assert.equal(tokens.text, LIGHT_THEME.text);
    assert.equal(tokens.accent, '#1a73e8');
  });

  test('Dark theme tokens have proper dark surface and text', () => {
    const tokens = getTokens('DARK');
    assert.equal(tokens.background, DARK_THEME.background);
    assert.equal(tokens.text, DARK_THEME.text);
    assert.equal(tokens.accent, '#8ab4f8');
  });
});

describe('3. Application State (Single Source of Truth)', () => {
  test('Initial state starts on CLASES tab with all default calendars enabled', () => {
    const appState = AppState.getInstance();
    const state = appState.getState();
    assert.equal(state.activeTab, 'CLASES');
    assert.equal(state.selectedCalendars['Clase 1'], true);
    assert.equal(state.selectedCalendars['Exámenes'], true);
    assert.equal(state.isSubmitting, false);
  });

  test('Changing active tab notifies listeners properly', () => {
    const appState = AppState.getInstance();
    let notifiedTab = '';
    const unsubscribe = appState.subscribe((s) => {
      notifiedTab = s.activeTab;
    });

    appState.setActiveTab('ENTREGAS_EXAMENES');
    assert.equal(appState.getState().activeTab, 'ENTREGAS_EXAMENES');
    assert.equal(notifiedTab, 'ENTREGAS_EXAMENES');

    appState.setActiveTab('TODO');
    assert.equal(appState.getState().activeTab, 'TODO');
    assert.equal(notifiedTab, 'TODO');

    unsubscribe();
  });

  test('Toggling calendar visibility updates state and notifies listeners', () => {
    const appState = AppState.getInstance();
    let lastUpdatedState: any = null;
    const unsubscribe = appState.subscribe((s) => {
      lastUpdatedState = s;
    });

    appState.setCalendarVisibility('Clase 2', false);
    assert.equal(appState.getState().selectedCalendars['Clase 2'], false);
    assert.equal(lastUpdatedState.selectedCalendars['Clase 2'], false);

    appState.setCalendarVisibility('Clase 2', true);
    assert.equal(appState.getState().selectedCalendars['Clase 2'], true);

    unsubscribe();
  });

  test('Submitting lock prevents double creation', () => {
    const appState = AppState.getInstance();
    appState.setSubmitting(true);
    assert.equal(appState.getState().isSubmitting, true);
    appState.setSubmitting(false);
    assert.equal(appState.getState().isSubmitting, false);
  });
});

describe('12. Academic Tab Keyboard Navigation & Shortcuts Contract', () => {
  test('Numeric key mappings route to valid AppTabs correctly', () => {
    const KEY_TAB_MAP: Record<string, string> = {
      '1': 'CLASES',
      '2': 'ENTREGAS_EXAMENES',
      '3': 'TODO'
    };

    const appState = AppState.getInstance();
    assert.equal(KEY_TAB_MAP['1'], 'CLASES');
    assert.equal(KEY_TAB_MAP['2'], 'ENTREGAS_EXAMENES');
    assert.equal(KEY_TAB_MAP['3'], 'TODO');

    appState.setActiveTab(KEY_TAB_MAP['1'] as any);
    assert.equal(appState.getState().activeTab, 'CLASES');

    appState.setActiveTab(KEY_TAB_MAP['2'] as any);
    assert.equal(appState.getState().activeTab, 'ENTREGAS_EXAMENES');

    appState.setActiveTab(KEY_TAB_MAP['3'] as any);
    assert.equal(appState.getState().activeTab, 'TODO');
  });

  test('Input detection correctly suppresses shortcut triggers when typing in real panel helper', () => {
    const { shouldSuppressAcademicShortcut } = require('../injected/ui/panel');

    assert.equal(shouldSuppressAcademicShortcut({ tagName: 'INPUT' }), true);
    assert.equal(shouldSuppressAcademicShortcut({ tagName: 'TEXTAREA' }), true);
    assert.equal(shouldSuppressAcademicShortcut({ tagName: 'SELECT' }), true);
    assert.equal(
      shouldSuppressAcademicShortcut({
        tagName: 'DIV',
        getAttribute: (attr: string) => (attr === 'role' ? 'textbox' : null)
      }),
      true
    );
    assert.equal(
      shouldSuppressAcademicShortcut({
        tagName: 'DIV',
        getAttribute: (attr: string) => (attr === 'contenteditable' ? 'true' : null)
      }),
      true
    );
    assert.equal(
      shouldSuppressAcademicShortcut({
        tagName: 'DIV',
        getAttribute: () => null,
        closest: () => null
      }),
      false
    );
  });
});

describe('13. Window Quitting State Control (System Tray)', () => {
  const { setIsQuitting, getIsQuitting } = require('../main/window');

  test('setIsQuitting correctly toggles quitting state', () => {
    setIsQuitting(false);
    assert.equal(getIsQuitting(), false);

    setIsQuitting(true);
    assert.equal(getIsQuitting(), true);

    setIsQuitting(false);
    assert.equal(getIsQuitting(), false);
  });
});

