import { GradeItem, GradeItemType, TargetGradeCalculation } from './gradesTypes';

/**
 * Calculates current accumulated points and weights from graded items.
 */
export function calculateAccumulatedScore(items: GradeItem[]): {
  accumulatedPoints: number;
  gradedWeight: number;
  totalWeight: number;
} {
  let accumulatedPoints = 0;
  let gradedWeight = 0;
  let totalWeight = 0;

  for (const item of items) {
    totalWeight += item.weight;
    if (typeof item.grade === 'number' && !isNaN(item.grade)) {
      accumulatedPoints += (item.grade * item.weight) / 100;
      gradedWeight += item.weight;
    }
  }

  return {
    accumulatedPoints: Math.round(accumulatedPoints * 100) / 100,
    gradedWeight: Math.round(gradedWeight * 10) / 10,
    totalWeight: Math.round(totalWeight * 10) / 10
  };
}

/**
 * Calculates the required grade in remaining pending items (or final exam) to reach a target grade.
 */
export function calculateTargetRequiredGrade(
  items: GradeItem[],
  targetGrade: number,
  minFinalGradeRequired?: number | null
): TargetGradeCalculation {
  const { accumulatedPoints, gradedWeight, totalWeight } = calculateAccumulatedScore(items);
  const remainingWeight = Math.max(0, 100 - gradedWeight);

  if (remainingWeight === 0) {
    return {
      targetGrade,
      accumulatedPoints,
      gradedWeightTotal: gradedWeight,
      remainingWeightTotal: 0,
      requiredFinalGrade: accumulatedPoints,
      isPossible: accumulatedPoints >= targetGrade,
      isCutoffTriggered: false,
      minCutoff: minFinalGradeRequired ?? null
    };
  }

  // Target = Accumulated + (Required * RemainingWeight / 100)
  // Required = (Target - Accumulated) * 100 / RemainingWeight
  const rawRequired = ((targetGrade - accumulatedPoints) * 100) / remainingWeight;
  const roundedRequired = Math.round(rawRequired * 100) / 100;

  let finalRequired = Math.max(0, roundedRequired);
  let isCutoffTriggered = false;

  const cutoff = typeof minFinalGradeRequired === 'number' && !isNaN(minFinalGradeRequired) ? minFinalGradeRequired : null;

  if (cutoff !== null && finalRequired < cutoff) {
    finalRequired = cutoff;
    isCutoffTriggered = true;
  }

  const isPossible = finalRequired <= 10.0;

  return {
    targetGrade,
    accumulatedPoints,
    gradedWeightTotal: gradedWeight,
    remainingWeightTotal: remainingWeight,
    requiredFinalGrade: Math.round(finalRequired * 100) / 100,
    isPossible,
    isCutoffTriggered,
    minCutoff: cutoff
  };
}

/**
 * Simulates final course grade given a hypothetical score on the pending exam/item.
 * Evaluates both global minimum cutoff and independent block cutoffs.
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
  const cutoff = typeof minFinalGradeRequired === 'number' && !isNaN(minFinalGradeRequired) ? minFinalGradeRequired : null;
  let isCutoffFailed = cutoff !== null && simulatedScore < cutoff;
  let failedBlockCutoff: string | undefined = undefined;

  let totalPoints = 0;
  for (const item of items) {
    const gradeToUse = typeof item.grade === 'number' && !isNaN(item.grade) ? item.grade : simulatedScore;
    totalPoints += (gradeToUse * item.weight) / 100;
  }

  // Evaluate independent block cutoffs if configured (e.g. min 4.0 in Theory AND min 4.0 in Practice)
  if (blockCutoffs && Object.keys(blockCutoffs).length > 0) {
    const groups = groupGradeItems(items, blockCutoffs);
    for (const group of groups) {
      const required = blockCutoffs[group.name];
      if (typeof required === 'number' && group.totalWeight > 0) {
        let groupPoints = 0;
        for (const itemWrap of group.items) {
          const item = itemWrap.item;
          const g = typeof item.grade === 'number' && !isNaN(item.grade) ? item.grade : simulatedScore;
          groupPoints += (g * item.weight) / 100;
        }
        const groupInternal = Math.round(((groupPoints * 100) / group.totalWeight) * 100) / 100;
        if (groupInternal < required) {
          isCutoffFailed = true;
          failedBlockCutoff = `${group.name} (${groupInternal.toFixed(2)} < ${required.toFixed(1)})`;
          break;
        }
      }
    }
  }

  return {
    finalGrade: Math.min(10, Math.max(0, Math.round(totalPoints * 100) / 100)),
    isCutoffFailed,
    minCutoff: cutoff,
    failedBlockCutoff
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
  blockScore: number;
  internalScore: number | null;
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
    // Matches patterns like "Tema 2 (Memoria + Examen)", "Prácticas: Tema 2 (20% Memoria técnica + 80% Examen)", or "Memoria + Examen"
    const parenMatch = item.name.match(/^(.*?)(?:\s*\(|\s*\[)([^)]+?)\s*\+\s*([^)]+?)(?:\)|\].*?)$/i);
    const colonPlusMatch = !parenMatch && item.name.match(/^(.*?)\s*:\s*(.+?)\s*\+\s*(.+?)$/i);
    const directPlusMatch = !parenMatch && !colonPlusMatch && item.name.match(/^(.+?)\s+\+\s+(.+?)$/i);

    const match = parenMatch || colonPlusMatch || directPlusMatch;

    if (match) {
      const prefix = (parenMatch ? parenMatch[1] : (colonPlusMatch ? colonPlusMatch[1] : '')).trim();
      const part1Raw = (parenMatch ? parenMatch[2] : (colonPlusMatch ? colonPlusMatch[2] : match[1])).trim();
      const part2Raw = (parenMatch ? parenMatch[3] : (colonPlusMatch ? colonPlusMatch[3] : match[2])).trim();

      // Ensure both parts have non-trivial names and look like distinct evaluable components
      if (part1Raw.length > 0 && part2Raw.length > 0) {
        // Extract internal percentage hints if present (e.g. "20% Memoria" vs "80% Examen")
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

        // Clean part display names
        let cleanPart1 = part1Raw.replace(/^\d+(?:\.\d+)?\s*%\s*(?:de\s+)?/i, '').trim();
        let cleanPart2 = part2Raw.replace(/^\d+(?:\.\d+)?\s*%\s*(?:de\s+)?/i, '').trim();

        // Infer subcategory if not already set
        let sub = item.subcategory;
        if (!sub) {
          const subMatch = (prefix || item.name).match(/(Tema\s*\d+|Módulo\s*\d+|Unit\s*\d+|T\d+|Práctica\s*\d+|Lab\s*\d+)/i);
          if (subMatch) {
            sub = subMatch[1];
          }
        }

        const weight1 = Math.round(item.weight * ratio1 * 100) / 100;
        const weight2 = Math.round((item.weight - weight1) * 100) / 100;

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
          grade: null,
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
 * Level 2: Sub-groups / Topics / Themes within the block (e.g. "Tema 1", "Tema 2", "Tema 3", "Tema 4")
 *
 * Highly intelligent: avoids scattering individual practical topics into separate top-level accordions,
 * grouping them logically under their parent practical block with nested topic dividers and relative weights.
 */
export function groupGradeItems(
  items: GradeItem[],
  blockCutoffs?: Record<string, number>
): GradeGroup[] {
  // First, decompose any composite or fused items atomically
  const atomicItems = decomposeCompositeItems(items);
  const isSubtopicPattern = /^(tema\s*\d+|m[oó]dulo\s*\d+|unit\s*\d+|t\d+|pr[aá]ctica\s*\d+|lab\s*\d+)/i;

  // 1. Normalize each item into (macroCategory, subcategory, displayName)
  const normalizedItems = atomicItems.map((item, originalIndex) => {
    let macro = item.category?.trim() || '';
    let sub = item.subcategory?.trim() || '';
    let displayName = item.name.trim();

    // If category was erroneously set as a subtopic (e.g. "Tema 1", "Tema 2")
    if (macro && isSubtopicPattern.test(macro)) {
      if (!sub) sub = macro;
      macro = '';
    }

    // Try extracting double prefix: e.g. "Prácticas: Tema 2 - Memoria técnica" or "[Prácticas] Tema 2: Examen"
    const doubleMatch = displayName.match(
      /^\[?([A-Za-z0-9ÁÉÍÓÚáéíóúñÑüÜ\s]{2,20})\]?[:\-\/|•\]]\s*(Tema\s*\d+|Módulo\s*\d+|Unit\s*\d+|T\d+|Práctica\s*\d+|Lab\s*\d+)[:\-\/|•\]\s]*(.+)$/i
    );

    if (doubleMatch) {
      if (!macro) macro = doubleMatch[1].trim();
      if (!sub) sub = doubleMatch[2].trim();
      displayName = doubleMatch[3].trim();
    } else {
      // Single prefix match: e.g. "Teoría: Test 1" or "Prácticas - Examen Tema 1"
      const singleMatch = displayName.match(/^\[?([A-Za-z0-9ÁÉÍÓÚáéíóúñÑüÜ\s]{2,25})\]?[:\-\/|•\]]\s*(.+)$/);
      if (singleMatch) {
        const prefix = singleMatch[1].trim();
        const rest = singleMatch[2].trim();

        if (isSubtopicPattern.test(prefix)) {
          if (!sub) sub = prefix;
          displayName = rest;
        } else {
          if (!macro) macro = prefix;
          displayName = rest;
        }
      }
    }

    // Check if displayName still contains subtopic keyword like "Tema 1", "Tema 2" inside it
    if (!sub) {
      const temaMatch = displayName.match(/\b(Tema\s*\d+|Módulo\s*\d+|Unit\s*\d+|T\d+)\b/i);
      if (temaMatch) {
        sub = temaMatch[1].replace(/\b([a-z])/g, (c) => c.toUpperCase());
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

    // Strip leading/trailing punctuation and isolated wrapping parentheses (e.g. "(Examen)" -> "Examen")
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
      displayName,
      macro,
      sub
    };
  });

  // 2. Infer macro for items that have a subcategory (like "Tema 1") but no parent macro
  const knownMacros = Array.from(new Set(normalizedItems.map((n) => n.macro).filter(Boolean)));
  const hasTeoria = knownMacros.some((m) => /teor/i.test(m));
  const hasPracticas = knownMacros.some((m) => /pr[aá]ct|lab/i.test(m));

  normalizedItems.forEach((n) => {
    if (!n.macro) {
      if (hasPracticas) {
        n.macro = knownMacros.find((m) => /pr[aá]ct|lab/i.test(m)) || 'Prácticas';
      } else if (hasTeoria && n.sub) {
        n.macro = 'Prácticas';
      } else if (/pr[aá]ct|lab|memoria|entrega/i.test(n.item.name)) {
        n.macro = 'Prácticas';
      } else if (/teor|test|examen\s*de\s*problemas/i.test(n.item.name)) {
        n.macro = 'Teoría';
      } else if (knownMacros.length === 1) {
        n.macro = knownMacros[0];
      } else {
        n.macro = n.sub ? 'Prácticas' : 'Evaluación General';
      }
    }
  });

  // 3. Build hierarchical GradeGroups and GradeSubgroups
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
    const totalWeight = Math.round(groupData.allItems.reduce((s, g) => s + g.item.weight, 0) * 100) / 100;
    const graded = groupData.allItems.filter((g) => typeof g.item.grade === 'number' && !isNaN(g.item.grade));
    const gradedWeight = Math.round(graded.reduce((s, g) => s + g.item.weight, 0) * 100) / 100;
    const rawPoints = graded.reduce((s, g) => s + (g.item.grade! * g.item.weight) / 100, 0);
    const accumulatedPoints = Math.round(rawPoints * 100) / 100;
    
    // blockScore: accumulated points on the 0-10 scale within this block
    const blockScore = totalWeight > 0 ? Math.round(((rawPoints * 100) / totalWeight) * 100) / 100 : 0;
    // internalScore: average score of graded items so far on 0-10 scale
    const internalScore = gradedWeight > 0 ? Math.round(((rawPoints * 100) / gradedWeight) * 100) / 100 : null;

    // Check cut-off for this block
    const cutoff = blockCutoffs ? blockCutoffs[groupName] : undefined;
    let isCutoffMet: boolean | undefined = undefined;
    let missingBlockPoints: number | undefined = undefined;
    let requiredGradeInPending: number | null | undefined = undefined;
    let isCutoffImpossible: boolean | undefined = undefined;

    if (typeof cutoff === 'number') {
      isCutoffMet = blockScore >= cutoff;
      missingBlockPoints = isCutoffMet ? 0 : Math.round(Math.max(0, cutoff - blockScore) * 100) / 100;
      const pendingWeight = Math.max(0, totalWeight - gradedWeight);
      const maxPendingBlockScore = totalWeight > 0 ? (pendingWeight / totalWeight) * 10 : 0;

      if (isCutoffMet) {
        requiredGradeInPending = 0;
        isCutoffImpossible = false;
      } else if (pendingWeight === 0) {
        requiredGradeInPending = null;
        isCutoffImpossible = true;
      } else if (blockScore + maxPendingBlockScore < cutoff) {
        requiredGradeInPending = maxPendingBlockScore > 0 ? Math.round(((missingBlockPoints / maxPendingBlockScore) * 10) * 100) / 100 : null;
        isCutoffImpossible = true;
      } else {
        requiredGradeInPending = maxPendingBlockScore > 0 ? Math.round(((missingBlockPoints / maxPendingBlockScore) * 10) * 100) / 100 : null;
        isCutoffImpossible = false;
      }
    }

    // Build subgroups
    const subgroups: GradeSubgroup[] = [];
    for (const [subName, subItems] of groupData.subgroupsMap.entries()) {
      const subTotalWeight = Math.round(subItems.reduce((s, g) => s + g.item.weight, 0) * 100) / 100;
      const subGraded = subItems.filter((g) => typeof g.item.grade === 'number' && !isNaN(g.item.grade));
      const subGradedWeight = Math.round(subGraded.reduce((s, g) => s + g.item.weight, 0) * 100) / 100;
      const subRawPoints = subGraded.reduce((s, g) => s + (g.item.grade! * g.item.weight) / 100, 0);
      const subAccPoints = Math.round(subRawPoints * 100) / 100;
      const subInternalScore = subGradedWeight > 0 ? Math.round(((subRawPoints * 100) / subGradedWeight) * 100) / 100 : null;

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

