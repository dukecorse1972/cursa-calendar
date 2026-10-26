/**
 * Lightweight Internationalization (i18n) Service
 * Supports Spanish (default) and English.
 */

export type Locale = 'es' | 'en';

let explicitLocale: Locale | null = null;

export function setLocale(loc: Locale | null): void {
  explicitLocale = loc;
}

export function getLocale(): Locale {
  return explicitLocale || getActiveLocale();
}

function getActiveLocale(): Locale {
  if (explicitLocale) return explicitLocale;
  // If running in pure Node.js runtime (unit tests or background workers), default deterministically to 'es'
  if (typeof process !== 'undefined' && process.versions?.node && !process.versions?.electron) {
    if (typeof document !== 'undefined' && document.documentElement?.lang) {
      const htmlLang = (document.documentElement.lang || '').toLowerCase();
      if (htmlLang.startsWith('en')) return 'en';
      if (htmlLang.startsWith('es')) return 'es';
    }
    return 'es';
  }
  if (typeof document !== 'undefined' && document.documentElement?.lang) {
    const htmlLang = (document.documentElement.lang || '').toLowerCase();
    if (htmlLang.startsWith('en')) return 'en';
    if (htmlLang.startsWith('es')) return 'es';
  }
  if (typeof navigator !== 'undefined' && !navigator.userAgent?.includes('Node.js')) {
    const lang = (navigator.language || '').toLowerCase();
    if (lang.startsWith('en')) return 'en';
  }
  return 'es';
}

const TRANSLATIONS = {
  es: {
    tab_clases: 'CLASES',
    tab_entregas: 'EXÁMENES Y ENTREGAS',
    tab_todo: 'TODO',
    course_settings: '🎓 Ajustes de Curso',
    new_academic_event: 'Nuevo Evento Académico',
    subtitle_academic_event: 'Sincronizado con tus calendarios universitarios',
    type_exam: 'Examen',
    type_assignment: 'Entrega',
    subject: 'Asignatura',
    title: 'Título del Evento',
    schedule: 'Horario',
    duration: 'Duración',
    description_notes: 'Descripción / Temario / Ubicación',
    btn_create: 'Crear Evento',
    btn_creating: 'Creando...',
    btn_save: 'Guardar Cambios',
    btn_saving: 'Guardando...',
    btn_cancel: 'Cancelar',
    btn_close: 'Cerrar',
    btn_delete: 'Eliminar',
    btn_deleting: 'Eliminando...',
    badge_done: '✓ HECHA',
    countdown_days_left: (n: number) => `Faltan ${n} día${n === 1 ? '' : 's'}`,
    countdown_today: '¡Es hoy!',
    countdown_past: 'Evento pasado'
  },
  en: {
    tab_clases: 'CLASSES',
    tab_entregas: 'EXAMS & DEADLINES',
    tab_todo: 'ALL',
    course_settings: '🎓 Course Settings',
    new_academic_event: 'New Academic Event',
    subtitle_academic_event: 'Synchronized with your academic calendars',
    type_exam: 'Exam',
    type_assignment: 'Assignment',
    subject: 'Subject',
    title: 'Event Title',
    schedule: 'Schedule',
    duration: 'Duration',
    description_notes: 'Description / Syllabus / Location',
    btn_create: 'Create Event',
    btn_creating: 'Creating...',
    btn_save: 'Save Changes',
    btn_saving: 'Saving...',
    btn_cancel: 'Cancel',
    btn_close: 'Close',
    btn_delete: 'Delete',
    btn_deleting: 'Deleting...',
    badge_done: '✓ DONE',
    countdown_days_left: (n: number) => `${n} day${n === 1 ? '' : 's'} left`,
    countdown_today: 'Today!',
    countdown_past: 'Past event'
  }
};

export function t<K extends keyof typeof TRANSLATIONS['es']>(key: K): (typeof TRANSLATIONS['es'])[K] {
  const locale = getActiveLocale();
  return (TRANSLATIONS[locale]?.[key] ?? TRANSLATIONS['es'][key]) as (typeof TRANSLATIONS['es'])[K];
}
