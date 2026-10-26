export type AppTab = 'CLASES' | 'ENTREGAS_EXAMENES' | 'TODO';

export type EventType = 'EXAMEN' | 'ENTREGA';

export interface AcademicEventPayload {
  type: EventType;
  subject: string;
  title: string;
  description?: string;
  date: string; // YYYY-MM-DD
  startTime?: string; // HH:MM
  endTime?: string; // HH:MM
  time?: string; // HH:MM (backwards compatibility)
}

export type ThemeMode = 'LIGHT' | 'DARK';

export interface ThemeTokens {
  background: string;
  surface: string;
  surfaceHover: string;
  border: string;
  text: string;
  secondaryText: string;
  accent: string;
  selected: string;
  disabled: string;
}

