import {
  CutoffDiagnostic,
  CutoffStatus,
  GradeItem,
  GradeItemType,
  ScenarioSimulationResult,
  SimulatedGradesMap,
  SubjectGradesConfig,
  TargetGradeCalculation,
  TermSubjectSummary,
  TermSummary
} from './gradesTypes';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hasValidGrade(val: unknown): val is number {
  return typeof val === 'number' && !isNaN(val) && isFinite(val);
}

/**
 * Calculates current accumulated points, graded average, and weights from graded items.
 */
export function calculateAccumulatedScore(items: GradeItem[]): {
  accumulatedPoints: number;
  gradedWeight: number;
  totalWeight: number;
  currentAverage: number | null;
  maxPossibleGrade: number;
} {
  let rawPoints = 0;
  let gradedWeight = 0;
  let totalWeight = 0;

  for (const item of items) {
    totalWeight += item.weight;
    if (hasValidGrade(item.grade)) {
      rawPoints += (item.grade * item.weight) / 100;
      gradedWeight += item.weight;
    }
  }

  const remainingWeight = Math.max(0, totalWeight - gradedWeight);
  const currentAverage = gradedWeight > 0 ? round2((rawPoints * 100) / gradedWeight) : null;
  const maxPossibleGrade = Math.min(10, round2(rawPoints + (remainingWeight * 10) / 100));

  return {
    accumulatedPoints: round2(rawPoints),
    gradedWeight: round1(gradedWeight),
    totalWeight: round1(totalWeight),
    currentAverage,
    maxPossibleGrade
  };
}

/**
 * Evaluates all cutoff rules across 3 levels:
 * 1. Item-level cutoffs (`item.minGradeRequired`)
 * 2. Block-level cutoffs (`blockCutoffs[group.name]`)
 * 3. Global final-exam cutoff (`minFinalGradeRequired`)
 */
export function evaluateCutoffs(
  items: GradeItem[],
  minFinalGradeRequired?: number | null,
  blockCutoffs?: Record<string, number>,
  simulatedGrades?: SimulatedGradesMap,
  fallbackSimulatedScore?: number | null
): CutoffDiagnostic[] {
  const diagnostics: CutoffDiagnostic[] = [];
  const getProjected = (item: GradeItem): number | null => {
    if (hasValidGrade(item.grade)) return item.grade;
    if (simulatedGrades && hasValidGrade(simulatedGrades[item.id])) return simulatedGrades[item.id];
    if (hasValidGrade(fallbackSimulatedScore)) return fallbackSimulatedScore;
    return null;
  };

  // 1. Item-level cutoffs
  const itemIdsWithExplicitCutoff = new Set<string>();
  for (const item of items) {
    if (hasValidGrade(item.minGradeRequired) && item.minGradeRequired > 0) {
      itemIdsWithExplicitCutoff.add(item.id);
      const req = item.minGradeRequired;
      const realGrade = hasValidGrade(item.grade) ? item.grade : null;
      const projected = getProjected(item);

      let status: CutoffStatus = 'PENDING';
      if (realGrade !== null) {
        status = realGrade >= req ? 'MET' : 'FAILED';
      } else if (projected !== null && projected < req) {
        status = 'AT_RISK';
      }

      diagnostics.push({
        scope: 'ITEM',
        label: item.name,
        required: req,
        currentScore: realGrade,
        projectedScore: projected,
        status,
        requiredInPending: realGrade !== null ? (realGrade >= req ? 0 : null) : req,
        itemId: item.id,
        blockName: item.category
      });
    }
  }

  // 2. Block-level cutoffs
  if (blockCutoffs && Object.keys(blockCutoffs).length > 0) {
    const groups = groupGradeItems(items, blockCutoffs);
    for (const group of groups) {
      const req = blockCutoffs[group.name];
      if (!hasValidGrade(req) || req <= 0 || group.totalWeight <= 0) continue;

      let projectedPoints = 0;
      let projectedWeight = 0;
      let allHaveProjected = true;

      for (const wrap of group.items) {
        const g = getProjected(wrap.item);
        if (g !== null) {
          projectedPoints += (g * wrap.item.weight) / 100;
          projectedWeight += wrap.item.weight;
        } else {
          allHaveProjected = false;
        }
      }

      const projectedScore =
        projectedWeight > 0
          ? round2((projectedPoints * 100) / (allHaveProjected ? group.totalWeight : projectedWeight))
          : null;

      let status: CutoffStatus = 'PENDING';
      if (group.isCutoffMet) {
        status = 'MET';
      } else if (group.isCutoffImpossible) {
        status = group.gradedWeight >= group.totalWeight ? 'FAILED' : 'IMPOSSIBLE';
      } else if (projectedScore !== null && allHaveProjected && projectedScore < req) {
        status = 'AT_RISK';
      }

      diagnostics.push({
        scope: 'BLOCK',
        label: `Bloque ${group.name}`,
        required: req,
        currentScore: group.internalScore,
        projectedScore,
        status,
        requiredInPending: group.requiredGradeInPending ?? null,
        blockName: group.name
      });
    }
  }

  // 3. Global final exam cutoff (legacy & convenience rule)
  if (hasValidGrade(minFinalGradeRequired) && minFinalGradeRequired > 0 && items.length > 0) {
    const finalExamItems = items.filter((it) => /final|global|problemas/i.test(it.name));
    const examItems = finalExamItems.length > 0 ? finalExamItems : items.filter((it) => it.type === 'EXAMEN');
    const cutoffTargets = (examItems.length > 0 ? examItems : items).filter(
      (it) => !itemIdsWithExplicitCutoff.has(it.id)
    );

    if (cutoffTargets.length > 0) {
      let anyRealFailed = false;
      let allRealPassed = true;
      let anyPending = false;
      let minProjected: number | null = null;
      let minReal: number | null = null;

      for (const target of cutoffTargets) {
        const real = hasValidGrade(target.grade) ? target.grade : null;
        const proj = getProjected(target);

        if (real !== null) {
          minReal = minReal === null ? real : Math.min(minReal, real);
          if (real < minFinalGradeRequired) {
            anyRealFailed = true;
            allRealPassed = false;
          }
        } else {
          allRealPassed = false;
          anyPending = true;
        }

        if (proj !== null) {
          minProjected = minProjected === null ? proj : Math.min(minProjected, proj);
        }
      }

      let status: CutoffStatus = 'PENDING';
      if (anyRealFailed) {
        status = 'FAILED';
      } else if (allRealPassed && !anyPending) {
        status = 'MET';
      } else if (minProjected !== null && minProjected < minFinalGradeRequired) {
        status = 'AT_RISK';
      }

      const targetLabel =
        cutoffTargets.length === 1
          ? `Corte en ${cutoffTargets[0].name}`
          : 'Corte examen final';

      diagnostics.push({
        scope: 'GLOBAL',
        label: targetLabel,
        required: minFinalGradeRequired,
        currentScore: minReal,
        projectedScore: minProjected,
        status,
        requiredInPending: anyRealFailed ? null : anyPending ? minFinalGradeRequired : 0
      });
    }
  }

  return diagnostics;
}

/**
 * Calculates the required grade in remaining pending items to reach a target grade,
 * accounting for global final cutoffs, independent block cutoffs, and item-level cutoffs.
 */
export function calculateTargetRequiredGrade(
  items: GradeItem[],
  targetGrade: number,
  minFinalGradeRequired?: number | null,
  blockCutoffs?: Record<string, number>
): TargetGradeCalculation {
  const { accumulatedPoints, gradedWeight, maxPossibleGrade } = calculateAccumulatedScore(items);
  const pendingItems = items.filter((it) => !hasValidGrade(it.grade));
  const pendingWeightSum = round1(pendingItems.reduce((s, it) => s + it.weight, 0));
  const remainingWeight = pendingItems.length > 0 ? pendingWeightSum : 0;

  const cutoffDiagnostics = evaluateCutoffs(items, minFinalGradeRequired, blockCutoffs);
  const hasFailedCutoff = cutoffDiagnostics.some((d) => d.status === 'FAILED' || d.status === 'IMPOSSIBLE');
  const failedDiag = cutoffDiagnostics.find((d) => d.status === 'FAILED' || d.status === 'IMPOSSIBLE');

  if (remainingWeight === 0) {
    return {
      targetGrade,
      accumulatedPoints,
      gradedWeightTotal: gradedWeight,
      remainingWeightTotal: 0,
      requiredFinalGrade: accumulatedPoints,
      isPossible: !hasFailedCutoff && accumulatedPoints >= targetGrade,
      isCutoffTriggered: hasFailedCutoff,
      minCutoff: hasFailedCutoff && failedDiag ? failedDiag.required : (minFinalGradeRequired ?? null),
      rawRequiredForAverage: accumulatedPoints,
      maxPossibleGrade,
      bottleneckReason: hasFailedCutoff && failedDiag ? `Corte no superado: ${failedDiag.label}` : null,
      cutoffDiagnostics
    };
  }

  const rawRequired = ((targetGrade - accumulatedPoints) * 100) / remainingWeight;
  const roundedRequired = round2(rawRequired);

  let finalRequired = Math.max(0, roundedRequired);
  let isCutoffTriggered = false;
  let effectiveCutoff: number | null = hasValidGrade(minFinalGradeRequired) ? minFinalGradeRequired : null;
  let bottleneckReason: string | null = null;
  let blockAlreadyFailed = hasFailedCutoff;

  if (effectiveCutoff !== null && finalRequired < effectiveCutoff) {
    finalRequired = effectiveCutoff;
    isCutoffTriggered = true;
    bottleneckReason = `Corte examen final (mín. ${effectiveCutoff.toFixed(1)})`;
  }

  // Check item-level cutoffs on pending items
  for (const item of pendingItems) {
    if (hasValidGrade(item.minGradeRequired) && item.minGradeRequired > finalRequired) {
      finalRequired = item.minGradeRequired;
      isCutoffTriggered = true;
      if (effectiveCutoff === null || item.minGradeRequired > effectiveCutoff) {
        effectiveCutoff = item.minGradeRequired;
      }
      bottleneckReason = `Corte en ${item.name} (mín. ${item.minGradeRequired.toFixed(1)})`;
    }
  }

  // Check block-level cutoffs
  if (blockCutoffs && Object.keys(blockCutoffs).length > 0) {
    const groups = groupGradeItems(items, blockCutoffs);
    for (const group of groups) {
      if (group.isCutoffImpossible) {
        blockAlreadyFailed = true;
        bottleneckReason = `Corte inalcanzable en ${group.name} (mín. ${group.minGradeRequired?.toFixed(1)})`;
      }
      if (
        hasValidGrade(group.requiredGradeInPending) &&
        group.requiredGradeInPending > finalRequired
      ) {
        finalRequired = group.requiredGradeInPending;
        isCutoffTriggered = true;
        if (effectiveCutoff === null || (group.minGradeRequired && group.minGradeRequired > effectiveCutoff)) {
          effectiveCutoff = group.minGradeRequired ?? effectiveCutoff;
        }
        bottleneckReason = `Corte en ${group.name} (mín. ${group.minGradeRequired?.toFixed(1)})`;
      }
    }
  }

  if (hasFailedCutoff && failedDiag) {
    bottleneckReason = `Corte no superado en ${failedDiag.label} (mín. ${failedDiag.required.toFixed(1)})`;
  }

  const isPossible = !blockAlreadyFailed && finalRequired <= 10.0;
  if (!isPossible && !bottleneckReason) {
    bottleneckReason = `Máximo alcanzable: ${maxPossibleGrade.toFixed(2)}`;
  }

  return {
    targetGrade,
    accumulatedPoints,
    gradedWeightTotal: gradedWeight,
    remainingWeightTotal: remainingWeight,
    requiredFinalGrade: round2(finalRequired),
    isPossible,
    isCutoffTriggered,
    minCutoff: effectiveCutoff,
    rawRequiredForAverage: Math.max(0, roundedRequired),
    maxPossibleGrade,
    bottleneckReason,
    cutoffDiagnostics
  };
}

/**
 * Simulates a full scenario supporting per-item hypothetical grades (`simulatedGrades`)
 * and an optional fallback slider score for any remaining unsimulated pending items.
 */
export function calculateScenarioSimulation(
  items: GradeItem[],
  simulatedGrades: SimulatedGradesMap = {},
  fallbackSimulatedScore: number | null = 5.0,
  minFinalGradeRequired?: number | null,
  blockCutoffs?: Record<string, number>
): ScenarioSimulationResult {
  const cutoff = hasValidGrade(minFinalGradeRequired) ? minFinalGradeRequired : null;

  let totalPoints = 0;
  let simulatedItemCount = 0;
  let pendingUnfilledCount = 0;

  for (const item of items) {
    if (hasValidGrade(item.grade)) {
      totalPoints += (item.grade * item.weight) / 100;
    } else if (hasValidGrade(simulatedGrades[item.id])) {
      totalPoints += (simulatedGrades[item.id] * item.weight) / 100;
      simulatedItemCount++;
    } else if (hasValidGrade(fallbackSimulatedScore)) {
      totalPoints += (fallbackSimulatedScore * item.weight) / 100;
      pendingUnfilledCount++;
    } else {
      pendingUnfilledCount++;
    }
  }

  const cutoffDiagnostics = evaluateCutoffs(
    items,
    minFinalGradeRequired,
    blockCutoffs,
    simulatedGrades,
    fallbackSimulatedScore
  );

  const failedCutoffs = cutoffDiagnostics.filter(
    (d) => d.status === 'FAILED' || d.status === 'IMPOSSIBLE' || d.status === 'AT_RISK'
  );

  const isCutoffFailed = failedCutoffs.length > 0;
  const firstBlockFailure = failedCutoffs.find((d) => d.scope === 'BLOCK');
  const firstItemFailure = failedCutoffs.find((d) => d.scope === 'ITEM');

  let failedBlockCutoff: string | undefined = undefined;
  if (firstBlockFailure) {
    const scoreStr = firstBlockFailure.projectedScore !== null ? firstBlockFailure.projectedScore.toFixed(2) : '—';
    failedBlockCutoff = `${firstBlockFailure.blockName || firstBlockFailure.label} (${scoreStr} < ${firstBlockFailure.required.toFixed(1)})`;
  } else if (firstItemFailure) {
    const scoreStr = firstItemFailure.projectedScore !== null ? firstItemFailure.projectedScore.toFixed(2) : '—';
    failedBlockCutoff = `${firstItemFailure.label} (${scoreStr} < ${firstItemFailure.required.toFixed(1)})`;
  }

  return {
    finalGrade: Math.min(10, Math.max(0, round2(totalPoints))),
    isCutoffFailed,
    minCutoff: cutoff,
    failedBlockCutoff,
    failedCutoffs,
    cutoffDiagnostics,
    simulatedItemCount,
    pendingUnfilledCount
  };
}

/**
 * Backwards-compatible wrapper for simulating final course grade with a uniform score on pending items.
 */
export function calculateSimulatedFinalGrade(
  items: GradeItem[],
  simulatedScore: number,
  minFinalGradeRequired?: number | null,
  blockCutoffs?: Record<string, number>
): {
  finalGrade: number;
  isCutoffFailed: boolean;
  minCutoff: number | null;
  failedBlockCutoff?: string;
} {
  const res = calculateScenarioSimulation(items, {}, simulatedScore, minFinalGradeRequired, blockCutoffs);
  return {
    finalGrade: res.finalGrade,
    isCutoffFailed: res.isCutoffFailed,
    minCutoff: res.minCutoff,
    failedBlockCutoff: res.failedBlockCutoff
  };
}

export interface GradeGroupItem {
  item: GradeItem;
  originalIndex: number;
  displayName: string;
  subcategory?: string;
}

export interface GradeSubgroup {
  id: string;
  name: string; // e.g. "Tema 1", "Tema 2", or empty string "" if ungrouped
  totalWeight: number;
  gradedWeight: number;
  accumulatedPoints: number;
  internalScore: number | null;
  items: GradeGroupItem[];
}

export interface GradeGroup {
  id: string;
  name: string; // Macro Block (e.g. "Teoría", "Prácticas", "Evaluación Continua")
  totalWeight: number;
  gradedWeight: number;
  accumulatedPoints: number;
  blockScore: number;               // Assured score on 0-10 scale within this block (assumes 0 in pending)
  internalScore: number | null;     // Current average of graded items so far on 0-10 scale
  maxPossibleBlockScore: number;    // Max achievable 0-10 score in this block
  minGradeRequired?: number;
  isCutoffMet?: boolean;
  missingBlockPoints?: number;
  requiredGradeInPending?: number | null;
  isCutoffImpossible?: boolean;
  subgroups: GradeSubgroup[];
  items: GradeGroupItem[];
}

/**
 * Decomposes any composite or fused evaluation items (e.g. "Tema 2 (Memoria + Examen)" or "20% Memoria + 80% Examen")
 * into atomic, separate evaluation items, preserving their subcategories and calculating proportional weights.
 */
export function decomposeCompositeItems(items: GradeItem[]): GradeItem[] {
  const result: GradeItem[] = [];

  for (const item of items) {
    const parenMatch = item.name.match(/^(.*?)(?:\s*\(|\s*\[)([^)]+?)\s*\+\s*([^)]+?)(?:\)|\].*?)$/i);
    const colonPlusMatch = !parenMatch && item.name.match(/^(.*?)\s*:\s*(.+?)\s*\+\s*(.+?)$/i);
    const directPlusMatch = !parenMatch && !colonPlusMatch && item.name.match(/^(.+?)\s+\+\s+(.+?)$/i);

    const match = parenMatch || colonPlusMatch || directPlusMatch;

    if (match) {
      const prefix = (parenMatch ? parenMatch[1] : (colonPlusMatch ? colonPlusMatch[1] : '')).trim();
      const part1Raw = (parenMatch ? parenMatch[2] : (colonPlusMatch ? colonPlusMatch[2] : match[1])).trim();
      const part2Raw = (parenMatch ? parenMatch[3] : (colonPlusMatch ? colonPlusMatch[3] : match[2])).trim();

      if (part1Raw.length > 0 && part2Raw.length > 0) {
        const pct1Match = part1Raw.match(/(\d+(?:\.\d+)?)\s*%/);
        const pct2Match = part2Raw.match(/(\d+(?:\.\d+)?)\s*%/);

        let ratio1 = 0.5;
        let ratio2 = 0.5;

        if (pct1Match && pct2Match) {
          const p1 = parseFloat(pct1Match[1]);
          const p2 = parseFloat(pct2Match[1]);
          const sum = p1 + p2;
          if (sum > 0) {
            ratio1 = p1 / sum;
            ratio2 = p2 / sum;
          }
        } else if (pct1Match) {
          const p1 = parseFloat(pct1Match[1]);
          ratio1 = Math.min(0.9, Math.max(0.1, p1 / 100));
          ratio2 = 1 - ratio1;
        } else if (pct2Match) {
          const p2 = parseFloat(pct2Match[1]);
          ratio2 = Math.min(0.9, Math.max(0.1, p2 / 100));
          ratio1 = 1 - ratio2;
        }

        const cleanPart1 = part1Raw.replace(/^\d+(?:\.\d+)?\s*%\s*(?:de\s+)?/i, '').trim();
        const cleanPart2 = part2Raw.replace(/^\d+(?:\.\d+)?\s*%\s*(?:de\s+)?/i, '').trim();

        let sub = item.subcategory;
        if (!sub) {
          const subMatch = (prefix || item.name).match(/(Tema\s*\d+|Módulo\s*\d+|Unit\s*\d+|T\d+|Práctica\s*\d+|Lab\s*\d+)/i);
          if (subMatch) {
            sub = subMatch[1];
          }
        }

        const weight1 = round2(item.weight * ratio1);
        const weight2 = round2(item.weight - weight1);

        const isExam1 = /exam|control|test|parcial/i.test(cleanPart1);
        const isExam2 = /exam|control|test|parcial/i.test(cleanPart2);
        const type1: GradeItemType = isExam1 ? 'EXAMEN' : (/entrega|memoria|pr[aá]ctica|informe|trabajo/i.test(cleanPart1) ? 'ENTREGA' : 'OTRO');
        const type2: GradeItemType = isExam2 ? 'EXAMEN' : (/entrega|memoria|pr[aá]ctica|informe|trabajo/i.test(cleanPart2) ? 'ENTREGA' : 'OTRO');

        result.push({
          id: `${item.id}_part1`,
          name: cleanPart1,
          type: type1,
          weight: weight1,
          grade: item.grade,
          category: item.category,
          subcategory: sub
        });

        result.push({
          id: `${item.id}_part2`,
          name: cleanPart2,
          type: type2,
          weight: weight2,
          grade: item.grade,
          category: item.category,
          subcategory: sub
        });
        continue;
      }
    }

    result.push(item);
  }

  return result;
}

/**
 * Intelligently groups grade items into a hierarchical two-level structure:
 * Level 1: Macro Blocks (e.g. "Teoría", "Prácticas", "Evaluación Continua")
 * Level 2: Sub-groups / Topics / Themes within the block (e.g. "Tema 1", "Tema 2")
 * Preserves exact originalIndex into the source `items` array.
 */
export function groupGradeItems(
  items: GradeItem[],
  blockCutoffs?: Record<string, number>
): GradeGroup[] {
  const atomicEntries: Array<{ item: GradeItem; originalIndex: number }> = [];
  items.forEach((it, idx) => {
    const hasExplicitComposite =
      /\([^)]+\+[^)]+\)|\[[^\]]+\+[^\]]+\]|\d+(?:\.\d+)?\s*%.*\+.*\d+(?:\.\d+)?\s*%/i.test(it.name);
    if (hasExplicitComposite) {
      decomposeCompositeItems([it]).forEach((part) => atomicEntries.push({ item: part, originalIndex: idx }));
    } else {
      atomicEntries.push({ item: it, originalIndex: idx });
    }
  });

  const isSubtopicPattern = /^(tema\s*\d+|m[oó]dulo\s*\d+|unit\s*\d+|t\d+|pr[aá]ctica\s*\d+|lab\s*\d+)/i;

  const normalizedItems = atomicEntries.map(({ item, originalIndex }) => {
    let macro = item.category?.trim() || '';
    let sub = item.subcategory?.trim() || '';
    let displayName = item.name.trim();

    // If category was erroneously set as a subtopic (e.g. "Tema 1", "Tema 2")
    if (macro && isSubtopicPattern.test(macro)) {
      if (!sub) sub = macro;
      macro = '';
    }

    // Only parse prefixes from name if category is not already explicitly set
    if (!macro) {
      const doubleMatch = displayName.match(
        /^\[?([A-Za-z0-9ÁÉÍÓÚáéíóúñÑüÜ\s]{2,20})\]?[:\-\/|•\]]\s*(Tema\s*\d+|Módulo\s*\d+|Unit\s*\d+|T\d+|Práctica\s*\d+|Lab\s*\d+)[:\-\/|•\]\s]*(.+)$/i
      );

      if (doubleMatch) {
        macro = doubleMatch[1].trim();
        if (!sub) sub = doubleMatch[2].trim();
        displayName = doubleMatch[3].trim();
      } else {
        const singleMatch = displayName.match(/^\[?([A-Za-z0-9ÁÉÍÓÚáéíóúñÑüÜ\s]{2,25})\]?[:\-\/|•\]]\s*(.+)$/);
        if (singleMatch) {
          const prefix = singleMatch[1].trim();
          const rest = singleMatch[2].trim();

          if (isSubtopicPattern.test(prefix)) {
            if (!sub) sub = prefix;
            displayName = rest;
          } else {
            macro = prefix;
            displayName = rest;
          }
        }
      }
    }

    // Strip redundant macro prefix from displayName
    if (macro && displayName.toLowerCase().startsWith(macro.toLowerCase())) {
      const remainder = displayName.substring(macro.length).replace(/^[:\-\/|•\]\s]+/, '');
      if (remainder.length > 0) displayName = remainder;
    }

    // Strip redundant subtopic prefix from displayName if inside a subtopic
    if (sub && displayName.toLowerCase().startsWith(sub.toLowerCase())) {
      const remainder = displayName.substring(sub.length).replace(/^[:\-\/|•\]\s]+/, '');
      if (remainder.length > 0) displayName = remainder;
    }

    displayName = displayName.replace(/^[:\-\/|•\]\s]+/, '').replace(/[:\-\/|•\]\s]+$/, '').trim();
    if (
      displayName.startsWith('(') &&
      displayName.endsWith(')') &&
      !displayName.slice(1, -1).includes('(') &&
      !displayName.slice(1, -1).includes(')')
    ) {
      displayName = displayName.substring(1, displayName.length - 1).trim();
    }

    return {
      item,
      originalIndex,
      displayName: displayName || item.name.trim(),
      macro,
      sub
    };
  });

  // Infer macro for items that have a subcategory (like "Tema 1") but no parent macro
  const knownMacros = Array.from(new Set(normalizedItems.map((n) => n.macro).filter(Boolean)));
  const hasTeoria = knownMacros.some((m) => /teor/i.test(m));
  const hasPracticas = knownMacros.some((m) => /pr[aá]ct|lab/i.test(m));

  normalizedItems.forEach((n) => {
    if (!n.macro) {
      if (hasPracticas && n.sub) {
        n.macro = knownMacros.find((m) => /pr[aá]ct|lab/i.test(m)) || 'Prácticas';
      } else if (hasTeoria && n.sub) {
        n.macro = 'Prácticas';
      } else if (/pr[aá]ct|lab|memoria|entrega/i.test(n.item.name) && knownMacros.length > 0) {
        n.macro = knownMacros.find((m) => /pr[aá]ct|lab/i.test(m)) || 'Prácticas';
      } else if (/teor|test|examen\s*de\s*problemas/i.test(n.item.name) && knownMacros.length > 0) {
        n.macro = knownMacros.find((m) => /teor/i.test(m)) || 'Teoría';
      } else if (knownMacros.length === 1) {
        n.macro = knownMacros[0];
      } else {
        n.macro = n.sub ? 'Prácticas' : 'Evaluación General';
      }
    }
  });

  const groupsMap = new Map<
    string,
    {
      macro: string;
      subgroupsMap: Map<string, GradeGroupItem[]>;
      allItems: GradeGroupItem[];
    }
  >();

  normalizedItems.forEach((n) => {
    const macroName = n.macro;
    const subName = n.sub || '';

    if (!groupsMap.has(macroName)) {
      groupsMap.set(macroName, {
        macro: macroName,
        subgroupsMap: new Map(),
        allItems: []
      });
    }

    const groupData = groupsMap.get(macroName)!;
    const groupItem: GradeGroupItem = {
      item: n.item,
      originalIndex: n.originalIndex,
      displayName: n.displayName,
      subcategory: n.sub || undefined
    };

    groupData.allItems.push(groupItem);

    if (!groupData.subgroupsMap.has(subName)) {
      groupData.subgroupsMap.set(subName, []);
    }
    groupData.subgroupsMap.get(subName)!.push(groupItem);
  });

  const result: GradeGroup[] = [];

  for (const [groupName, groupData] of groupsMap.entries()) {
    const totalWeight = round2(groupData.allItems.reduce((s, g) => s + g.item.weight, 0));
    const graded = groupData.allItems.filter((g) => hasValidGrade(g.item.grade));
    const gradedWeight = round2(graded.reduce((s, g) => s + g.item.weight, 0));
    const rawPoints = graded.reduce((s, g) => s + (g.item.grade! * g.item.weight) / 100, 0);
    const accumulatedPoints = round2(rawPoints);

    const blockScore = totalWeight > 0 ? round2((rawPoints * 100) / totalWeight) : 0;
    const internalScore = gradedWeight > 0 ? round2((rawPoints * 100) / gradedWeight) : null;
    const pendingWeight = Math.max(0, totalWeight - gradedWeight);
    const maxPendingBlockScore = totalWeight > 0 ? (pendingWeight / totalWeight) * 10 : 0;
    const maxPossibleBlockScore = Math.min(10, round2(blockScore + maxPendingBlockScore));

    const cutoff = blockCutoffs ? blockCutoffs[groupName] : undefined;
    let isCutoffMet: boolean | undefined = undefined;
    let missingBlockPoints: number | undefined = undefined;
    let requiredGradeInPending: number | null | undefined = undefined;
    let isCutoffImpossible: boolean | undefined = undefined;

    if (hasValidGrade(cutoff)) {
      isCutoffMet = blockScore >= cutoff;
      missingBlockPoints = isCutoffMet ? 0 : round2(Math.max(0, cutoff - blockScore));

      if (isCutoffMet) {
        requiredGradeInPending = 0;
        isCutoffImpossible = false;
      } else if (pendingWeight === 0) {
        requiredGradeInPending = null;
        isCutoffImpossible = true;
      } else if (blockScore + maxPendingBlockScore < cutoff) {
        requiredGradeInPending = maxPendingBlockScore > 0 ? round2((missingBlockPoints / maxPendingBlockScore) * 10) : null;
        isCutoffImpossible = true;
      } else {
        requiredGradeInPending = maxPendingBlockScore > 0 ? round2((missingBlockPoints / maxPendingBlockScore) * 10) : null;
        isCutoffImpossible = false;
      }
    }

    const subgroups: GradeSubgroup[] = [];
    for (const [subName, subItems] of groupData.subgroupsMap.entries()) {
      const subTotalWeight = round2(subItems.reduce((s, g) => s + g.item.weight, 0));
      const subGraded = subItems.filter((g) => hasValidGrade(g.item.grade));
      const subGradedWeight = round2(subGraded.reduce((s, g) => s + g.item.weight, 0));
      const subRawPoints = subGraded.reduce((s, g) => s + (g.item.grade! * g.item.weight) / 100, 0);
      const subAccPoints = round2(subRawPoints);
      const subInternalScore = subGradedWeight > 0 ? round2((subRawPoints * 100) / subGradedWeight) : null;

      subgroups.push({
        id: `${groupName}_${subName || 'gen'}`.toLowerCase().replace(/[^a-z0-9]/g, '_'),
        name: subName,
        totalWeight: subTotalWeight,
        gradedWeight: subGradedWeight,
        accumulatedPoints: subAccPoints,
        internalScore: subInternalScore,
        items: subItems
      });
    }

    result.push({
      id: groupName.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      name: groupName,
      totalWeight,
      gradedWeight,
      accumulatedPoints,
      blockScore,
      internalScore,
      maxPossibleBlockScore,
      minGradeRequired: cutoff,
      isCutoffMet,
      missingBlockPoints,
      requiredGradeInPending,
      isCutoffImpossible,
      subgroups,
      items: groupData.allItems
    });
  }

  return result;
}

/**
 * Normalizes weights of a list of items proportionally so they sum to exactly 100.0%.
 */
export function normalizeWeightsTo100(items: GradeItem[]): GradeItem[] {
  if (items.length === 0) return items;
  const total = items.reduce((s, it) => s + (Number(it.weight) || 0), 0);
  if (total <= 0) {
    const equal = round2(100 / items.length);
    let running = 0;
    return items.map((it, i) => {
      const w = i === items.length - 1 ? round2(100 - running) : equal;
      running += w;
      return { ...it, weight: w };
    });
  }

  let running = 0;
  return items.map((it, i) => {
    const w = i === items.length - 1 ? round2(100 - running) : round2((it.weight / total) * 100);
    running += w;
    return { ...it, weight: Math.max(0, w) };
  });
}

/**
 * Smartly merges a newly extracted syllabus with an existing subject configuration,
 * preserving user-entered grades and Google Calendar links for matching items.
 */
export function mergeSyllabusPreservingData(
  newItems: GradeItem[],
  existingConfig: SubjectGradesConfig | null
): GradeItem[] {
  if (!existingConfig || !Array.isArray(existingConfig.items) || existingConfig.items.length === 0) {
    return newItems;
  }

  const normalize = (s?: string) =>
    (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();

  const usedExistingIds = new Set<string>();

  return newItems.map((incoming) => {
    const inName = normalize(incoming.name);
    const inCat = normalize(incoming.category);
    const inSub = normalize(incoming.subcategory);

    // 1. Exact name + category + subcategory match
    let match = existingConfig.items.find(
      (ex) =>
        !usedExistingIds.has(ex.id) &&
        normalize(ex.name) === inName &&
        normalize(ex.category) === inCat &&
        normalize(ex.subcategory) === inSub
    );

    // 2. Fallback: same normalized name or containment match within same subcategory/category
    if (!match) {
      match = existingConfig.items.find(
        (ex) =>
          !usedExistingIds.has(ex.id) &&
          (normalize(ex.name) === inName ||
            (inSub && normalize(ex.subcategory) === inSub && ex.type === incoming.type))
      );
    }

    if (!match) return incoming;
    usedExistingIds.add(match.id);

    return {
      ...incoming,
      id: match.id,
      grade: hasValidGrade(incoming.grade) ? incoming.grade : match.grade,
      linkedCalendarEventId: incoming.linkedCalendarEventId || match.linkedCalendarEventId,
      linkedEventTitle: incoming.linkedEventTitle || match.linkedEventTitle,
      dateHint: incoming.dateHint || match.dateHint
    };
  });
}

/**
 * Computes an ECTS-weighted summary across all subjects in the active academic term.
 */
export function calculateTermSummary(
  entries: Array<{ subjectName: string; color: string; config: SubjectGradesConfig | null }>
): TermSummary {
  const subjects: TermSubjectSummary[] = [];
  let configuredSubjects = 0;
  let totalCredits = 0;
  let evaluatedCredits = 0;
  let weightedCurrentSum = 0;
  let weightedAssuredSum = 0;
  let passedAssuredCount = 0;
  let atRiskCount = 0;

  for (const entry of entries) {
    const cfg = entry.config;
    const credits = cfg?.credits || 6;
    totalCredits += credits;

    if (!cfg || cfg.items.length === 0) {
      subjects.push({
        subjectName: entry.subjectName,
        color: entry.color,
        credits,
        isConfigured: false,
        accumulatedPoints: 0,
        currentAverage: null,
        gradedWeight: 0,
        totalWeight: 0,
        maxPossibleGrade: 10,
        hasCutoffRisk: false,
        hasCutoffFailed: false,
        isPassedAssured: false,
        itemCount: 0
      });
      continue;
    }

    configuredSubjects++;
    const acc = calculateAccumulatedScore(cfg.items);
    const diags = evaluateCutoffs(cfg.items, cfg.minFinalGradeRequired, cfg.blockCutoffs);
    const hasCutoffFailed = diags.some((d) => d.status === 'FAILED' || d.status === 'IMPOSSIBLE');
    const hasCutoffRisk = !hasCutoffFailed && diags.some((d) => d.status === 'AT_RISK');
    const isPassedAssured = acc.accumulatedPoints >= 5.0 && !hasCutoffFailed && diags.every((d) => d.status === 'MET');

    if (isPassedAssured) passedAssuredCount++;
    if (hasCutoffFailed || hasCutoffRisk || acc.maxPossibleGrade < 5.0) atRiskCount++;

    if (acc.currentAverage !== null) {
      weightedCurrentSum += acc.currentAverage * credits;
      evaluatedCredits += credits;
    }
    weightedAssuredSum += acc.accumulatedPoints * credits;

    subjects.push({
      subjectName: entry.subjectName,
      color: entry.color,
      credits,
      isConfigured: true,
      accumulatedPoints: acc.accumulatedPoints,
      currentAverage: acc.currentAverage,
      gradedWeight: acc.gradedWeight,
      totalWeight: acc.totalWeight,
      maxPossibleGrade: acc.maxPossibleGrade,
      hasCutoffRisk,
      hasCutoffFailed,
      isPassedAssured,
      itemCount: cfg.items.length
    });
  }

  return {
    totalSubjects: entries.length,
    configuredSubjects,
    totalCredits,
    evaluatedCredits,
    weightedAverageCurrent: evaluatedCredits > 0 ? round2(weightedCurrentSum / evaluatedCredits) : null,
    weightedAssuredPoints: totalCredits > 0 ? round2(weightedAssuredSum / totalCredits) : 0,
    passedAssuredCount,
    atRiskCount,
    subjects
  };
}
