export type GradeItemType = 'EXAMEN' | 'ENTREGA' | 'OTRO';

export interface GradeItem {
  id: string;
  name: string;
  type: GradeItemType;
  weight: number;                 // Global weight over 100%, e.g. 15 for 15%
  grade: number | null;           // 0.00 to 10.00 or null if pending
  minGradeRequired?: number | null; // Optional item-level minimum cutoff (e.g. 4.0 on final exam)
  dateHint?: string;              // Optional date/period hint (e.g. "25/01/2027")
  category?: string;              // Macro block (e.g. "Teoría", "Prácticas")
  subcategory?: string;           // Sub-topic/module (e.g. "Tema 1", "Tema 2")
  linkedCalendarEventId?: string; // ID of the linked Google Calendar event
  linkedEventTitle?: string;      // Cached title of the linked event
}

export interface SubjectGradesConfig {
  subjectName: string;
  credits: number;                // e.g. 6 ECTS
  minFinalGradeRequired?: number; // Optional global final exam cutoff (e.g. 4.0 or 4.5)
  blockCutoffs?: Record<string, number>; // Specific block cutoffs, e.g. { "Teoría": 4.0, "Prácticas": 4.0 }
  items: GradeItem[];
  updatedAt: number;
}

export interface AISyllabusItem {
  name: string;
  type: GradeItemType;
  weight: number;
  grade?: number | null;
  minGradeRequired?: number | null;
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

export interface GradesChatTurn {
  role: 'user' | 'model';
  text: string;
}

export type CutoffStatus = 'MET' | 'PENDING' | 'AT_RISK' | 'FAILED' | 'IMPOSSIBLE';

export interface CutoffDiagnostic {
  scope: 'ITEM' | 'BLOCK' | 'GLOBAL';
  label: string;
  required: number;
  currentScore: number | null;      // Real graded average/score so far
  projectedScore: number | null;    // Score including simulation
  status: CutoffStatus;
  requiredInPending: number | null; // Grade needed in pending items to satisfy this cutoff
  itemId?: string;
  blockName?: string;
}

export interface TargetGradeCalculation {
  targetGrade: number;           // e.g. 5.0, 7.0, 9.0
  accumulatedPoints: number;     // e.g. 3.45 points from graded items
  gradedWeightTotal: number;     // e.g. 50%
  remainingWeightTotal: number;  // e.g. 50%
  requiredFinalGrade: number;    // e.g. 3.10 or 7.10
  isPossible: boolean;           // true if requiredGrade <= 10.00 and no cutoff is already failed/impossible
  isCutoffTriggered: boolean;    // true if requiredGrade was bumped by a cutoff rule
  minCutoff: number | null;      // e.g. 4.5
  rawRequiredForAverage?: number;
  maxPossibleGrade?: number;
  bottleneckReason?: string | null;
  cutoffDiagnostics?: CutoffDiagnostic[];
}

export type SimulatedGradesMap = Record<string, number>;

export interface ScenarioSimulationResult {
  finalGrade: number;
  isCutoffFailed: boolean;
  minCutoff: number | null;
  failedBlockCutoff?: string;
  failedCutoffs: CutoffDiagnostic[];
  cutoffDiagnostics: CutoffDiagnostic[];
  simulatedItemCount: number;
  pendingUnfilledCount: number;
}

export interface TermSubjectSummary {
  subjectName: string;
  color: string;
  credits: number;
  isConfigured: boolean;
  accumulatedPoints: number;
  currentAverage: number | null;
  gradedWeight: number;
  totalWeight: number;
  maxPossibleGrade: number;
  hasCutoffRisk: boolean;
  hasCutoffFailed: boolean;
  isPassedAssured: boolean;
  itemCount: number;
}

export interface TermSummary {
  totalSubjects: number;
  configuredSubjects: number;
  totalCredits: number;
  evaluatedCredits: number;
  weightedAverageCurrent: number | null;
  weightedAssuredPoints: number;
  passedAssuredCount: number;
  atRiskCount: number;
  subjects: TermSubjectSummary[];
}
