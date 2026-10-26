import { SubjectGradesConfig } from '../../shared/gradesTypes';
import { getIsolatedItem, setIsolatedItem, removeIsolatedItem } from '../utils/storage';
import { syncActiveTermGradesInArchive } from './academicPlanService';

const GRADES_STORAGE_PREFIX = 'gcal_subject_grades_';

export function getSubjectGrades(subjectName: string): SubjectGradesConfig | null {
  if (!subjectName) return null;
  const key = `${GRADES_STORAGE_PREFIX}${subjectName.toLowerCase().trim()}`;
  const raw = getIsolatedItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SubjectGradesConfig;
    if (parsed && Array.isArray(parsed.items)) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

export function saveSubjectGrades(config: SubjectGradesConfig, skipArchiveSync: boolean = false): void {
  if (!config || !config.subjectName) return;
  const key = `${GRADES_STORAGE_PREFIX}${config.subjectName.toLowerCase().trim()}`;
  config.updatedAt = Date.now();
  setIsolatedItem(key, JSON.stringify(config));
  if (!skipArchiveSync) {
    syncActiveTermGradesInArchive();
  }
}

export function deleteSubjectGrades(subjectName: string, skipArchiveSync: boolean = false): void {
  if (!subjectName) return;
  const cleanName = subjectName.toLowerCase().trim();
  const key = `${GRADES_STORAGE_PREFIX}${cleanName}`;
  
  // 1. Remove isolated item properly (both account-isolated and global fallback)
  removeIsolatedItem(key);

  // 2. Sweep any remaining keys in localStorage matching this subject
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(key);
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.includes(`subject_grades_${cleanName}`) || k.endsWith(`grades_${cleanName}`))) {
          toRemove.push(k);
        }
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
    } catch (_) {}
  }

  if (!skipArchiveSync) {
    syncActiveTermGradesInArchive();
  }
}

export function createInitialSubjectGrades(subjectName: string, credits: number = 6): SubjectGradesConfig {
  return {
    subjectName,
    credits: credits || 6,
    minFinalGradeRequired: 4.0,
    items: [
      { id: 'item_1', name: 'Parcial 1', type: 'EXAMEN', weight: 20, grade: null },
      { id: 'item_2', name: 'Prácticas de Laboratorio', type: 'ENTREGA', weight: 30, grade: null },
      { id: 'item_3', name: 'Examen Final', type: 'EXAMEN', weight: 50, grade: null }
    ],
    updatedAt: Date.now()
  };
}
