import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { AcademicEventPayload } from '../shared/types';
import { formatAcademicEventUrl } from '../shared/formatters';
import { setLocale } from '../shared/i18n';

describe('4. Academic Event Formatting and Google Calendar URL Construction', () => {

  test('Generates correct title tag and URL for EXAMEN', () => {
    const payload: AcademicEventPayload = {
      type: 'EXAMEN',
      subject: 'Clase 1',
      title: 'Parcial de Álgebra',
      description: 'Temas 1 al 4',
      date: '2026-11-20',
      time: '09:00'
    };

    const url = formatAcademicEventUrl(payload);
    assert.ok(url.startsWith('https://calendar.google.com/calendar/u/0/r/eventedit?'));

    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('text'), '[EXAMEN] Clase 1 - Parcial de Álgebra');
    assert.equal(parsed.searchParams.get('dates'), '20261120T090000/20261120T100000');
    assert.ok(parsed.searchParams.get('details')?.includes('Tipo: EXAMEN'));
    assert.ok(parsed.searchParams.get('details')?.includes('Calendario Destino: Exámenes'));
    assert.ok(parsed.searchParams.get('details')?.includes('Temas 1 al 4'));
  });

  test('Generates correct title tag and URL for ENTREGA', () => {
    const payload: AcademicEventPayload = {
      type: 'ENTREGA',
      subject: 'Clase 3',
      title: 'Práctica de Laboratorio',
      date: '2026-12-05',
      time: '23:59'
    };

    const url = formatAcademicEventUrl(payload);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('text'), '[ENTREGA] Clase 3 - Práctica de Laboratorio');
    assert.ok(parsed.searchParams.get('details')?.includes('Tipo: ENTREGA'));
    assert.ok(parsed.searchParams.get('details')?.includes('Calendario Destino: Entregas'));
  });

  test('Handles midnight rollover correctly in end time calculation', () => {
    const payload: AcademicEventPayload = {
      type: 'ENTREGA',
      subject: 'Clase 2',
      title: 'Entrega Final',
      date: '2026-10-31',
      time: '23:30'
    };

    const url = formatAcademicEventUrl(payload);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('dates'), '20261031T233000/20261101T003000');
  });

  test('Handles explicit endTime crossing midnight to next day', () => {
    const payload: AcademicEventPayload = {
      type: 'ENTREGA',
      subject: 'Clase 2',
      title: 'Entrega Medianoche',
      date: '2026-12-31',
      startTime: '23:00',
      endTime: '01:30'
    };

    const url = formatAcademicEventUrl(payload);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('dates'), '20261231T230000/20270101T013000');
  });

  test('Generates correct title tag and URL with custom startTime and endTime and emojis', () => {
    const payload: AcademicEventPayload = {
      type: 'EXAMEN',
      subject: '🖥️ Fundamentos de los Computadores',
      title: 'Parcial Práctico',
      date: '2026-11-15',
      startTime: '10:30',
      endTime: '12:45'
    };

    const url = formatAcademicEventUrl(payload);
    const parsed = new URL(url);
    assert.equal(parsed.searchParams.get('text'), '[EXAMEN] 🖥️ Fundamentos de los Computadores - Parcial Práctico');
    assert.equal(parsed.searchParams.get('dates'), '20261115T103000/20261115T124500');
    assert.ok(parsed.searchParams.get('details')?.includes('Horario: 10:30 - 12:45'));
  });
});

describe('5. Subject Colors & Option 1 HSL Adaptation', () => {
  const { GoogleCalendarAdapter } = require('../injected/adapter/GoogleCalendarAdapter');
  const adapter = GoogleCalendarAdapter.getInstance();

  test('Provides default subject colors for generic classes and subjects [P1-01]', () => {
    const map = adapter.getSubjectColorMap();
    assert.ok(map.has('clase 1'));
    assert.ok(map.has('clase 2'));
    assert.ok(map.has('asignatura 1'));
    assert.ok(map.has('programacion'));
    assert.ok(map.has('economia'));
    assert.ok(map.has('matematicas'));
    assert.ok(map.has('fisica'));

    assert.equal(map.get('clase 1'), '#B69A31');
    assert.equal(map.get('programacion'), '#90B0C4');
  });

  test('findSubjectColor accurately matches subjects by keyword and accents or deterministic fallback', () => {
    const map = adapter.getSubjectColorMap();
    assert.equal(adapter.findSubjectColor('🧑‍💻 Programación', map), '#90B0C4');
    assert.equal(adapter.findSubjectColor('Fundamentos de Economía', map), '#96BCBB');
    assert.equal(adapter.findSubjectColor('Matemáticas', map), '#BAB35A');
    assert.equal(adapter.findSubjectColor('Física Cuántica', map), '#A1D0CA');
    // Deterministic fallback for unmapped courses
    const detColor = adapter.findSubjectColor('🖥️ Computadores', map);
    assert.match(detColor, /^#[0-9A-Fa-f]{6}$/);
  });

  test('Generates distinct, high contrast colors for Examen vs Entrega of the same subject', () => {
    const map = adapter.getSubjectColorMap();
    const colorProg = adapter.findSubjectColor('🧑‍💻 Programación 1', map);
    const colorComp = adapter.findSubjectColor('🖥️ Fundamentos de los Computadores', map);

    // They must not be equal
    assert.notEqual(colorProg, colorComp);

    // Both must be valid 6-digit hex
    assert.match(colorProg, /^#[0-9A-Fa-f]{6}$/);
    assert.match(colorComp, /^#[0-9A-Fa-f]{6}$/);
  });
});

describe('6. Academic Event Extended View (Detail Modal)', () => {
  setLocale('es');
  const { AcademicDetailModal } = require('../injected/ui/detailModal');
  const modal = AcademicDetailModal.getInstance();

  test('Correctly extracts and formats academic event details from chip DOM/aria text', () => {
    // Mock minimal DOM element
    const fakeChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 20:00 a 22:00, [ENTREGA] 🪧 Introducción al Márketing - Practica 3, Calendario: 🗓️ Entegras, Ubicación: Aula Magna, 15 de octubre de 2026';
        }
        if (attr === 'data-eventid') return 'evt_12345';
        if (attr === 'data-gcal-enhanced') return 'v6_ENTREGA_...';
        return null;
      },
      querySelector: (selector: string) => {
        if (selector === '.I0UMhf') return { textContent: '[ENTREGA] 🪧 Introducción al Márketing - Practica 3' };
        if (selector === '.XuJrye') return { textContent: '' };
        if (selector === '.gVNoLb') return { textContent: '20:00 – 22:00' };
        return null;
      },
      innerText: 'Practica 3'
    } as any;

    const detail = modal.parseChipData(fakeChip);
    assert.equal(detail.type, 'ENTREGA');
    assert.equal(detail.title, 'Practica 3');
    assert.equal(detail.subject, '🪧 Introducción al Márketing');
    assert.equal(detail.startTime, '20:00');
    assert.equal(detail.endTime, '22:00');
    assert.equal(detail.durationStr, '2 horas');
    assert.ok(detail.dateStr.includes('15 de Octubre de 2026'));
    assert.equal(detail.calendar, '🗓️ Entegras');
    assert.equal(detail.eventId, 'evt_12345');
    assert.ok(detail.subjectColor.startsWith('#'));
  });

  test('Accurately identifies EXAMEN and computes correct duration with rollover', () => {
    const fakeChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 23:00 a 01:00, [EXAMEN] 🧑‍💻 Programación 1 - Parcial Final, Calendario: 📋 Examenes, 20 de noviembre de 2026';
        }
        if (attr === 'data-eventid') return 'evt_999';
        return null;
      },
      querySelector: () => null,
      innerText: 'Parcial Final'
    } as any;

    const detail = modal.parseChipData(fakeChip);
    assert.equal(detail.type, 'EXAMEN');
    assert.equal(detail.subject, '🧑‍💻 Programación 1');
    assert.equal(detail.startTime, '23:00');
    assert.equal(detail.endTime, '01:00');
    assert.equal(detail.durationStr, '2 horas');
    assert.equal(detail.calendar, '📋 Examenes');
    assert.equal(detail.isCompleted, false);
  });

  test('Correctly identifies completed ENTREGA and supports returning to normality', () => {
    // Mock localStorage
    const meta: Record<string, any> = {
      'practica 3_🪧 introducción al márketing': {
        completed: true,
        hiddenMode: 'dimmed',
        title: 'Practica 3',
        subject: '🪧 Introducción al Márketing'
      }
    };
    (global as any).localStorage = {
      getItem: (k: string) => (k === 'gcal_academic_meta' ? JSON.stringify(meta) : null),
      setItem: (k: string, v: string) => {
        if (k === 'gcal_academic_meta') {
          Object.assign(meta, JSON.parse(v));
        }
      }
    };

    const fakeChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 20:00 a 22:00, [ENTREGA] 🪧 Introducción al Márketing - Practica 3, Calendario: 🗓️ Entegras, 15 de octubre de 2026';
        }
        if (attr === 'data-eventid') return 'evt_done_1';
        return null;
      },
      querySelector: (selector: string) => {
        if (selector === '.I0UMhf') return { textContent: '[ENTREGA] 🪧 Introducción al Márketing - Practica 3' };
        return null;
      },
      classList: {
        add: () => {},
        remove: () => {}
      },
      style: {
        removeProperty: () => {}
      },
      removeAttribute: () => {},
      innerText: 'Practica 3'
    } as any;

    const detail = modal.parseChipData(fakeChip);
    assert.equal(detail.type, 'ENTREGA');
    assert.equal(detail.isCompleted, true);

    // Test restoring normality
    modal.open(fakeChip);
    modal.setCompletionState(false);
    assert.equal(meta['practica 3_🪧 introducción al márketing'].completed, false);
    modal.close();
  });

  test('Accurately parses English date format without falling back to today', () => {
    const fakeChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'From 10:00 to 12:00, [EXAMEN] Mathematics - Final Exam, Calendar: Exams, October 15, 2026';
        }
        if (attr === 'data-eventid') return 'evt_en_123';
        return null;
      },
      querySelector: () => null,
      innerText: 'Final Exam'
    } as any;

    const detail = modal.parseChipData(fakeChip);
    assert.equal(detail.type, 'EXAMEN');
    assert.equal(detail.title, 'Final Exam');
    assert.equal(detail.subject, 'Mathematics');
    assert.equal(detail.startTime, '10:00');
    assert.equal(detail.endTime, '12:00');
    assert.equal(detail.isoDate, '2026-10-15');
    assert.ok(detail.dateStr.includes('15 de Octubre de 2026'));
  });

  test('Modal toolbar button "Quitar del todo" is hidden when entrega is not completed, and shown when completed', () => {
    // Setup mock document for render
    const mockOverlay: any = {
      id: '',
      style: { cssText: '' },
      children: [],
      innerHTML: '',
      remove: () => {},
      addEventListener: () => {},
      querySelector: (selector: string) => {
        if (selector === '#gcal-detail-btn-delete') {
          return mockOverlay.innerHTML.includes('id="gcal-detail-btn-delete"')
            ? { id: 'gcal-detail-btn-delete', addEventListener: () => {}, style: {} }
            : null;
        }
        return { addEventListener: () => {}, style: {}, textContent: '', value: '' };
      },
      querySelectorAll: () => []
    };

    (global as any).document = {
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag: string) => {
        if (tag === 'div') return mockOverlay;
        return { setAttribute: () => {}, textContent: '', appendChild: () => {} };
      },
      head: { appendChild: () => {} },
      body: {
        appendChild: () => {},
        setAttribute: () => {},
        getAttribute: () => null
      }
    };
    (global as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    // 1. Uncompleted Entrega: Delete button should NOT be rendered
    (global as any).localStorage = {
      getItem: () => null,
      setItem: () => {}
    };

    const uncompletedChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 10:00 a 12:00, [ENTREGA] 🖥️ Fundamentos de los Computadores - Entrega Lab 1, Calendario: 🗓️ Entegras, 10 de octubre de 2026';
        }
        return null;
      },
      querySelector: (sel: string) => (sel === '.I0UMhf' ? { textContent: '[ENTREGA] 🖥️ Fundamentos de los Computadores - Entrega Lab 1' } : null),
      innerText: 'Entrega Lab 1'
    } as any;

    modal.open(uncompletedChip);
    const overlayUncompleted = modal.getModalOverlay();
    assert.ok(overlayUncompleted);
    assert.equal(overlayUncompleted.querySelector('#gcal-detail-btn-delete'), null, 'Delete button must not exist when entrega is uncompleted');
    assert.ok(!overlayUncompleted.innerHTML.includes('id="gcal-detail-btn-delete"'), 'Delete button must not appear in toolbar for uncompleted entrega');
    modal.close();

    // 2. Completed Entrega: Delete button ("Quitar del todo") SHOULD be rendered
    const completedMeta: Record<string, any> = {
      'entrega lab 1_🖥️ fundamentos de los computadores': {
        completed: true,
        hiddenMode: 'dimmed',
        title: 'Entrega Lab 1',
        subject: '🖥️ Fundamentos de los Computadores'
      }
    };
    (global as any).localStorage = {
      getItem: (k: string) => (k === 'gcal_academic_meta' ? JSON.stringify(completedMeta) : null),
      setItem: () => {}
    };

    modal.open(uncompletedChip);
    const overlayCompleted = modal.getModalOverlay();
    assert.ok(overlayCompleted);
    assert.ok(overlayCompleted.querySelector('#gcal-detail-btn-delete'), 'Delete button must exist when entrega is completed');
    assert.ok(overlayCompleted.innerHTML.includes('id="gcal-detail-btn-delete"'), 'Delete button must appear in toolbar for completed entrega');
    modal.close();

    // 3. Examen: Delete button ("Eliminar") SHOULD be rendered even if not completed
    const examenChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 10:00 a 12:00, [EXAMEN] 🖥️ Fundamentos de los Computadores - Parcial 1, Calendario: 📋 Examenes, 10 de octubre de 2026';
        }
        return null;
      },
      querySelector: (sel: string) => (sel === '.I0UMhf' ? { textContent: '[EXAMEN] 🖥️ Fundamentos de los Computadores - Parcial 1' } : null),
      innerText: 'Parcial 1'
    } as any;

    modal.open(examenChip);
    const overlayExamen = modal.getModalOverlay();
    assert.ok(overlayExamen);
    assert.ok(overlayExamen.querySelector('#gcal-detail-btn-delete'), 'Delete button must exist for examen');
    assert.ok(overlayExamen.innerHTML.includes('id="gcal-detail-btn-delete"'), 'Delete button must appear in toolbar for examen');
    modal.close();
  });

  test('Correctly extracts isoDate and cleans compound eventId in parseChipData', () => {
    const fakeChip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') {
          return 'De 16:00 a 18:00, [EXAMEN] 🧑‍💻 Programación 1 - Parcial 2, Calendario: 📋 Examenes, 24 de noviembre de 2026';
        }
        if (attr === 'data-eventid') return 'evt_composite_9999 user_account@gmail.com';
        return null;
      },
      querySelector: (sel: string) => (sel === '.I0UMhf' ? { textContent: '[EXAMEN] 🧑‍💻 Programación 1 - Parcial 2' } : null),
      innerText: 'Parcial 2'
    } as any;

    const detail = modal.parseChipData(fakeChip);
    assert.equal(detail.isoDate, '2026-11-24');
    assert.equal(detail.eventId, 'evt_composite_9999');
    assert.equal(detail.type, 'EXAMEN');
  });

  test('Renders interactive rescheduling triggers and panel in detail modal', () => {
    const chip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') return 'De 10:00 a 12:00, [ENTREGA] 💵 Fundamentos de Economía - Caso 1, Calendario: 🗓️ Entegras, 12 de diciembre de 2026';
        if (attr === 'data-eventid') return 'evt_eco_1';
        return null;
      },
      querySelector: (sel: string) => (sel === '.I0UMhf' ? { textContent: '[ENTREGA] 💵 Fundamentos de Economía - Caso 1' } : null),
      innerText: 'Caso 1'
    } as any;

    modal.open(chip);
    const overlay = modal.getModalOverlay();
    assert.ok(overlay);
    assert.ok(overlay.innerHTML.includes('id="gcal-detail-btn-open-reschedule"'), 'Mover fecha / hora button must exist');
    assert.ok(overlay.innerHTML.includes('id="gcal-detail-bento-date"'), 'Interactive date bento must exist');
    assert.ok(overlay.innerHTML.includes('id="gcal-detail-bento-time"'), 'Interactive time bento must exist');
    assert.ok(overlay.innerHTML.includes('id="gcal-detail-reschedule-panel"'), 'Reschedule panel container must exist');
    assert.ok(overlay.innerHTML.includes('id="gcal-reschedule-btn-confirm"'), 'Confirm reschedule button must exist');
    modal.close();
  });

  test('GoogleCalendarAdapter.moveAcademicEvent invokes desktopApi moveAcademicEventBackground successfully', async () => {
    const { GoogleCalendarAdapter } = require('../injected/adapter/GoogleCalendarAdapter');
    const adapter = GoogleCalendarAdapter.getInstance();
    let calledWith: any = null;
    (global as any).window = {
      gcalDesktopAPI: {
        moveAcademicEventBackground: async (data: any) => {
          calledWith = data;
          return { success: true };
        }
      }
    };

    const newPayload = {
      type: 'ENTREGA' as const,
      subject: '🧑‍💻 Programación 1',
      title: 'Práctica 4 Re-entregada',
      date: '2026-12-20',
      startTime: '10:00',
      endTime: '12:00'
    };

    const success = await adapter.moveAcademicEvent('evt_move_777', newPayload);
    assert.equal(success, true);
    assert.ok(calledWith);
    assert.equal(calledWith.eventId, 'evt_move_777');
    assert.equal(calledWith.payload.title, 'Práctica 4 Re-entregada');
    assert.equal(calledWith.payload.date, '2026-12-20');
  });

  test('AcademicDetailModal confirm delete triggers desktopApi.deleteAcademicEventBackground with eventId', async () => {
    let deletedId: string | null = null;
    (global as any).window = {
      addEventListener: () => {},
      removeEventListener: () => {},
      gcalDesktopAPI: {
        deleteAcademicEventBackground: async (id: string) => {
          deletedId = id;
          return { success: true };
        }
      }
    };

    let confirmClickListener: any = null;
    const mockOverlay: any = {
      id: '',
      style: { cssText: '' },
      children: [],
      innerHTML: '',
      remove: () => {},
      addEventListener: () => {},
      querySelector: (selector: string) => {
        if (selector === '#gcal-detail-confirm-delete') {
          return {
            id: 'gcal-detail-confirm-delete',
            disabled: false,
            textContent: '',
            addEventListener: (_event: string, fn: any) => {
              confirmClickListener = fn;
            }
          };
        }
        return { addEventListener: () => {}, style: {}, textContent: '', value: '' };
      },
      querySelectorAll: () => []
    };

    (global as any).document = {
      getElementById: () => null,
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: (tag: string) => {
        if (tag === 'div') return mockOverlay;
        return { setAttribute: () => {}, textContent: '', appendChild: () => {} };
      },
      head: { appendChild: () => {} },
      body: {
        appendChild: () => {},
        setAttribute: () => {},
        getAttribute: () => null
      }
    };

    const chip = {
      getAttribute: (attr: string) => {
        if (attr === 'aria-label') return 'De 10:00 a 12:00, [EXAMEN] 🧑‍💻 Programación 1 - Parcial Final, Calendario: 📋 Examenes, 15 de diciembre de 2026';
        if (attr === 'data-eventid') return 'evt_final_9999 user@gmail.com';
        return null;
      },
      querySelector: (sel: string) => (sel === '.I0UMhf' ? { textContent: '[EXAMEN] 🧑‍💻 Programación 1 - Parcial Final' } : null),
      innerText: 'Parcial Final',
      style: { transition: '', opacity: '' },
      remove: () => {}
    } as any;

    modal.open(chip);
    assert.ok(confirmClickListener, 'Confirm delete listener should be attached');
    await confirmClickListener();
    assert.equal(deletedId, 'evt_final_9999', 'deleteAcademicEventBackground should be called with extracted eventId');
    modal.close();
  });
});

describe('24. Full Editor Navigation & Return Controller', () => {
  const { FullEditorNavigation } = require('../injected/ui/fullEditorNavigation');

  test('isFullEditorActive accurately detects Google Calendar eventedit routes', () => {
    const nav = FullEditorNavigation.getInstance();

    (global as any).window = {
      location: { pathname: '/calendar/u/0/r/eventedit/abc12345' }
    };
    assert.equal(nav.isFullEditorActive(), true);

    (global as any).window = {
      location: { pathname: '/calendar/u/0/r' }
    };
    assert.equal(nav.isFullEditorActive(), false);

    (global as any).window = {
      location: { pathname: '/calendar/u/0/r/month' }
    };
    assert.equal(nav.isFullEditorActive(), false);
  });

  test('isCloseButtonTarget accurately detects Google native discard triggers and top-left header geometry', () => {
    const nav = FullEditorNavigation.getInstance();

    // 1. Explicit ID
    const target1 = {
      closest: (sel: string) => (sel.includes('#xPrCloseBu') ? {} : null),
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 100, left: 100, width: 30, height: 30 })
    } as any;
    assert.equal(nav.isCloseButtonTarget(target1), true);

    // 2. Semantic ARIA
    const target2 = {
      closest: (sel: string) => (sel.includes('[aria-label]') ? target2 : null),
      getAttribute: (attr: string) => (attr === 'aria-label' ? 'Descartar cambios' : null),
      getBoundingClientRect: () => ({ top: 100, left: 100, width: 30, height: 30 })
    } as any;
    assert.equal(nav.isCloseButtonTarget(target2), true);

    // 3. Top-left geometry heuristic (Google native position)
    const target3 = {
      closest: (sel: string) => (sel.includes('button') ? target3 : null),
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 12, left: 16, width: 40, height: 40 })
    } as any;
    assert.equal(nav.isCloseButtonTarget(target3), true);

    // 4. Unrelated button
    const target4 = {
      closest: (sel: string) => (sel.includes('button') ? target4 : null),
      getAttribute: () => null,
      getBoundingClientRect: () => ({ top: 12, left: 300, width: 120, height: 40 })
    } as any;
    assert.equal(nav.isCloseButtonTarget(target4), false);
  });

  test('setupNativeCloseButton mounts authentic fallback ✕ button when native button is not yet rendered', () => {
    let appendedEl: any = null;
    let navigatedUrl = '';

    (global as any).window = {
      location: {
        pathname: '/calendar/u/0/r/eventedit/evt_456',
        set href(val: string) { navigatedUrl = val; },
        get href() { return navigatedUrl; }
      },
      history: {
        length: 1,
        back: () => {}
      },
      addEventListener: () => {},
      removeEventListener: () => {}
    };

    (global as any).document = {
      getElementById: (id: string) => (appendedEl && appendedEl.id === id ? appendedEl : null),
      querySelectorAll: () => [],
      querySelector: () => null,
      createElement: () => ({
        id: '',
        type: '',
        style: { cssText: '' },
        innerHTML: '',
        setAttribute: () => {},
        addEventListener: (event: string, handler: Function) => {
          if (event === 'click') {
            handler({ preventDefault: () => {} });
          }
        },
        remove: () => { appendedEl = null; }
      }),
      head: { appendChild: () => {} },
      body: {
        appendChild: (el: any) => { appendedEl = el; }
      }
    };

    const nav = FullEditorNavigation.getInstance();
    nav.setupNativeCloseButton();

    assert.ok(appendedEl, 'Fallback ✕ button should be mounted');
    assert.equal(appendedEl.id, 'gcal-native-close-btn');
    assert.ok(navigatedUrl.includes('/calendar/u/0/r'), 'Clicking fallback ✕ button should return to calendar');
    nav.destroy();
  });
});

