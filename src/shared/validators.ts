import { AcademicEventPayload, EventType } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates date format (YYYY-MM-DD) and checks for valid calendar date.
 */
export function isValidDate(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * Validates time format (HH:MM) in 24-hour notation.
 */
export function isValidTime(timeStr: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return false;
  return true;
}

/**
 * Validates an AcademicEventPayload strictly on the Main process / IPC boundary.
 */
export function validateAcademicEventPayload(payload: unknown): ValidationResult {
  const errors: string[] = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  const p = payload as Partial<AcademicEventPayload>;

  // 1. Type validation
  if (!p.type || (p.type !== 'EXAMEN' && p.type !== 'ENTREGA')) {
    errors.push('Event type must be either "EXAMEN" or "ENTREGA"');
  }

  // 2. Subject validation
  if (!p.subject || typeof p.subject !== 'string' || p.subject.trim().length === 0) {
    errors.push('Subject is required and cannot be empty');
  } else if (p.subject.length > 150) {
    errors.push('Subject cannot exceed 150 characters');
  }

  // 3. Title validation
  if (!p.title || typeof p.title !== 'string' || p.title.trim().length === 0) {
    errors.push('Title is required and cannot be empty');
  } else if (p.title.length > 200) {
    errors.push('Title cannot exceed 200 characters');
  }

  // 4. Date validation
  if (!p.date || typeof p.date !== 'string' || !isValidDate(p.date)) {
    errors.push('Date is required and must follow valid YYYY-MM-DD format');
  }

  // 5. Time validation
  const startTime = p.startTime || p.time;
  if (startTime && !isValidTime(startTime)) {
    errors.push('Start time must follow valid HH:MM 24-hour format');
  }

  if (p.endTime && !isValidTime(p.endTime)) {
    errors.push('End time must follow valid HH:MM 24-hour format');
  }

  // 6. Description validation
  if (p.description !== undefined && typeof p.description !== 'string') {
    errors.push('Description must be a string if provided');
  } else if (p.description && p.description.length > 5000) {
    errors.push('Description cannot exceed 5000 characters');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Assertive type guard that throws if the payload is invalid.
 */
export function assertValidAcademicPayload(payload: unknown): asserts payload is AcademicEventPayload {
  const result = validateAcademicEventPayload(payload);
  if (!result.valid) {
    throw new Error(`Invalid AcademicEventPayload: ${result.errors.join('; ')}`);
  }
}

/**
 * Validates Google Calendar eventId parameter for deletion.
 */
export function isValidEventId(eventId: unknown): eventId is string {
  if (typeof eventId !== 'string') return false;
  const trimmed = eventId.trim();
  // Google Calendar event IDs are alphanumeric / base64 encoded strings (which may contain +, /, =, _, -, or single space for compound IDs)
  return trimmed.length >= 4 && trimmed.length <= 512 && /^[a-zA-Z0-9_=+\/-]+( [a-zA-Z0-9_=+\/-]+)?$/.test(trimmed);
}
