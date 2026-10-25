import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateAcademicEventPayload,
  assertValidAcademicPayload,
  isValidDate,
  isValidTime,
  isValidEventId
} from '../shared/validators';
import { AcademicEventPayload } from '../shared/types';
import { escapeHtml } from '../injected/utils/dom';

describe('7. Runtime Contract & Payload Validators', () => {
  test('isValidDate correctly validates valid calendar dates', () => {
    assert.equal(isValidDate('2026-11-20'), true);
    assert.equal(isValidDate('2026-02-28'), true);
    assert.equal(isValidDate('2026-02-29'), false); // 2026 is not a leap year
    assert.equal(isValidDate('2026-13-01'), false); // month 13
    assert.equal(isValidDate('not-a-date'), false);
    assert.equal(isValidDate('2026/11/20'), false);
  });

  test('isValidTime correctly validates 24h format', () => {
    assert.equal(isValidTime('09:00'), true);
    assert.equal(isValidTime('23:59'), true);
    assert.equal(isValidTime('00:00'), true);
    assert.equal(isValidTime('24:00'), false);
    assert.equal(isValidTime('12:60'), false);
    assert.equal(isValidTime('9:00'), false); // must be 2 digits
  });

  test('validateAcademicEventPayload accepts well-formed EXAMEN payload', () => {
    const payload: AcademicEventPayload = {
      type: 'EXAMEN',
      subject: 'Programación 1',
      title: 'Examen Final',
      date: '2026-12-15',
      startTime: '10:00',
      endTime: '12:00',
      description: 'Temario completo'
    };

    const result = validateAcademicEventPayload(payload);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.doesNotThrow(() => assertValidAcademicPayload(payload));
  });

  test('validateAcademicEventPayload accepts well-formed ENTREGA payload', () => {
    const payload: AcademicEventPayload = {
      type: 'ENTREGA',
      subject: 'Bases de Datos',
      title: 'Entrega Proyecto Final',
      date: '2026-11-30',
      time: '23:59'
    };

    const result = validateAcademicEventPayload(payload);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  });

  test('validateAcademicEventPayload rejects null or non-object', () => {
    assert.equal(validateAcademicEventPayload(null).valid, false);
    assert.equal(validateAcademicEventPayload(undefined).valid, false);
    assert.equal(validateAcademicEventPayload('string').valid, false);
    assert.throws(() => assertValidAcademicPayload(null), /Invalid AcademicEventPayload/);
  });

  test('validateAcademicEventPayload rejects invalid type', () => {
    const invalid: any = {
      type: 'RECORDATORIO',
      subject: 'Clase 1',
      title: 'Test',
      date: '2026-11-20'
    };
    const result = validateAcademicEventPayload(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('type')));
  });

  test('validateAcademicEventPayload rejects empty subject or title', () => {
    const invalid: any = {
      type: 'EXAMEN',
      subject: '   ',
      title: '',
      date: '2026-11-20'
    };
    const result = validateAcademicEventPayload(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Subject')));
    assert.ok(result.errors.some((e) => e.includes('Title')));
  });

  test('validateAcademicEventPayload rejects invalid date format', () => {
    const invalid: any = {
      type: 'EXAMEN',
      subject: 'Física',
      title: 'Parcial',
      date: '2026-31-02' // invalid date
    };
    const result = validateAcademicEventPayload(invalid);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes('Date')));
  });

  test('isValidEventId correctly identifies valid and invalid event IDs', () => {
    assert.equal(isValidEventId('_60q30c1g60o30c1g60o30b9k60_20261120T090000Z'), true);
    assert.equal(isValidEventId('abc12345'), true);
    assert.equal(isValidEventId('NzEzZjlmZDhpNm0ydWRxMDRkaDgxZ3V0dmY='), true);
    assert.equal(isValidEventId('NG05YmpwNWdicnY5cnQ2M2w1Nzgza2IyYzMgNjNlNzM1OGJhNmNhOWExOTcxMGMyOGU5YWM5OWYwMWQ2YjE2ZTQyODMxNWY1Y2Q4MjY5YmVlYWUwYmNmY2E1MUBn'.split(' ')[0]), true);
    assert.equal(isValidEventId('a+b/c=='), true);
    assert.equal(isValidEventId(''), false);
    assert.equal(isValidEventId('a'), false); // too short
    assert.equal(isValidEventId('id with spaces'), false);
    assert.equal(isValidEventId('<script>alert(1)</script>'), false);
    assert.equal(isValidEventId(null), false);
  });

  test('escapeHtml safely sanitizes HTML special characters to prevent XSS', () => {
    assert.equal(escapeHtml('<script>alert("xss")</script>'), '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    assert.equal(escapeHtml("Tom & Jerry's <Party>"), 'Tom &amp; Jerry&#039;s &lt;Party&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(undefined), '');
    assert.equal(escapeHtml('Matemáticas 1'), 'Matemáticas 1');
  });
});
