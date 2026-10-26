import { describe, it } from 'node:test';
import assert from 'node:assert';
import { GradeItem } from '../shared/gradesTypes';
import {
  calculateAccumulatedScore,
  calculateTargetRequiredGrade,
  calculateSimulatedFinalGrade,
  groupGradeItems
} from '../shared/gradesCalculator';
import { GeminiGradesService } from '../injected/services/geminiGradesService';
import { getSubjectGrades, saveSubjectGrades, deleteSubjectGrades } from '../injected/services/gradesStorage';

describe('22. Grades Simulator & Evaluation Calculation Engine', () => {
  it('correctly calculates accumulated points from partially graded items', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Parcial 1', type: 'EXAMEN', weight: 15, grade: 6.5 },
      { id: '2', name: 'Parcial 2', type: 'EXAMEN', weight: 15, grade: 5.0 },
      { id: '3', name: 'Prácticas Lab', type: 'ENTREGA', weight: 20, grade: 8.5 },
      { id: '4', name: 'Examen Final', type: 'EXAMEN', weight: 50, grade: null }
    ];

    const result = calculateAccumulatedScore(items);
    // (6.5 * 0.15) = 0.975
    // (5.0 * 0.15) = 0.75
    // (8.5 * 0.20) = 1.70
    // Total = 0.975 + 0.75 + 1.70 = 3.425 -> 3.43
    assert.strictEqual(result.accumulatedPoints, 3.43);
    assert.strictEqual(result.gradedWeight, 50);
    assert.strictEqual(result.totalWeight, 100);
  });

  it('calculates target required grade correctly for Passing (5.0) and Notable (7.0)', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Parcial 1', type: 'EXAMEN', weight: 20, grade: 7.0 },
      { id: '2', name: 'Práctica Lab', type: 'ENTREGA', weight: 30, grade: 8.0 },
      { id: '3', name: 'Examen Final', type: 'EXAMEN', weight: 50, grade: null }
    ];

    // Accumulated: (7 * 0.2) + (8 * 0.3) = 1.4 + 2.4 = 3.80 points (graded weight: 50%)
    // Remaining weight: 50%
    // To reach 5.0: Needs (5.0 - 3.8) / 0.50 = 1.2 / 0.5 = 2.40
    const passTarget = calculateTargetRequiredGrade(items, 5.0);
    assert.strictEqual(passTarget.accumulatedPoints, 3.80);
    assert.strictEqual(passTarget.requiredFinalGrade, 2.40);
    assert.strictEqual(passTarget.isPossible, true);
    assert.strictEqual(passTarget.isCutoffTriggered, false);

    // To reach 7.0: Needs (7.0 - 3.8) / 0.50 = 3.2 / 0.5 = 6.40
    const notableTarget = calculateTargetRequiredGrade(items, 7.0);
    assert.strictEqual(notableTarget.requiredFinalGrade, 6.40);
    assert.strictEqual(notableTarget.isPossible, true);
  });

  it('enforces cut-off minimum grade when calculated required grade is below cut-off', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Parcial 1', type: 'EXAMEN', weight: 20, grade: 8.0 },
      { id: '2', name: 'Práctica Lab', type: 'ENTREGA', weight: 30, grade: 9.0 },
      { id: '3', name: 'Examen Final', type: 'EXAMEN', weight: 50, grade: null }
    ];

    // Accumulated: (8 * 0.2) + (9 * 0.3) = 1.6 + 2.7 = 4.30 points
    // To reach 5.0: Mathematically only needs (5.0 - 4.30) / 0.5 = 1.40
    // BUT professor cut-off rule requires minFinalGradeRequired = 4.50
    const passTargetWithCutoff = calculateTargetRequiredGrade(items, 5.0, 4.5);
    assert.strictEqual(passTargetWithCutoff.requiredFinalGrade, 4.50);
    assert.strictEqual(passTargetWithCutoff.isCutoffTriggered, true);
    assert.strictEqual(passTargetWithCutoff.minCutoff, 4.5);
    assert.strictEqual(passTargetWithCutoff.isPossible, true);
  });

  it('identifies mathematically impossible target (> 10.00)', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Parcial 1', type: 'EXAMEN', weight: 30, grade: 3.0 }, // 0.9 ptos
      { id: '2', name: 'Prácticas', type: 'ENTREGA', weight: 30, grade: 3.0 }, // 0.9 ptos
      { id: '3', name: 'Examen Final', type: 'EXAMEN', weight: 40, grade: null }
    ];

    // Accumulated: 1.80 ptos. Remaining: 40%.
    // To reach 9.0 (Sobresaliente): (9.0 - 1.80) / 0.40 = 7.2 / 0.4 = 18.00 -> Impossible!
    const target = calculateTargetRequiredGrade(items, 9.0);
    assert.strictEqual(target.isPossible, false);
    assert.ok(target.requiredFinalGrade > 10.0);
  });

  it('simulates final course grade with cut-off evaluation', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Parcial 1', type: 'EXAMEN', weight: 30, grade: 7.0 }, // 2.1 ptos
      { id: '2', name: 'Prácticas', type: 'ENTREGA', weight: 30, grade: 8.0 }, // 2.4 ptos
      { id: '3', name: 'Examen Final', type: 'EXAMEN', weight: 40, grade: null }
    ];

    // If simulated score is 6.0: (2.1 + 2.4) + (6.0 * 0.4) = 4.5 + 2.4 = 6.90
    const simPass = calculateSimulatedFinalGrade(items, 6.0, 4.0);
    assert.strictEqual(simPass.finalGrade, 6.90);
    assert.strictEqual(simPass.isCutoffFailed, false);

    // If simulated score is 3.5 with cut-off 4.0 -> cutoff failed!
    const simFail = calculateSimulatedFinalGrade(items, 3.5, 4.0);
    assert.strictEqual(simFail.isCutoffFailed, true);
    assert.strictEqual(simFail.minCutoff, 4.0);
  });

  it('does not falsely fail cutoff when 100% of items are already graded above cutoff regardless of slider value', () => {
    const fullyGraded: GradeItem[] = [
      { id: '1', name: 'Parcial', type: 'EXAMEN', weight: 40, grade: 8.0 },
      { id: '2', name: 'Examen Final', type: 'EXAMEN', weight: 60, grade: 7.5 }
    ];

    const sim = calculateSimulatedFinalGrade(fullyGraded, 2.0, 4.0);
    assert.strictEqual(sim.finalGrade, 7.70);
    assert.strictEqual(sim.isCutoffFailed, false);

    const failedRealFinal: GradeItem[] = [
      { id: '1', name: 'Práctica pendiente', type: 'ENTREGA', weight: 20, grade: null },
      { id: '2', name: 'Examen Final', type: 'EXAMEN', weight: 80, grade: 3.0 }
    ];
    const simRealFail = calculateSimulatedFinalGrade(failedRealFinal, 9.0, 4.0);
    assert.strictEqual(simRealFail.isCutoffFailed, true);
  });

  it('enforces independent blockCutoffs in calculateTargetRequiredGrade and preserves manual items containing "+" in storage', () => {
    const blockItems: GradeItem[] = [
      { id: '1', name: 'Prácticas', type: 'ENTREGA', weight: 50, grade: 9.0, category: 'Prácticas' }, // 4.5 pts
      { id: '2', name: 'Examen Teoría', type: 'EXAMEN', weight: 50, grade: null, category: 'Teoría' }
    ];
    // Mathematically needs only (5.0 - 4.5) / 0.5 = 1.0, but Teoría block requires 4.0!
    const target = calculateTargetRequiredGrade(blockItems, 5.0, null, { Teoría: 4.0, Prácticas: 4.0 });
    assert.strictEqual(target.requiredFinalGrade, 4.0);
    assert.strictEqual(target.isCutoffTriggered, true);

    if (typeof (global as any).localStorage === 'undefined') {
      const store: Record<string, string> = {};
      (global as any).localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; }
      };
    }

    saveSubjectGrades({
      subjectName: 'Ingeniería del Software',
      credits: 6,
      items: [
        { id: 'm1', name: 'Memoria + Defensa', type: 'ENTREGA', weight: 40, grade: 8.0 },
        { id: 'm2', name: 'Examen Final', type: 'EXAMEN', weight: 60, grade: null }
      ],
      updatedAt: Date.now()
    });

    const loaded = getSubjectGrades('Ingeniería del Software');
    assert.ok(loaded);
    assert.strictEqual(loaded.items.length, 2, 'Manual item with + must not be split in storage');
    assert.strictEqual(loaded.items[0].grade, 8.0);
    assert.strictEqual(calculateAccumulatedScore(loaded.items).accumulatedPoints, 3.20);
    deleteSubjectGrades('Ingeniería del Software');
  });
});

describe('23. AI Syllabus Reasoning & Extraction', () => {
  it('extracts syllabus items, weights and cut-off grade from natural language text', () => {
    const service = GeminiGradesService.getInstance();
    const prompt = 'En esta materia tenemos dos parciales que valen el 20% en total, las prácticas son un 30% y un examen final del 50%, pero con mínimo un 4.5 para hacer media.';

    const extraction = service.extractSyllabusOfflineFallback('Física Cuántica', prompt);
    assert.strictEqual(extraction.subject, 'Física Cuántica');
    assert.strictEqual(extraction.minFinalGradeRequired, 4.5);
    assert.ok(extraction.items.length >= 3);

    const totalWeight = extraction.items.reduce((s, it) => s + it.weight, 0);
    assert.strictEqual(totalWeight, 100);

    const hasFinal = extraction.items.some((it) => it.name.includes('Final') && it.weight === 50);
    assert.ok(hasFinal, 'Must include Final Exam with 50% weight');
  });

  it('correctly calculates and solves multi-block syllabus with nested weights and pre-filled grade', () => {
    // 50% Theory (15% test + 35% problems) + 50% Practice (4 topics: 12.5% each, with 20% report / 80% exam)
    const items: GradeItem[] = [
      { id: '1', name: 'Teoría: Test (Temas 1 y 2)', type: 'EXAMEN', weight: 15, grade: null },
      { id: '2', name: 'Teoría: Examen de problemas', type: 'EXAMEN', weight: 35, grade: null },
      { id: '3', name: 'Prácticas: Examen Tema 1', type: 'EXAMEN', weight: 12.5, grade: 7.33 },
      { id: '4', name: 'Prácticas: Memoria Tema 2', type: 'ENTREGA', weight: 2.5, grade: null },
      { id: '5', name: 'Prácticas: Examen Tema 2', type: 'EXAMEN', weight: 10, grade: null },
      { id: '6', name: 'Prácticas: Memoria Tema 3', type: 'ENTREGA', weight: 2.5, grade: null },
      { id: '7', name: 'Prácticas: Examen Tema 3', type: 'EXAMEN', weight: 10, grade: null },
      { id: '8', name: 'Prácticas: Memoria Tema 4', type: 'ENTREGA', weight: 2.5, grade: null },
      { id: '9', name: 'Prácticas: Examen Tema 4', type: 'EXAMEN', weight: 10, grade: null }
    ];

    const accumulated = calculateAccumulatedScore(items);
    // 7.33 * 0.125 = 0.91625 -> 0.92
    assert.strictEqual(accumulated.accumulatedPoints, 0.92);
    assert.strictEqual(accumulated.gradedWeight, 12.5);
    assert.strictEqual(accumulated.totalWeight, 100);

    // Target to pass (5.0): Needs (5.0 - 0.92) / 0.875 = 4.66
    const passTarget = calculateTargetRequiredGrade(items, 5.0, 4.0);
    assert.strictEqual(passTarget.requiredFinalGrade, 4.66);
    assert.strictEqual(passTarget.isPossible, true);
    assert.strictEqual(passTarget.isCutoffTriggered, false);

    // Target for Notable (7.0): Needs (7.0 - 0.91625) / 0.875 = 6.95
    const notableTarget = calculateTargetRequiredGrade(items, 7.0, 4.0);
    assert.strictEqual(notableTarget.requiredFinalGrade, 6.95);
    assert.strictEqual(notableTarget.isPossible, true);
  });

  it('permanently deletes subject grades and configuration without leaving orphaned keys', () => {
    if (typeof (global as any).localStorage === 'undefined') {
      const store: Record<string, string> = {};
      (global as any).localStorage = {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => { store[k] = v; },
        removeItem: (k: string) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        key: (i: number) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; }
      };
    }

    const testConfig = {
      subjectName: 'Matemáticas Discretas',
      credits: 6,
      minFinalGradeRequired: 4.0,
      items: [
        { id: '1', name: 'Parcial', type: 'EXAMEN' as const, weight: 50, grade: 8.0 },
        { id: '2', name: 'Final', type: 'EXAMEN' as const, weight: 50, grade: null }
      ],
      updatedAt: Date.now()
    };

    saveSubjectGrades(testConfig);
    const retrieved = getSubjectGrades('Matemáticas Discretas');
    assert.ok(retrieved !== null, 'Configuration must be saved');
    assert.strictEqual(retrieved?.items.length, 2);

    // Delete it
    deleteSubjectGrades('Matemáticas Discretas');

    // Retrieve again - MUST be null!
    const afterDelete = getSubjectGrades('Matemáticas Discretas');
    assert.strictEqual(afterDelete, null, 'Must be completely null after deleteSubjectGrades');
  });

  it('dynamically groups items into blocks (Option 3 Accordion Matrix) using categories or prefixes', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Teoría: Test 1', type: 'EXAMEN', weight: 15, grade: 8.0, category: 'Teoría' },
      { id: '2', name: 'Teoría: Examen Problemas', type: 'EXAMEN', weight: 35, grade: null, category: 'Teoría' },
      { id: '3', name: 'Prácticas - Memoria 1', type: 'ENTREGA', weight: 10, grade: 9.0 },
      { id: '4', name: 'Prácticas - Examen 1', type: 'EXAMEN', weight: 40, grade: 6.0 }
    ];

    const groups = groupGradeItems(items);
    assert.strictEqual(groups.length, 2, 'Should create exactly 2 groups');

    const teoriaGroup = groups.find((g) => g.name === 'Teoría');
    assert.ok(teoriaGroup, 'Teoría group must exist');
    assert.strictEqual(teoriaGroup.totalWeight, 50);
    assert.strictEqual(teoriaGroup.gradedWeight, 15);
    // 8.0 * 0.15 = 1.20 pts
    assert.strictEqual(teoriaGroup.accumulatedPoints, 1.20);
    // Internal score on 0-10 scale: (1.20 * 100) / 15 = 8.0
    assert.strictEqual(teoriaGroup.internalScore, 8.0);
    // Display name should have prefix stripped
    assert.strictEqual(teoriaGroup.items[0].displayName, 'Test 1');

    const practicasGroup = groups.find((g) => g.name === 'Prácticas');
    assert.ok(practicasGroup, 'Prácticas group must exist from semantic prefix');
    assert.strictEqual(practicasGroup.totalWeight, 50);
    assert.strictEqual(practicasGroup.gradedWeight, 50);
    // (9.0 * 0.10) + (6.0 * 0.40) = 0.90 + 2.40 = 3.30
    assert.strictEqual(practicasGroup.accumulatedPoints, 3.30);
    // Internal score: (3.30 * 100) / 50 = 6.60
    assert.strictEqual(practicasGroup.internalScore, 6.60);
    assert.strictEqual(practicasGroup.items[0].displayName, 'Memoria 1');
  });

  it('gracefully groups generic items without category or prefix into Evaluación General', () => {
    const genericItems: GradeItem[] = [
      { id: '1', name: 'Primer Parcial', type: 'EXAMEN', weight: 40, grade: 7.0 },
      { id: '2', name: 'Segundo Parcial', type: 'EXAMEN', weight: 60, grade: null }
    ];

    const groups = groupGradeItems(genericItems);
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].name, 'Evaluación General');
    assert.strictEqual(groups[0].totalWeight, 100);
    assert.strictEqual(groups[0].gradedWeight, 40);
    assert.strictEqual(groups[0].accumulatedPoints, 2.80);
    assert.strictEqual(groups[0].internalScore, 7.0);
  });

  it('intelligently nests practical topics (Tema 1, Tema 2, etc.) under Prácticas instead of creating separate top-level sliders', () => {
    const items: GradeItem[] = [
      { id: '1', name: 'Teoría: Test (Temas 1 y 2)', type: 'EXAMEN', weight: 15, grade: null, category: 'Teoría' },
      { id: '2', name: 'Teoría: Examen de problemas', type: 'EXAMEN', weight: 35, grade: null, category: 'Teoría' },
      { id: '3', name: 'Prácticas: Examen Tema 1', type: 'EXAMEN', weight: 12.5, grade: 7.33, category: 'Prácticas', subcategory: 'Tema 1' },
      { id: '4', name: 'Prácticas: Memoria Tema 2', type: 'ENTREGA', weight: 2.5, grade: null, category: 'Prácticas', subcategory: 'Tema 2' },
      { id: '5', name: 'Prácticas: Examen Tema 2', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 2' },
      { id: '6', name: 'Prácticas: Memoria Tema 3', type: 'ENTREGA', weight: 2.5, grade: null, category: 'Prácticas', subcategory: 'Tema 3' },
      { id: '7', name: 'Prácticas: Examen Tema 3', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 3' },
      { id: '8', name: 'Prácticas: Memoria Tema 4', type: 'ENTREGA', weight: 2.5, grade: null, category: 'Prácticas', subcategory: 'Tema 4' },
      { id: '9', name: 'Prácticas: Examen Tema 4', type: 'EXAMEN', weight: 10, grade: null, category: 'Prácticas', subcategory: 'Tema 4' }
    ];

    const cutoffs = { 'Teoría': 4.0, 'Prácticas': 4.0 };
    const groups = groupGradeItems(items, cutoffs);

    // CRITICAL REQUIREMENT: Must NOT create 5 top-level accordions!
    assert.strictEqual(groups.length, 2, 'Must create exactly 2 main blocks: Teoría and Prácticas');

    const teoria = groups.find((g) => g.name === 'Teoría');
    assert.ok(teoria);
    assert.strictEqual(teoria.totalWeight, 50);
    assert.strictEqual(teoria.minGradeRequired, 4.0);

    const practicas = groups.find((g) => g.name === 'Prácticas');
    assert.ok(practicas);
    assert.strictEqual(practicas.totalWeight, 50);
    assert.strictEqual(practicas.minGradeRequired, 4.0);

    // Prácticas must contain 4 subtopics
    assert.strictEqual(practicas.subgroups.length, 4, 'Prácticas must contain 4 topic subgroups');
    assert.strictEqual(practicas.subgroups[0].name, 'Tema 1');
    assert.strictEqual(practicas.subgroups[0].totalWeight, 12.5);
    assert.strictEqual(practicas.subgroups[0].internalScore, 7.33);

    assert.strictEqual(practicas.subgroups[1].name, 'Tema 2');
    assert.strictEqual(practicas.subgroups[1].totalWeight, 12.5);
    assert.strictEqual(practicas.subgroups[1].items.length, 2); // Memoria + Examen

    // Block cutoff mathematical accuracy verification
    assert.strictEqual(practicas.blockScore, 1.83, '7.33 in 25% of practices accounts for only 1.83 / 10 block score');
    assert.strictEqual(practicas.isCutoffMet, false, 'Cutoff of 4.0 must NOT be marked as met when block score is only 1.83');
    assert.strictEqual(practicas.missingBlockPoints, 2.17, 'Must accurately calculate missing points to reach 4.0 cutoff');
    assert.strictEqual(practicas.requiredGradeInPending, 2.89, 'Requires 2.89 in remaining pending practice items to meet 4.0 cutoff');

    // Block cut-off simulation check
    const simFailBlock = calculateSimulatedFinalGrade(items, 3.0, null, cutoffs);
    assert.strictEqual(simFailBlock.isCutoffFailed, true);
    assert.ok(simFailBlock.failedBlockCutoff?.includes('Teoría') || simFailBlock.failedBlockCutoff?.includes('Prácticas'));

    const simPassBlock = calculateSimulatedFinalGrade(items, 6.0, null, cutoffs);
    assert.strictEqual(simPassBlock.isCutoffFailed, false);
  });

  it('atomically extracts separate evaluable items within topics instead of fusing them', () => {
    const service = GeminiGradesService.getInstance();
    const prompt = `Estructura General de la Asignatura
Nota Final: Se compone de un 50% Teoría y un 50% Prácticas.
Condición de aprobado: Es obligatorio obtener una nota mínima de 4.0 sobre 10 en cada bloque (Teoría y Prácticas) de forma independiente para poder hacer media.
2. Bloque de Teoría (Peso: 50% de la nota final)
Condición: Sacar un mínimo de 4.0 en el total de este bloque.
Evaluación:
Test (Temas 1 y 2): Se realiza a mediados de noviembre. Vale el 30% de la nota de teoría (15% de la nota final global).
Examen de problemas: Se realiza el 25/01/2027. Vale el 70% de la nota de teoría (35% de la nota final global).
3. Bloque de Prácticas (Peso: 50% de la nota final)
Condición: Sacar un mínimo de 4.0 en el total de este bloque.
Evaluación: Se divide en 4 temas, donde cada tema tiene el mismo peso (25% de las prácticas, es decir, 12.5% de la nota final global).
Tema 1: 100% examen. Nota ya obtenida: 7.33
Tema 2: 20% Memoria técnica + 80% Examen.
Tema 3: 20% Memoria técnica + 80% Examen.
Tema 4: 20% Memoria técnica + 80% Examen.`;

    const extraction = service.extractSyllabusOfflineFallback('Arquitectura de Computadores', prompt);
    // 2 theory items + 1 (tema 1) + 2 (tema 2) + 2 (tema 3) + 2 (tema 4) = 9 atomic evaluable items
    assert.strictEqual(extraction.items.length, 9);
    assert.deepStrictEqual(extraction.blockCutoffs, { 'Teoría': 4.0, 'Prácticas': 4.0 });

    const tema1 = extraction.items.find((it) => it.subcategory === 'Tema 1');
    assert.ok(tema1);
    assert.strictEqual(tema1.grade, 7.33);
    assert.strictEqual(tema1.weight, 12.5);

    const tema2Items = extraction.items.filter((it) => it.subcategory === 'Tema 2');
    assert.strictEqual(tema2Items.length, 2, 'Tema 2 must have exactly 2 separate items');
    const memoria2 = tema2Items.find((it) => it.type === 'ENTREGA');
    const examen2 = tema2Items.find((it) => it.type === 'EXAMEN');
    assert.ok(memoria2, 'Memoria must be present as separate ENTREGA item');
    assert.ok(examen2, 'Examen must be present as separate EXAMEN item');
    assert.strictEqual(memoria2.weight, 2.5, 'Memoria must weigh 2.5% (20% of 12.5%)');
    assert.strictEqual(examen2.weight, 10, 'Examen must weigh 10% (80% of 12.5%)');
    assert.ok(memoria2.grade === null || memoria2.grade === undefined, 'Must be unassigned/pending');
    assert.ok(examen2.grade === null || examen2.grade === undefined, 'Must be unassigned/pending');
  });

  it('offline fallback sums to 100% without inventing 30% practices or hardcoded dates on two-component syllabi', () => {
    const service = GeminiGradesService.getInstance();
    const res = service.extractSyllabusOfflineFallback('Álgebra', 'Examen final 70% y parciales 30%');
    const sum = res.items.reduce((s, it) => s + it.weight, 0);
    assert.strictEqual(sum, 100);
    assert.ok(!res.items.some((it) => it.dateHint === '25/01/2027'));

    const res2 = service.extractSyllabusOfflineFallback('Sistemas', '50% teoría y 50% prácticas');
    assert.strictEqual(res2.items.reduce((s, it) => s + it.weight, 0), 100);
    assert.ok(!res2.items.some((it) => it.dateHint === '25/01/2027'));
  });
});


