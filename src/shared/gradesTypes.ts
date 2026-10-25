export type GradeItemType = 'EXAMEN' | 'ENTREGA' | 'OTRO';

export interface GradeItem {
  id: string;
  name: string;
  type: GradeItemType;
  weight: number;                 // e.g. 15 for 15%
  grade: number | null;           // 0.00 to 10.00 or null if pending
  category?: string;              // Macro block (e.g. "Teoría", "Prácticas")
  subcategory?: string;           // Sub-topic/module (e.g. "Tema 1", "Tema 2")
  linkedCalendarEventId?: string; // ID of the linked Google Calendar event
  linkedEventTitle?: string;      // Cached title of the linked event
}

export interface SubjectGradesConfig {
  subjectName: string;
  credits: number;                // e.g. 6 ECTS
  minFinalGradeRequired?: number; // e.g. 4.0 or 4.5
  blockCutoffs?: Record<string, number>; // Specific block cutoffs, e.g. { "Teoría": 4.0, "Prácticas": 4.0 }
  items: GradeItem[];
  updatedAt: number;
}

export interface AISyllabusItem {
  name: string;
  type: GradeItemType;
  weight: number;
  grade?: number | null;
  dateHint?: string;
  category?: string;
  subcategory?: string;
}

export interface AISyllabusExtraction {
  subject: string;
  minFinalGradeRequired: number | null;
  blockCutoffs?: Record<string, number>;
  items: AISyllabusItem[];
  aiExplanation: string;
}

export interface TargetGradeCalculation {
  targetGrade: number;           // e.g. 5.0, 7.0, 9.0
  accumulatedPoints: number;     // e.g. 3.45 points from graded items
  gradedWeightTotal: number;     // e.g. 50%
  remainingWeightTotal: number;  // e.g. 50%
  requiredFinalGrade: number;    // e.g. 3.10 or 7.10
  isPossible: boolean;           // true if requiredGrade <= 10.00
  isCutoffTriggered: boolean;    // true if requiredGrade was bumped to minFinalGradeRequired
  minCutoff: number | null;      // e.g. 4.5
}
