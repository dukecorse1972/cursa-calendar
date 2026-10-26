import { SubjectGradesConfig } from '../../shared/gradesTypes';
import { getPaletteById } from '../../shared/palettes';
import { getSubjectGrades, saveSubjectGrades, deleteSubjectGrades } from './gradesStorage';
import { getIsolatedItem, setIsolatedItem } from '../utils/storage';

export type PeriodRegime = 'cuatrimestre' | 'semestre' | 'trimestre' | 'anual';

export interface PlanSubjectConfig {
  name: string;
  color: string;
}

export interface AcademicPlanConfig {
  totalYears: number;
  periodType: PeriodRegime;
  periodsPerYear: number;
  currentYear: number;
  currentPeriod: number;
  autoBackupOnAdvance: boolean;
  updatedAt?: number;
}

export interface TermSnapshot {
  termKey: string;
  year: number;
  period: number;
  label: string;
  paletteId: string;
  subjects: PlanSubjectConfig[];
  grades: Record<string, SubjectGradesConfig>;
  completed?: boolean;
  savedAt: number;
}

export interface CursaPortableBackup {
  schema: 'cursa-portable-backup';
  version: string;
  exportedAt: string;
  academicPlan: AcademicPlanConfig;
  activePalette: string;
  preferences: {
    hideBirthdays: boolean;
    showOtherCalendars: boolean;
    ensureAcademicCalendars: boolean;
  };
  currentSubjects: PlanSubjectConfig[];
  currentGrades: Record<string, SubjectGradesConfig>;
  termsArchive: Record<string, TermSnapshot>;
  academicMeta?: Record<string, unknown>;
}

const PLAN_STORAGE_KEY = 'gcal_academic_plan';
const ARCHIVE_STORAGE_KEY = 'gcal_terms_archive';

export function getPeriodsPerYearForRegime(regime: PeriodRegime): number {
  switch (regime) {
    case 'trimestre':
      return 3;
    case 'anual':
      return 1;
    case 'semestre':
    case 'cuatrimestre':
    default:
      return 2;
  }
}

export function isValidPeriodRegime(val: unknown): val is PeriodRegime {
  return val === 'cuatrimestre' || val === 'semestre' || val === 'trimestre' || val === 'anual';
}

export function normalizeAcademicPlan(raw?: Partial<AcademicPlanConfig> | null): AcademicPlanConfig {
  const periodType: PeriodRegime = isValidPeriodRegime(raw?.periodType) ? raw.periodType : 'cuatrimestre';
  const periodsPerYear = getPeriodsPerYearForRegime(periodType);

  const rawTotalYears = typeof raw?.totalYears === 'number' && Number.isFinite(raw.totalYears)
    ? Math.round(raw.totalYears)
    : 4;
  const totalYears = Math.min(10, Math.max(1, rawTotalYears));

  const rawCurrentYear = typeof raw?.currentYear === 'number' && Number.isFinite(raw.currentYear)
    ? Math.round(raw.currentYear)
    : 1;
  const currentYear = Math.min(totalYears, Math.max(1, rawCurrentYear));

  const rawCurrentPeriod = typeof raw?.currentPeriod === 'number' && Number.isFinite(raw.currentPeriod)
    ? Math.round(raw.currentPeriod)
    : 1;
  const currentPeriod = Math.min(periodsPerYear, Math.max(1, rawCurrentPeriod));

  const autoBackupOnAdvance = raw?.autoBackupOnAdvance === undefined ? true : Boolean(raw.autoBackupOnAdvance);

  return {
    totalYears,
    periodType,
    periodsPerYear,
    currentYear,
    currentPeriod,
    autoBackupOnAdvance,
    updatedAt: raw?.updatedAt || Date.now()
  };
}

export function getTermKey(year: number, period: number): string {
  return `Y${Math.max(1, Math.round(year))}-P${Math.max(1, Math.round(period))}`;
}

export function formatPeriodUnit(regime: PeriodRegime, period: number, short: boolean = false): string {
  if (regime === 'anual') {
    return short ? 'Anual' : 'Curso Anual';
  }
  if (regime === 'trimestre') {
    return short ? `${period}T` : `${period}º Trimestre`;
  }
  if (regime === 'semestre') {
    return short ? `${period}S` : `${period}º Semestre`;
  }
  return short ? `${period}Q` : `${period}º Cuatrimestre`;
}

export function formatPeriodLabel(
  plan: AcademicPlanConfig,
  year: number = plan.currentYear,
  period: number = plan.currentPeriod,
  short: boolean = false
): string {
  const unit = formatPeriodUnit(plan.periodType, period, short);
  return `${year}º Año · ${unit}`;
}

export function getAcademicPlan(): AcademicPlanConfig {
  try {
    const raw = getIsolatedItem(PLAN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return normalizeAcademicPlan(parsed);
    }
  } catch (_) {}
  return normalizeAcademicPlan();
}

export function saveAcademicPlan(planInput: Partial<AcademicPlanConfig>): AcademicPlanConfig {
  const current = getAcademicPlan();
  const merged = normalizeAcademicPlan({
    ...current,
    ...planInput,
    updatedAt: Date.now()
  });
  try {
    setIsolatedItem(PLAN_STORAGE_KEY, JSON.stringify(merged));
  } catch (_) {}
  return merged;
}

export function getTermsArchive(): Record<string, TermSnapshot> {
  try {
    const raw = getIsolatedItem(ARCHIVE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, TermSnapshot>;
      }
    }
  } catch (_) {}
  return {};
}

function saveTermsArchiveMap(archive: Record<string, TermSnapshot>): void {
  try {
    setIsolatedItem(ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
  } catch (_) {}
}

export function collectGradesForSubjects(subjects: PlanSubjectConfig[]): Record<string, SubjectGradesConfig> {
  const gradesMap: Record<string, SubjectGradesConfig> = {};
  for (const sub of subjects) {
    const cleanName = (sub.name || '').trim();
    if (!cleanName) continue;
    const cfg = getSubjectGrades(cleanName);
    if (cfg) {
      gradesMap[cleanName] = cfg;
    }
  }
  return gradesMap;
}

export function saveTermSnapshotToArchive(
  plan: AcademicPlanConfig,
  subjects: PlanSubjectConfig[],
  paletteId: string,
  completedOverride?: boolean
): TermSnapshot {
  const validSubjects = subjects
    .filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0)
    .map((s) => ({ name: s.name.trim(), color: s.color || '#98D5E8' }));

  const termKey = getTermKey(plan.currentYear, plan.currentPeriod);
  const archive = getTermsArchive();
  const prevSnap = archive[termKey];

  // Merge existing archived grades for this term with live grades so nothing is ever lost
  const liveGrades = collectGradesForSubjects(validSubjects);
  const mergedGrades: Record<string, SubjectGradesConfig> = {};
  if (prevSnap?.grades && typeof prevSnap.grades === 'object') {
    for (const [k, v] of Object.entries(prevSnap.grades)) {
      if (validSubjects.some((s) => s.name.toLowerCase() === k.toLowerCase())) {
        mergedGrades[k] = v;
      }
    }
  }
  for (const [k, v] of Object.entries(liveGrades)) {
    mergedGrades[k] = v;
  }

  const completed =
    completedOverride !== undefined ? Boolean(completedOverride) : Boolean(prevSnap?.completed);

  const snapshot: TermSnapshot = {
    termKey,
    year: plan.currentYear,
    period: plan.currentPeriod,
    label: formatPeriodLabel(plan, plan.currentYear, plan.currentPeriod, false),
    paletteId: paletteId || 'mildliner',
    subjects: validSubjects,
    grades: mergedGrades,
    completed,
    savedAt: Date.now()
  };

  archive[termKey] = snapshot;
  saveTermsArchiveMap(archive);
  return snapshot;
}

export function isTermCompleted(year?: number, period?: number): boolean {
  const plan = getAcademicPlan();
  const y = year ?? plan.currentYear;
  const p = period ?? plan.currentPeriod;
  const archive = getTermsArchive();
  return Boolean(archive[getTermKey(y, p)]?.completed);
}

export function setTermCompleted(
  year: number,
  period: number,
  completed: boolean,
  activeSubjects?: PlanSubjectConfig[],
  activePaletteId?: string
): TermSnapshot {
  const plan = getAcademicPlan();
  if (plan.currentYear === year && plan.currentPeriod === period) {
    let subjects = activeSubjects;
    if (!subjects) {
      try {
        const raw = getIsolatedItem('gcal_academic_subjects');
        subjects = raw ? JSON.parse(raw) : [];
      } catch {
        subjects = [];
      }
    }
    const paletteId = activePaletteId || getIsolatedItem('gcal_active_palette') || 'mildliner';
    return saveTermSnapshotToArchive(plan, Array.isArray(subjects) ? subjects : [], paletteId, completed);
  }

  const archive = getTermsArchive();
  const termKey = getTermKey(year, period);
  const existing = archive[termKey];
  const updated: TermSnapshot = existing
    ? {
        ...existing,
        completed: Boolean(completed),
        savedAt: Date.now()
      }
    : {
        termKey,
        year,
        period,
        label: formatPeriodLabel(plan, year, period, false),
        paletteId: activePaletteId || getIsolatedItem('gcal_active_palette') || 'mildliner',
        subjects: [],
        grades: {},
        completed: Boolean(completed),
        savedAt: Date.now()
      };

  archive[termKey] = updated;
  saveTermsArchiveMap(archive);
  return updated;
}

/**
 * Keeps the active period's archive entry synced whenever grades are modified in Calificaciones.
 */
export function syncActiveTermGradesInArchive(): void {
  try {
    const rawSubj = getIsolatedItem('gcal_academic_subjects');
    if (!rawSubj) return;
    const parsed = JSON.parse(rawSubj);
    if (!Array.isArray(parsed)) return;
    const plan = getAcademicPlan();
    const paletteId = getIsolatedItem('gcal_active_palette') || 'mildliner';
    saveTermSnapshotToArchive(plan, parsed, paletteId);
  } catch (_) {}
}

export function persistActiveSubjectsAndColors(subjects: PlanSubjectConfig[], paletteId: string): void {
  try {
    const valid = subjects
      .filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0)
      .map((s) => ({ name: s.name.trim(), color: s.color || '#98D5E8' }));

    setIsolatedItem('gcal_academic_onboarding_completed', 'true');
    setIsolatedItem('gcal_active_palette', paletteId);
    setIsolatedItem('gcal_academic_subjects', JSON.stringify(valid));
    const colorMap: Record<string, string> = {};
    valid.forEach((s) => {
      colorMap[s.name.toLowerCase().trim()] = s.color;
    });
    setIsolatedItem('gcal_subject_colors', JSON.stringify(colorMap));
  } catch (_) {}
}

export function switchToTerm(
  targetYear: number,
  targetPeriod: number,
  currentSubjects: PlanSubjectConfig[],
  currentPaletteId: string
): {
  plan: AcademicPlanConfig;
  subjects: PlanSubjectConfig[];
  paletteId: string;
  restoredFromArchive: boolean;
} {
  const currentPlan = getAcademicPlan();
  const validCurrent = currentSubjects.filter((s) => s && s.name && s.name.trim().length > 0);

  // 1. Always save current period snapshot before switching
  saveTermSnapshotToArchive(currentPlan, validCurrent, currentPaletteId);

  // Clean active grades of outgoing period so they don't bleed into the new period
  validCurrent.forEach((s) => deleteSubjectGrades(s.name, true));

  // 2. Normalize target coordinates
  const nextPlan = saveAcademicPlan({
    ...currentPlan,
    currentYear: targetYear,
    currentPeriod: targetPeriod
  });

  // 3. Check if target term exists in archive
  const archive = getTermsArchive();
  const targetKey = getTermKey(nextPlan.currentYear, nextPlan.currentPeriod);
  const existingSnapshot = archive[targetKey];

  if (existingSnapshot && Array.isArray(existingSnapshot.subjects)) {
    const restoredPalette = existingSnapshot.paletteId || currentPaletteId || 'mildliner';
    const restoredSubjects = existingSnapshot.subjects.map((s) => ({
      name: s.name,
      color: s.color
    }));

    // Restore grades for this archived term
    if (existingSnapshot.grades && typeof existingSnapshot.grades === 'object') {
      Object.values(existingSnapshot.grades).forEach((gradeCfg) => {
        if (gradeCfg && gradeCfg.subjectName) {
          saveSubjectGrades(gradeCfg, true);
        }
      });
    }

    persistActiveSubjectsAndColors(restoredSubjects, restoredPalette);
    return {
      plan: nextPlan,
      subjects: restoredSubjects,
      paletteId: restoredPalette,
      restoredFromArchive: true
    };
  }

  // 4. Brand-new unconfigured period: start with 0 active subjects so previous period's subjects disappear!
  const cleanPaletteId = currentPaletteId || 'mildliner';
  persistActiveSubjectsAndColors([], cleanPaletteId);

  return {
    plan: nextPlan,
    subjects: [],
    paletteId: cleanPaletteId,
    restoredFromArchive: false
  };
}

export function advanceToNextTerm(
  currentSubjects: PlanSubjectConfig[],
  currentPaletteId: string
): {
  plan: AcademicPlanConfig;
  subjects: PlanSubjectConfig[];
  paletteId: string;
  previousTermLabel: string;
  newTermLabel: string;
  isLastTerm: boolean;
  backup: CursaPortableBackup;
} {
  const currentPlan = getAcademicPlan();
  const previousTermLabel = formatPeriodLabel(currentPlan, currentPlan.currentYear, currentPlan.currentPeriod, false);

  // Create portable backup snapshot before advancing
  const backup = exportPortableBackup(currentSubjects, currentPaletteId);

  let nextYear = currentPlan.currentYear;
  let nextPeriod = currentPlan.currentPeriod;
  let isLastTerm = false;

  if (currentPlan.currentPeriod < currentPlan.periodsPerYear) {
    nextPeriod = currentPlan.currentPeriod + 1;
  } else if (currentPlan.currentYear < currentPlan.totalYears) {
    nextYear = currentPlan.currentYear + 1;
    nextPeriod = 1;
  } else {
    isLastTerm = true;
  }

  if (isLastTerm) {
    saveTermSnapshotToArchive(currentPlan, currentSubjects, currentPaletteId);
    return {
      plan: currentPlan,
      subjects: currentSubjects,
      paletteId: currentPaletteId,
      previousTermLabel,
      newTermLabel: previousTermLabel,
      isLastTerm: true,
      backup
    };
  }

  const switched = switchToTerm(nextYear, nextPeriod, currentSubjects, currentPaletteId);
  const newTermLabel = formatPeriodLabel(switched.plan, switched.plan.currentYear, switched.plan.currentPeriod, false);

  return {
    plan: switched.plan,
    subjects: switched.subjects,
    paletteId: switched.paletteId,
    previousTermLabel,
    newTermLabel,
    isLastTerm: false,
    backup
  };
}

export function exportPortableBackup(
  currentSubjectsInput?: PlanSubjectConfig[],
  currentPaletteInput?: string
): CursaPortableBackup {
  const plan = getAcademicPlan();
  const activePalette = currentPaletteInput || getIsolatedItem('gcal_active_palette') || 'mildliner';

  let currentSubjects: PlanSubjectConfig[] = currentSubjectsInput || [];
  if (currentSubjectsInput === undefined) {
    try {
      const rawSubj = getIsolatedItem('gcal_academic_subjects');
      if (rawSubj) {
        const parsed = JSON.parse(rawSubj);
        if (Array.isArray(parsed)) {
          currentSubjects = parsed;
        }
      }
    } catch (_) {}
  }

  const validSubjects = currentSubjects
    .filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0)
    .map((s) => ({ name: s.name.trim(), color: s.color || '#98D5E8' }));

  // Ensure current term is synced into archive
  saveTermSnapshotToArchive(plan, validSubjects, activePalette);

  const currentGrades = collectGradesForSubjects(validSubjects);
  const termsArchive = getTermsArchive();

  const storedBirthdays = getIsolatedItem('gcal_hide_birthdays');
  const hideBirthdays = storedBirthdays === null ? true : storedBirthdays !== 'false';
  const storedOther = getIsolatedItem('gcal_show_other_calendars');
  const showOtherCalendars = storedOther === null ? true : storedOther !== 'false';
  const ensureAcademicCalendars = getIsolatedItem('gcal_academic_calendars_ensured') === 'true';

  let academicMeta: Record<string, unknown> = {};
  try {
    const rawMeta = getIsolatedItem('gcal_academic_meta');
    if (rawMeta) {
      academicMeta = JSON.parse(rawMeta);
    }
  } catch (_) {}

  return {
    schema: 'cursa-portable-backup',
    version: '1.1.2',
    exportedAt: new Date().toISOString(),
    academicPlan: plan,
    activePalette,
    preferences: {
      hideBirthdays,
      showOtherCalendars,
      ensureAcademicCalendars
    },
    currentSubjects: validSubjects,
    currentGrades,
    termsArchive,
    academicMeta
  };
}

export function downloadPortableBackupFile(backup: CursaPortableBackup): string {
  const shortPeriod = formatPeriodUnit(
    backup.academicPlan.periodType,
    backup.academicPlan.currentPeriod,
    true
  );
  const datePart = backup.exportedAt.slice(0, 10);
  const fileName = `cursa-backup-${backup.academicPlan.currentYear}A-${shortPeriod}-${datePart}.cursa.json`;

  if (typeof document !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const jsonContent = JSON.stringify(backup, null, 2);
      const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 200);
    } catch (_) {}
  }

  return fileName;
}

export function importPortableBackup(rawJson: string): {
  plan: AcademicPlanConfig;
  subjects: PlanSubjectConfig[];
  paletteId: string;
  archiveCount: number;
} {
  if (!rawJson || typeof rawJson !== 'string') {
    throw new Error('El archivo de copia de seguridad está vacío.');
  }

  let parsed: Partial<CursaPortableBackup>;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('El archivo seleccionado no es un JSON válido (.cursa.json).');
  }

  if (!parsed || typeof parsed !== 'object' || parsed.schema !== 'cursa-portable-backup') {
    throw new Error('Formato incompatible: el archivo no es una copia de seguridad portátil de Cursa (.cursa.json).');
  }

  const plan = saveAcademicPlan(parsed.academicPlan || {});
  const paletteId = typeof parsed.activePalette === 'string' && parsed.activePalette.trim()
    ? parsed.activePalette.trim()
    : 'mildliner';

  const palette = getPaletteById(paletteId);
  const rawSubjects = Array.isArray(parsed.currentSubjects) ? parsed.currentSubjects : [];
  const validSubjects: PlanSubjectConfig[] = rawSubjects
    .filter((s) => s && typeof s.name === 'string' && s.name.trim().length > 0)
    .map((s, idx) => ({
      name: s.name.trim(),
      color: typeof s.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(s.color)
        ? s.color
        : palette.colors[idx % palette.colors.length].hex
    }));

  // Restore preferences
  if (parsed.preferences && typeof parsed.preferences === 'object') {
    setIsolatedItem('gcal_hide_birthdays', String(Boolean(parsed.preferences.hideBirthdays)));
    setIsolatedItem('gcal_show_other_calendars', String(Boolean(parsed.preferences.showOtherCalendars)));
    setIsolatedItem('gcal_academic_calendars_ensured', String(Boolean(parsed.preferences.ensureAcademicCalendars)));
  }

  // Restore terms archive
  const archive: Record<string, TermSnapshot> = {};
  if (parsed.termsArchive && typeof parsed.termsArchive === 'object') {
    for (const [k, snap] of Object.entries(parsed.termsArchive)) {
      if (snap && typeof snap === 'object' && Array.isArray(snap.subjects)) {
        archive[k] = {
          ...snap,
          completed: Boolean(snap.completed)
        };
      }
    }
  }
  saveTermsArchiveMap(archive);

  // Restore current grades
  if (parsed.currentGrades && typeof parsed.currentGrades === 'object') {
    Object.values(parsed.currentGrades).forEach((cfg) => {
      if (cfg && typeof cfg === 'object' && cfg.subjectName && Array.isArray(cfg.items)) {
        saveSubjectGrades(cfg, true);
      }
    });
  }

  // Restore academicMeta if present
  if (parsed.academicMeta && typeof parsed.academicMeta === 'object') {
    try {
      setIsolatedItem('gcal_academic_meta', JSON.stringify(parsed.academicMeta));
    } catch (_) {}
  }

  // Restore active subjects & palette
  persistActiveSubjectsAndColors(validSubjects, paletteId);

  return {
    plan,
    subjects: validSubjects,
    paletteId,
    archiveCount: Object.keys(archive).length
  };
}
