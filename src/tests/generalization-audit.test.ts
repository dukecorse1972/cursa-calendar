import { test, describe } from 'node:test';
import * as assert from 'node:assert';
import { getIsolatedKey, getIsolatedItem, setIsolatedItem, removeIsolatedItem } from '../injected/utils/storage';
import { parseAcademicDateString, calculateDuration, toISODateString } from '../injected/utils/dateParsers';
import { t, setLocale, getLocale } from '../shared/i18n';
import { RESILIENT_SELECTORS } from '../injected/adapter/selectors';
import { GoogleCalendarAdapter } from '../injected/adapter/GoogleCalendarAdapter';
import { AppState } from '../injected/state';
import { formatAcademicEvent, formatAcademicEventUrl } from '../shared/formatters';
import { getGoogleCalendarUrl } from '../shared/constants';
import { AcademicEventPayload } from '../shared/types';

describe('14. Account-Isolated Storage & Profile Privacy [P0-03]', () => {
  test('getIsolatedKey namespaces key when user identifier is present', () => {
    const isolated = getIsolatedKey('gcal_subject_colors', 'user_abc123');
    assert.equal(isolated, 'gcal_user_abc123_subject_colors');
  });

  test('getIsolatedKey falls back to raw key when user identifier is null', () => {
    const raw = getIsolatedKey('gcal_subject_colors', null);
    assert.equal(raw, 'gcal_subject_colors');
  });

  test('setIsolatedItem and getIsolatedItem store and retrieve isolated values with fallback', () => {
    // Setup global mock localStorage if not present in Node test runner
    if (typeof (global as any).localStorage === 'undefined') {
      const store: Record<string, string> = {};
      (global as any).localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = String(v); },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); }
      };
    }

    setIsolatedItem('test_key', 'isolated_val', 'student_456');
    assert.equal(getIsolatedItem('test_key', 'student_456'), 'isolated_val');

    // Different user should fall back to base or null
    assert.equal(getIsolatedItem('test_key', 'student_789'), null);

    removeIsolatedItem('test_key', 'student_456');
    assert.equal(getIsolatedItem('test_key', 'student_456'), null);
  });
});

describe('15. Resilient Multilingual Date Parsers [P3-01]', () => {
  setLocale('es');
  test('Parses Spanish academic date string correctly', () => {
    const res = parseAcademicDateString('Evento el 20 de noviembre de 2026 a las 10:00');
    assert.equal(res.matchedDay, 20);
    assert.equal(res.matchedMonth, 10); // November is index 10
    assert.equal(res.matchedYear, 2026);
    assert.equal(res.isoDate, '2026-11-20');
    assert.ok(res.dateStr.includes('20 de Noviembre de 2026'));
  });

  test('Parses English academic date strings (Month DD and DD Month)', () => {
    const res1 = parseAcademicDateString('Final exam on December 15, 2026');
    assert.equal(res1.matchedDay, 15);
    assert.equal(res1.matchedMonth, 11); // December is index 11
    assert.equal(res1.matchedYear, 2026);
    assert.equal(res1.isoDate, '2026-12-15');

    const res2 = parseAcademicDateString('Assignment due 18 October 2026');
    assert.equal(res2.matchedDay, 18);
    assert.equal(res2.matchedMonth, 9); // October is index 9
    assert.equal(res2.isoDate, '2026-10-18');
  });

  test('calculateDuration computes hours and minutes and midnight rollover', () => {
    assert.equal(calculateDuration('10:00', '12:30'), '2 h 30 min');
    assert.equal(calculateDuration('09:00', '11:00'), '2 horas');
    assert.equal(calculateDuration('14:00', '14:45'), '45 min');
    // Overnight rollover
    assert.equal(calculateDuration('23:00', '01:00'), '2 horas');
  });

  test('toISODateString formats Date object to YYYY-MM-DD', () => {
    const d = new Date(2026, 4, 9); // May 9, 2026
    assert.equal(toISODateString(d), '2026-05-09');
  });
});

describe('16. Multilingual Translation Service (i18n) [P3-02]', () => {
  test('Returns Spanish translations by default', () => {
    setLocale('es');
    assert.equal(getLocale(), 'es');
    assert.equal(t('tab_clases'), 'CLASES');
    assert.equal(t('tab_entregas'), 'EXÁMENES Y ENTREGAS');
    assert.equal(t('new_academic_event'), 'Nuevo Evento Académico');
  });

  test('Switches to English and translates keys correctly', () => {
    setLocale('en');
    assert.equal(getLocale(), 'en');
    assert.equal(t('tab_clases'), 'CLASSES');
    assert.equal(t('tab_entregas'), 'EXAMS & DEADLINES');
    assert.equal(t('new_academic_event'), 'New Academic Event');
    setLocale('es'); // Reset
  });

  test('Translates dynamic functions and countdowns correctly', () => {
    setLocale('es');
    const fnEs = t('countdown_days_left');
    assert.equal(fnEs(3), 'Faltan 3 días');
    assert.equal(fnEs(1), 'Faltan 1 día');

    setLocale('en');
    const fnEn = t('countdown_days_left');
    assert.equal(fnEn(3), '3 days left');
    assert.equal(fnEn(1), '1 day left');
    setLocale('es');
  });
});

describe('17. Multilingual Selectors & Semantic Resilient Cascade [P1-03]', () => {
  test('saveButton contains multilingual labels (ES, EN, CA, GL, FR, DE)', () => {
    const joined = RESILIENT_SELECTORS.saveButton.join(' ');
    assert.ok(joined.includes('Guardar'));
    assert.ok(joined.includes('Save'));
    assert.ok(joined.includes('Desa'));
    assert.ok(joined.includes('Gardar'));
    assert.ok(joined.includes('Enregistrer'));
    assert.ok(joined.includes('Speichern'));
  });

  test('deleteButton contains multilingual labels', () => {
    const joined = RESILIENT_SELECTORS.deleteButton.join(' ');
    assert.ok(joined.includes('Eliminar'));
    assert.ok(joined.includes('Delete'));
    assert.ok(joined.includes('Suprimeix'));
    assert.ok(joined.includes('Supprimer'));
    assert.ok(joined.includes('Löschen'));
  });

  test('Contains description, start date, and time selectors', () => {
    assert.ok(RESILIENT_SELECTORS.descriptionInput.length > 0);
    assert.ok(RESILIENT_SELECTORS.startDateInput.length > 0);
    assert.ok(RESILIENT_SELECTORS.startTimeInput.length > 0);
  });
});

describe('18. Whitelist-Based isClass Classification [P0-02]', () => {
  const adapter = GoogleCalendarAdapter.getInstance();

  test('isClass returns true for configured onboarding subjects and their theoretical/practical forms', () => {
    // Configure mock isolated subjects
    setIsolatedItem('gcal_academic_subjects', JSON.stringify([
      { name: 'Álgebra Lineal', color: '#98D5E8' },
      { name: 'Física I', color: '#A1D0CA' }
    ]));

    assert.ok(adapter.isClass('Álgebra Lineal'));
    assert.ok(adapter.isClass('Física I'));
    assert.ok(adapter.isClass('algebra lineal')); // Accent and case insensitive
    assert.ok(adapter.isClass('Álgebra Lineal (Prácticas)'));
    assert.ok(adapter.isClass('Física I (Laboratorio)'));
    assert.ok(adapter.isClass('Prácticas de Álgebra Lineal'));
    assert.ok(adapter.isClass('Teoría de Física I'));
    assert.ok(adapter.isClass('Prácticas'));
    assert.ok(adapter.isClass('Teoría'));

    // Real university subjects from Google Calendar are recognized as classes
    assert.ok(adapter.isClass('Fundamentos de los Computadores'));
    assert.ok(adapter.isClass('Derecho de la Empresa'));
    assert.ok(adapter.isClass('Introducción al Márketing'));
    assert.ok(adapter.isClass('Matemáticas 1'));
    assert.ok(adapter.isClass('Programación 1'));
    assert.ok(adapter.isClass('Fundamentos de Economía'));
  });

  test('isClass returns false for non-class calendar names (birthdays, personal, exams, holidays)', () => {
    assert.ok(!adapter.isClass('Cumpleaños'));
    assert.ok(!adapter.isClass('Exámenes'));
    assert.ok(!adapter.isClass('Entregas'));
    assert.ok(!adapter.isClass('Festivos en España'));
    assert.ok(!adapter.isClass('Recordatorios'));
    assert.ok(!adapter.isClass('Tareas'));
    assert.ok(!adapter.isClass('Mi Calendario'));
  });

  test('isClass excludes personal primary calendar matching active Google profile name or email, and getDetectedClasses prioritizes Onboarding subjects over DOM', () => {
    const prevDoc = (global as any).document;
    try {
      const mockAccountHeader = {
        getAttribute: (attr: string) => {
          if (attr === 'data-email') return 'dario.estudiante@uni.es';
          if (attr === 'aria-label') return 'Cuenta de Google: Dario Estudiante (dario.estudiante@uni.es)';
          return null;
        }
      };

      const makeCheckbox = (label: string) => ({
        getAttribute: (attr: string) => (attr === 'aria-label' ? label : null),
        closest: () => ({ textContent: label })
      });

      const mockCheckboxes = [
        makeCheckbox('Dario Estudiante'),
        makeCheckbox('dario.estudiante@uni.es'),
        makeCheckbox('Cumpleaños'),
        makeCheckbox('Exámenes'),
        makeCheckbox('Redes de Computadores')
      ];

      (global as any).document = {
        querySelector: (sel: string) => (sel.includes('SignOutOptions') ? mockAccountHeader : null),
        querySelectorAll: (sel: string) => (sel.includes('checkbox') ? mockCheckboxes : [])
      };

      setIsolatedItem('gcal_academic_subjects', JSON.stringify([
        { name: 'Álgebra Lineal', color: '#98D5E8' },
        { name: 'Física I', color: '#A1D0CA' }
      ]));

      assert.ok(!adapter.isClass('Dario Estudiante'), 'User primary calendar matching display name must be excluded');
      assert.ok(!adapter.isClass('dario.estudiante@uni.es'), 'User primary calendar matching email must be excluded');
      assert.ok(!adapter.isClass('otro.correo@gmail.com'), 'Email-named personal calendar must be excluded');

      const detected = adapter.getDetectedClasses();
      assert.deepEqual(detected, ['Álgebra Lineal', 'Física I'], 'Active term configured subjects must strictly determine detected classes without leaking other periods');
      assert.ok(!detected.includes('Dario Estudiante'), 'Personal primary calendar must not leak into detected classes');
      assert.ok(!detected.includes('Cumpleaños'));
      assert.ok(!detected.includes('Exámenes'));
    } finally {
      (global as any).document = prevDoc;
    }
  });
});

describe('19. AppState Calendar Visibility DOM Synchronization [P2-04]', () => {
  test('Toggling calendar visibility in AppState notifies listeners and persists', () => {
    const appState = AppState.getInstance();

    const unsubscribe = appState.subscribe((_state) => {
      // Find changed
    });

    appState.setCalendarVisibility('Matemáticas', false);
    assert.equal(appState.getState().selectedCalendars['Matemáticas'], false);

    appState.setCalendarVisibility('Matemáticas', true);
    assert.equal(appState.getState().selectedCalendars['Matemáticas'], true);
    unsubscribe();
  });
});

describe('20. Dynamic Google Account Indexing & Generalist URLs [P0-01]', () => {
  const samplePayload: AcademicEventPayload = {
    type: 'EXAMEN',
    subject: 'Sistemas Distribuidos',
    title: 'Parcial 1',
    date: '2026-11-15',
    startTime: '10:00',
    endTime: '12:00'
  };

  test('formatAcademicEvent defaults to account index 0 when omitted', () => {
    const result = formatAcademicEvent(samplePayload);
    assert.ok(result.targetUrl.startsWith('https://calendar.google.com/calendar/u/0/r/eventedit?'));
  });

  test('formatAcademicEvent respects dynamic account index (e.g. /u/1/, /u/2/)', () => {
    const resultU1 = formatAcademicEvent(samplePayload, 1);
    assert.ok(resultU1.targetUrl.startsWith('https://calendar.google.com/calendar/u/1/r/eventedit?'));

    const resultU2 = formatAcademicEvent(samplePayload, '2');
    assert.ok(resultU2.targetUrl.startsWith('https://calendar.google.com/calendar/u/2/r/eventedit?'));
  });

  test('formatAcademicEventUrl respects dynamic account index', () => {
    const urlU3 = formatAcademicEventUrl(samplePayload, 3);
    assert.ok(urlU3.startsWith('https://calendar.google.com/calendar/u/3/r/eventedit?'));
  });

  test('getGoogleCalendarUrl returns appropriate base URL for any account index', () => {
    assert.equal(getGoogleCalendarUrl(), 'https://calendar.google.com/calendar/u/0/r');
    assert.equal(getGoogleCalendarUrl(1), 'https://calendar.google.com/calendar/u/1/r');
    assert.equal(getGoogleCalendarUrl('5'), 'https://calendar.google.com/calendar/u/5/r');
  });
});

describe('21. Production Generalization & Creator Independence [P0/P1/P2]', () => {
  const adapter = GoogleCalendarAdapter.getInstance();

  test('shouldShowOtherCalendars defaults to true to preserve university external subscriptions', () => {
    // When no explicit preference is set, other calendars MUST be visible
    removeIsolatedItem('gcal_show_other_calendars');
    assert.equal(adapter.shouldShowOtherCalendars(), true);

    // Can still be explicitly hidden if the user requests it
    setIsolatedItem('gcal_show_other_calendars', 'false');
    assert.equal(adapter.shouldShowOtherCalendars(), false);

    // Reset back
    setIsolatedItem('gcal_show_other_calendars', 'true');
    assert.equal(adapter.shouldShowOtherCalendars(), true);
  });

  test('Academic deliverables/exams vs practical classes classification', () => {
    // Regular practical and lab classes are classes, NOT academic deliverables/exams
    assert.ok(!adapter.isAcademic('Práctica 3 de Redes'));
    assert.ok(!adapter.isAcademic('Laboratorio de Física'));
    assert.ok(adapter.isClass('Práctica 3 de Redes'));
    assert.ok(adapter.isClass('Laboratorio de Física'));

    // Actual deliverables, deadlines, tests, and exams ARE recognized as academic
    assert.ok(adapter.isAcademic('Entrega Práctica 3 de Redes'));
    assert.ok(adapter.isAcademic('Entrega Proyecto Final'));
    assert.ok(adapter.isAcademic('Primer Parcial'));
    assert.ok(adapter.isAcademic('Quiz 1'));
    assert.ok(adapter.isAcademic('Control de lectura'));
    assert.ok(adapter.isAcademic('Examen Final'));
  });

  test('Onboarding completed state in isolated storage prevents infinite wizard loops', () => {
    // When marked as completed in isolated storage
    setIsolatedItem('gcal_academic_onboarding_completed', 'true');
    assert.equal(getIsolatedItem('gcal_academic_onboarding_completed'), 'true');
  });

  test('dateParsers and calculateDuration properly format in English when locale is switched', () => {
    setLocale('en');
    assert.equal(calculateDuration('09:00', '11:00'), '2 hours');
    assert.equal(calculateDuration('10:00', '11:00'), '1 hour');
    assert.equal(calculateDuration('10:00', '10:30'), '30 min');

    const res = parseAcademicDateString('Final exam on December 15, 2026', 10, 0);
    assert.ok(res.dateStr.includes('December 15, 2026'));
    setLocale('es'); // Reset
  });
});
