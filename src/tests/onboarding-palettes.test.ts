import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PREDEFINED_PALETTES, getPaletteById } from '../shared/palettes';
import { GoogleCalendarAdapter } from '../injected/adapter/GoogleCalendarAdapter';
import { OnboardingModal } from '../injected/ui/onboardingModal';
import {
  getAcademicPlan,
  saveAcademicPlan,
  formatPeriodLabel,
  advanceToNextTerm,
  switchToTerm,
  isTermCompleted,
  setTermCompleted,
  exportPortableBackup,
  importPortableBackup
} from '../injected/services/academicPlanService';
import { saveSubjectGrades, getSubjectGrades } from '../injected/services/gradesStorage';

describe('10. Specialized Color Palettes & Aesthetic Theme Systems', () => {
  test('Contains all 4 specialized palettes: Mildliner, Catppuccin, Nord, Morandi', () => {
    const ids = PREDEFINED_PALETTES.map((p) => p.id);
    assert.ok(ids.includes('mildliner'), 'Should include Zebra Mildliner palette');
    assert.ok(ids.includes('catppuccin'), 'Should include Catppuccin palette');
    assert.ok(ids.includes('nord'), 'Should include Nord palette');
    assert.ok(ids.includes('morandi'), 'Should include Morandi palette');
  });

  test('All palette colors have valid 7-character hex codes (#RRGGBB)', () => {
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    for (const palette of PREDEFINED_PALETTES) {
      assert.ok(palette.colors.length >= 5, `${palette.id} should have at least 5 colors`);
      for (const color of palette.colors) {
        assert.match(color.hex, hexRegex, `Color ${color.name} in ${palette.id} must be valid hex`);
      }
    }
  });

  test('Zebra Mildliner palette contains authentic study highlighter shades', () => {
    const mildliner = getPaletteById('mildliner');
    assert.equal(mildliner.id, 'mildliner');
    const hexes = mildliner.colors.map((c) => c.hex.toUpperCase());
    assert.ok(hexes.includes('#98D5E8'), 'Should include Mild Blue');
    assert.ok(hexes.includes('#A1D0CA'), 'Should include Mild Blue Green');
    assert.ok(hexes.includes('#F0F4A3'), 'Should include Mild Yellow');
    assert.ok(hexes.includes('#FFB6D9'), 'Should include Mild Pink');
  });

  test('Catppuccin palette contains authentic soft pastel hues', () => {
    const catppuccin = getPaletteById('catppuccin');
    assert.equal(catppuccin.id, 'catppuccin');
    const hexes = catppuccin.colors.map((c) => c.hex.toLowerCase());
    assert.ok(hexes.includes('#74c7ec'), 'Should include Sapphire');
    assert.ok(hexes.includes('#a6e3a1'), 'Should include Green');
    assert.ok(hexes.includes('#cba6f7'), 'Should include Mauve');
  });

  test('Nord palette contains authentic Frost & Aurora specifications', () => {
    const nord = getPaletteById('nord');
    assert.equal(nord.id, 'nord');
    const hexes = nord.colors.map((c) => c.hex.toUpperCase());
    assert.ok(hexes.includes('#88C0D0'), 'Should include Frost Cyan (nord8)');
    assert.ok(hexes.includes('#81A1C1'), 'Should include Frost Blue (nord9)');
    assert.ok(hexes.includes('#A3BE8C'), 'Should include Aurora Green (nord14)');
  });

  test('Morandi palette contains authentic dusty and earthy tones', () => {
    const morandi = getPaletteById('morandi');
    assert.equal(morandi.id, 'morandi');
    const hexes = morandi.colors.map((c) => c.hex.toUpperCase());
    assert.ok(hexes.includes('#99B9C6'), 'Should include Morandi Blue');
    assert.ok(hexes.includes('#A9B4A1'), 'Should include Morandi Green');
  });

  test('getPaletteById falls back gracefully to default palette for unknown id', () => {
    const fallback = getPaletteById('non-existent-palette');
    assert.equal(fallback.id, 'mildliner');
  });
});

describe('11. Dynamic Academic Subjects & Resilient Calendar Integration', () => {
  test('getDetectedClasses returns realistic academic subjects fallback', () => {
    const adapter = GoogleCalendarAdapter.getInstance();
    const subjects = adapter.getDetectedClasses();
    assert.ok(Array.isArray(subjects));
    assert.ok(subjects.length >= 4);
    assert.ok(subjects.includes('Matemáticas') || subjects.includes('Clase 1'));
  });

  test('Color map matches configured subject names deterministically', () => {
    const adapter = GoogleCalendarAdapter.getInstance();
    const colorMap = adapter.getSubjectColorMap();
    assert.ok(colorMap instanceof Map);
    assert.ok(colorMap.size > 0);

    const mathColor = adapter.findSubjectColor('Matemáticas', colorMap);
    assert.ok(Boolean(mathColor));
    assert.match(mathColor, /^#[0-9A-Fa-f]{6}$/);
  });

  test('OnboardingModal supports opening in edit mode for reconfiguring subjects', () => {
    const modal = OnboardingModal.getInstance();
    assert.ok(modal);
    assert.equal(typeof modal.open, 'function');
    assert.equal(typeof modal.close, 'function');

    // Test that close marks completed without throwing
    modal.close();
  });

  test('Supports dynamic subject lists with 8+ simultaneous courses without errors', () => {
    const adapter = GoogleCalendarAdapter.getInstance();
    const subjects8 = [
      { name: 'Anatomía', color: '#98D5E8' },
      { name: 'Fisiología', color: '#A1D0CA' },
      { name: 'Bioquímica', color: '#F0F4A3' },
      { name: 'Histología', color: '#FFB6D9' },
      { name: 'Bioestadística', color: '#FFDFB5' },
      { name: 'Inmunología', color: '#E3B1C3' },
      { name: 'Genética Médica', color: '#C6B6D3' },
      { name: 'Microbiología', color: '#88C0D0' }
    ];

    // Mock localStorage storage
    const storage: Record<string, string> = {
      gcal_academic_subjects: JSON.stringify(subjects8)
    };
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] || null,
      setItem: (k: string, v: string) => { storage[k] = v; }
    };

    const detected = adapter.getDetectedClasses();
    assert.equal(detected.length, 8);
    assert.ok(detected.includes('Microbiología'));
    assert.ok(detected.includes('Genética Médica'));

    // Check color assignment for 8th subject
    const colorMap = adapter.getSubjectColorMap();
    const c8 = adapter.findSubjectColor('Microbiología', colorMap);
    assert.ok(Boolean(c8));
    assert.match(c8, /^#[0-9A-Fa-f]{6}$/);
  });

  test('Visualization preferences: defaults preserve creator cleanliness (Zero Disruption)', () => {
    const adapter = GoogleCalendarAdapter.getInstance();
    
    // Clear mock storage
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] || null,
      setItem: (k: string, v: string) => { storage[k] = v; }
    };

    // By default, birthdays are hidden and other calendars are preserved/shown by default [P0-03]
    assert.equal(adapter.shouldHideBirthdays(), true, 'Birthdays must be hidden by default');
    assert.equal(adapter.shouldShowOtherCalendars(), true, 'Other calendars must be shown by default');

    // When explicitly toggled by user in settings (Ctrl+,)
    storage['gcal_hide_birthdays'] = 'false';
    storage['gcal_show_other_calendars'] = 'false';
    assert.equal(adapter.shouldHideBirthdays(), false, 'Birthdays should be visible when opted in');
    assert.equal(adapter.shouldShowOtherCalendars(), false, 'Other calendars should be hidden when opted out');
  });

  test('Dynamic subject resolution does not override custom subjects with hardcoded keywords', () => {
    const adapter = GoogleCalendarAdapter.getInstance();
    const customMap = new Map<string, string>([
      ['arquitectura de computadores', '#112233'],
      ['computadores y redes', '#445566']
    ]);

    // Should resolve exact matches directly from map
    assert.equal(adapter.findSubjectColor('arquitectura de computadores', customMap), '#112233');
    assert.equal(adapter.findSubjectColor('computadores y redes', customMap), '#445566');
  });
});

describe('26. Academic Career Plan, Term Switching & Portable Backup (.cursa.json)', () => {
  test('Supports general career structures (cuatrimestre, semestre, trimestre, anual) and year bounds', () => {
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null
    };

    // Generic default is 4 years, 2 cuatrimestres
    const defPlan = getAcademicPlan();
    assert.equal(defPlan.totalYears, 4);
    assert.equal(defPlan.periodType, 'cuatrimestre');
    assert.equal(defPlan.periodsPerYear, 2);
    assert.equal(formatPeriodLabel(defPlan), '1º Año · 1º Cuatrimestre');

    // Configure 6 years and 2 cuatrimestres
    const sixYearPlan = saveAcademicPlan({
      totalYears: 6,
      periodType: 'cuatrimestre',
      currentYear: 2,
      currentPeriod: 2
    });
    assert.equal(sixYearPlan.totalYears, 6);
    assert.equal(sixYearPlan.periodsPerYear, 2);
    assert.equal(formatPeriodLabel(sixYearPlan), '2º Año · 2º Cuatrimestre');

    // Configure trimestral regime (3 per year)
    const triPlan = saveAcademicPlan({
      totalYears: 3,
      periodType: 'trimestre',
      currentYear: 1,
      currentPeriod: 3
    });
    assert.equal(triPlan.periodsPerYear, 3);
    assert.equal(formatPeriodLabel(triPlan), '1º Año · 3º Trimestre');
  });

  test('Advances across periods and years while archiving and restoring subjects & grades', () => {
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null
    };

    saveAcademicPlan({
      totalYears: 6,
      periodType: 'cuatrimestre',
      currentYear: 1,
      currentPeriod: 1
    });

    const q1Subjects = [
      { name: 'Cálculo I', color: '#98D5E8' },
      { name: 'Álgebra Lineal', color: '#A1D0CA' }
    ];
    saveSubjectGrades({
      subjectName: 'Cálculo I',
      credits: 6,
      minFinalGradeRequired: 4.0,
      items: [{ id: '1', name: 'Examen Final', type: 'EXAMEN', weight: 100, grade: 8.5 }],
      updatedAt: Date.now()
    });

    // Advance from 1º Año · 1º Cuatrimestre -> 1º Año · 2º Cuatrimestre
    const step1 = advanceToNextTerm(q1Subjects, 'mildliner');
    assert.equal(step1.isLastTerm, false);
    assert.equal(step1.plan.currentYear, 1);
    assert.equal(step1.plan.currentPeriod, 2);
    assert.equal(step1.previousTermLabel, '1º Año · 1º Cuatrimestre');
    assert.equal(step1.newTermLabel, '1º Año · 2º Cuatrimestre');
    assert.equal(step1.subjects.length, 0, 'New unconfigured period must start with 0 subjects so Q1 subjects disappear');
    assert.equal(GoogleCalendarAdapter.getInstance().getDetectedClasses().length, 0, 'Adapter must return 0 subjects for empty Q2');
    assert.equal(getSubjectGrades('Cálculo I'), null, 'Previous term grade should be archived and cleared from active');

    // Configure 1º Año · 2º Cuatrimestre subjects and advance -> 2º Año · 1º Cuatrimestre
    const q2Subjects = [{ name: 'Física II', color: '#FFB6D9' }];
    const step2 = advanceToNextTerm(q2Subjects, 'catppuccin');
    assert.equal(step2.plan.currentYear, 2);
    assert.equal(step2.plan.currentPeriod, 1);
    assert.equal(step2.subjects.length, 0);

    // Switch back to 1º Año · 1º Cuatrimestre and verify 100% restoration
    const restoredQ1 = switchToTerm(1, 1, step2.subjects, step2.paletteId);
    assert.equal(restoredQ1.restoredFromArchive, true);
    assert.equal(restoredQ1.subjects.length, 2);
    assert.equal(restoredQ1.subjects[0].name, 'Cálculo I');
    assert.deepEqual(GoogleCalendarAdapter.getInstance().getDetectedClasses(), ['Cálculo I', 'Álgebra Lineal']);
    const restoredCalcGrade = getSubjectGrades('Cálculo I');
    assert.ok(restoredCalcGrade);
    assert.equal(restoredCalcGrade.items[0].grade, 8.5);

    // Modify grade in Q1 directly via saveSubjectGrades, switch to Q2 and back to Q1 -> verify live sync
    saveSubjectGrades({
      subjectName: 'Álgebra Lineal',
      credits: 6,
      minFinalGradeRequired: 4.0,
      items: [{ id: 'alg1', name: 'Práctica 1', type: 'ENTREGA', weight: 40, grade: 9.0 }],
      updatedAt: Date.now()
    });
    const backToQ2 = switchToTerm(1, 2, restoredQ1.subjects, restoredQ1.paletteId);
    assert.equal(backToQ2.subjects.length, 1);
    assert.equal(backToQ2.subjects[0].name, 'Física II');
    assert.equal(getSubjectGrades('Álgebra Lineal'), null);

    const againQ1 = switchToTerm(1, 1, backToQ2.subjects, backToQ2.paletteId);
    assert.equal(againQ1.subjects.length, 2);
    assert.equal(getSubjectGrades('Álgebra Lineal')?.items[0].grade, 9.0);
  });

  test('Exports and imports portable backup (.cursa.json) preserving full state', () => {
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null
    };

    saveAcademicPlan({
      totalYears: 6,
      periodType: 'cuatrimestre',
      currentYear: 3,
      currentPeriod: 1
    });

    const subjects = [
      { name: 'Sistemas Operativos', color: '#88C0D0' },
      { name: 'Redes de Computadores', color: '#A3BE8C' }
    ];
    saveSubjectGrades({
      subjectName: 'Sistemas Operativos',
      credits: 6,
      minFinalGradeRequired: 5.0,
      items: [{ id: 'so1', name: 'Proyecto Kernel', type: 'ENTREGA', weight: 100, grade: 9.2 }],
      updatedAt: Date.now()
    });

    const backup = exportPortableBackup(subjects, 'nord');
    assert.equal(backup.schema, 'cursa-portable-backup');
    assert.equal(backup.academicPlan.totalYears, 6);
    assert.equal(backup.academicPlan.currentYear, 3);
    assert.equal(backup.activePalette, 'nord');

    // Wipe storage and restore from JSON
    for (const k of Object.keys(storage)) delete storage[k];
    const restored = importPortableBackup(JSON.stringify(backup));
    assert.equal(restored.plan.totalYears, 6);
    assert.equal(restored.plan.currentYear, 3);
    assert.equal(restored.paletteId, 'nord');
    assert.equal(restored.subjects.length, 2);
    assert.equal(getSubjectGrades('Sistemas Operativos')?.items[0].grade, 9.2);
  });

  test('OnboardingModal Option 3 Bento layout collapses secondary drawers in edit mode and never stacks duplicate overlays', () => {
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null
    };

    saveAcademicPlan({ totalYears: 6, periodType: 'cuatrimestre', currentYear: 1, currentPeriod: 1 });
    storage['gcal_academic_subjects'] = JSON.stringify([
      { name: 'Matemáticas', color: '#98D5E8' },
      { name: 'Física', color: '#A1D0CA' }
    ]);

    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    try {
      const bodyChildren: any[] = [];
      const headChildren: any[] = [];
      const makeFakeEl = (tag: string) => {
        let html = '';
        const el: any = {
          tagName: tag.toUpperCase(),
          id: '',
          style: {},
          textContent: '',
          get innerHTML() { return html; },
          set innerHTML(v: string) { html = v; },
          appendChild(child: any) {
            if (this === fakeDoc.body) bodyChildren.push(child);
            if (this === fakeDoc.head) headChildren.push(child);
            return child;
          },
          remove() {
            const idx = bodyChildren.indexOf(el);
            if (idx >= 0) bodyChildren.splice(idx, 1);
          },
          contains(target: any) { return bodyChildren.includes(target); },
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener: () => {},
          setAttribute: () => {},
          getAttribute: () => null
        };
        return el;
      };

      const fakeDoc: any = {
        head: makeFakeEl('head'),
        body: makeFakeEl('body'),
        createElement: (tag: string) => makeFakeEl(tag),
        getElementById: (id: string) => headChildren.find((c) => c.id === id) || null,
        querySelector: () => null,
        querySelectorAll: (sel: string) =>
          sel === '#gcal-onboarding-modal-overlay'
            ? bodyChildren.filter((c) => c.id === 'gcal-onboarding-modal-overlay')
            : []
      };

      (global as any).document = fakeDoc;
      (global as any).window = {
        addEventListener: () => {},
        removeEventListener: () => {}
      };

      const modal = OnboardingModal.getInstance();
      modal.open(true);

      const overlays = bodyChildren.filter((c) => c.id === 'gcal-onboarding-modal-overlay');
      assert.equal(overlays.length, 1, 'Should mount exactly one overlay');
      assert.ok(overlays[0].innerHTML.includes('cursa-ob-bento-grid'), 'Should render 2-column Bento grid');
      assert.ok(overlays[0].innerHTML.includes('gcal-plan-editor-toggle'), 'Should render compact career plan pill');
      assert.ok(overlays[0].innerHTML.includes('gcal-palette-dropdown-toggle'), 'Should render compact palette dropdown pill');
      assert.ok(overlays[0].innerHTML.includes('id="gcal-plan-editor-drawer" class="cursa-ob-plan-drawer" style="display: none;"'), 'Career structure drawer must start collapsed in edit mode');
      assert.ok(overlays[0].innerHTML.includes('id="gcal-prefs-body" style="\n              display: none;'), 'Advanced preferences must start collapsed');

      // Re-rendering multiple times must NOT stack duplicate overlays
      (modal as any).render();
      (modal as any).render();
      assert.equal(
        bodyChildren.filter((c) => c.id === 'gcal-onboarding-modal-overlay').length,
        1,
        'Re-rendering must reuse overlay in place without stacking duplicates'
      );

      modal.close();
      assert.equal(
        bodyChildren.filter((c) => c.id === 'gcal-onboarding-modal-overlay').length,
        0,
        'Closing modal must remove overlay cleanly'
      );
    } finally {
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
    }
  });

  test('Periods do NOT turn green automatically when loaded or switched; only explicit Completado marks them green', () => {
    const storage: Record<string, string> = {};
    (global as any).localStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null
    };

    saveAcademicPlan({ totalYears: 6, periodType: 'cuatrimestre', currentYear: 1, currentPeriod: 1 });
    const q1Subjects = [
      { name: 'Cálculo I', color: '#98D5E8' },
      { name: 'Física I', color: '#A1D0CA' }
    ];

    // Switch away from 1Q (with subjects) to 2Q — 1Q must NOT be marked completed automatically!
    switchToTerm(1, 2, q1Subjects, 'mildliner');
    assert.equal(isTermCompleted(1, 1), false, '1Q with subjects must NOT become completed automatically');
    assert.equal(isTermCompleted(1, 2), false, '2Q must start uncompleted');

    // Explicitly mark 1Q as completed and verify persistence across switches & portable backup
    switchToTerm(1, 1, [], 'mildliner');
    setTermCompleted(1, 1, true, q1Subjects, 'mildliner');
    assert.equal(isTermCompleted(1, 1), true, '1Q must be completed after explicit setTermCompleted(true)');

    switchToTerm(1, 2, q1Subjects, 'mildliner');
    assert.equal(isTermCompleted(1, 1), true, '1Q completion state must persist after switching to 2Q');
    assert.equal(isTermCompleted(1, 2), false, '2Q remains uncompleted');

    // Verify UI renders explicit Completado button and only marks 1Q slot data-completed="true"
    const prevDoc = (global as any).document;
    const prevWin = (global as any).window;
    try {
      const bodyChildren: any[] = [];
      const headChildren: any[] = [];
      const makeFakeEl = (tag: string) => {
        let html = '';
        const el: any = {
          tagName: tag.toUpperCase(),
          id: '',
          style: {},
          textContent: '',
          get innerHTML() { return html; },
          set innerHTML(v: string) { html = v; },
          appendChild(child: any) {
            if (this === fakeDoc.body) bodyChildren.push(child);
            if (this === fakeDoc.head) headChildren.push(child);
            return child;
          },
          remove() {
            const idx = bodyChildren.indexOf(el);
            if (idx >= 0) bodyChildren.splice(idx, 1);
          },
          contains(target: any) { return bodyChildren.includes(target); },
          querySelector: () => null,
          querySelectorAll: () => [],
          addEventListener: () => {},
          setAttribute: () => {},
          getAttribute: () => null
        };
        return el;
      };
      const fakeDoc: any = {
        head: makeFakeEl('head'),
        body: makeFakeEl('body'),
        createElement: (tag: string) => makeFakeEl(tag),
        getElementById: (id: string) => headChildren.find((c) => c.id === id) || null,
        querySelector: () => null,
        querySelectorAll: (sel: string) =>
          sel === '#gcal-onboarding-modal-overlay'
            ? bodyChildren.filter((c) => c.id === 'gcal-onboarding-modal-overlay')
            : []
      };
      (global as any).document = fakeDoc;
      (global as any).window = { addEventListener: () => {}, removeEventListener: () => {} };

      const modal = OnboardingModal.getInstance();
      modal.open(true);
      const html = bodyChildren[0].innerHTML as string;
      assert.ok(html.includes('id="gcal-toggle-term-completed-btn"'), 'Should render explicit Completado toggle button');
      assert.ok(
        html.includes('data-term-year="1"\n            data-term-period="1"\n            data-completed="true"'),
        '1Q should be marked data-completed="true"'
      );
      assert.ok(
        html.includes('data-term-year="1"\n            data-term-period="2"\n            data-completed="false"'),
        '2Q should be marked data-completed="false"'
      );
      modal.close();
    } finally {
      (global as any).document = prevDoc;
      (global as any).window = prevWin;
    }

    // Export & re-import portable backup preserves completed flag; unmarking also works
    const backup = exportPortableBackup([], 'mildliner');
    for (const k of Object.keys(storage)) delete storage[k];
    importPortableBackup(JSON.stringify(backup));
    assert.equal(isTermCompleted(1, 1), true, 'Portable backup must preserve completed=true on 1Q');
    assert.equal(isTermCompleted(1, 2), false, 'Portable backup must preserve completed=false on 2Q');

    setTermCompleted(1, 1, false);
    assert.equal(isTermCompleted(1, 1), false, 'Unmarking Completado must return term to false');
  });
});


