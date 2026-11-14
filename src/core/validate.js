import { fail } from '../errors.js';

/** Largest absolute value representable by an ECMAScript Date (ms). */
export const MAX_TIME = 8.64e15;

const IDENTITY_FIELDS = ['instrumentId', 'interval', 'sourceId'];

const METADATA_FIELDS = new Set([
  'instrumentId',
  'interval',
  'sourceId',
  'board',
  'market',
  'instrumentType',
  'currency',
  'priceUnit',
  'volumeUnit',
  'priceStep',
  'observedAt',
  'delayMs',
  'calendar',
  'timeZone'
]);

export function isPlainObject(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

export function assertPlainObject(value, operation, field) {
  if (!isPlainObject(value)) {
    fail('INVALID_TYPE', operation, `"${field}" must be a plain object`, { field });
  }
  return value;
}

export function assertArray(value, operation, field) {
  if (!Array.isArray(value)) {
    fail('INVALID_TYPE', operation, `"${field}" must be an array`, { field });
  }
  return value;
}

export function assertKnownKeys(value, allowed, operation, field) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('UNKNOWN_FIELD', operation, `unknown field "${key}" in "${field}"`, { field: key });
    }
  }
}

export function assertString(value, operation, field, { nonEmpty = false } = {}) {
  if (typeof value !== 'string') {
    fail('INVALID_TYPE', operation, `"${field}" must be a string`, { field });
  }
  if (nonEmpty && value.length === 0) {
    fail('INVALID_ARGUMENT', operation, `"${field}" must not be empty`, { field });
  }
  return value;
}

export function assertBoolean(value, operation, field) {
  if (typeof value !== 'boolean') {
    fail('INVALID_TYPE', operation, `"${field}" must be a boolean`, { field });
  }
  return value;
}

export function assertFiniteNumber(value, operation, field, index) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('INVALID_NUMBER', operation, `"${field}" must be a finite number`, { field, index });
  }
  return value;
}

export function assertPositiveNumber(value, operation, field, index) {
  assertFiniteNumber(value, operation, field, index);
  if (value <= 0) {
    fail('INVALID_NUMBER', operation, `"${field}" must be greater than zero`, { field, index });
  }
  return value;
}

export function assertNonNegativeNumber(value, operation, field, index) {
  assertFiniteNumber(value, operation, field, index);
  if (value < 0) {
    fail('INVALID_NUMBER', operation, `"${field}" must not be negative`, { field, index });
  }
  return value;
}

export function assertSafeInteger(value, operation, field, index) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    fail('INVALID_NUMBER', operation, `"${field}" must be a safe integer`, { field, index });
  }
  return value;
}

export function assertPositiveInteger(value, operation, field, index) {
  assertSafeInteger(value, operation, field, index);
  if (value < 1) {
    fail('INVALID_NUMBER', operation, `"${field}" must be a positive integer`, { field, index });
  }
  return value;
}

export function validateTime(value, operation, field = 'time', index) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || Math.abs(value) > MAX_TIME) {
    fail(
      'INVALID_TIME',
      operation,
      `"${field}" must be a safe integer of Unix milliseconds within the ECMAScript Date range`,
      { field, index }
    );
  }
  return value;
}

export function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
export function timeFromUnixSeconds(seconds) {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) {
    fail('INVALID_TIME', 'timeFromUnixSeconds', 'seconds must be a finite number', { field: 'seconds' });
  }
  return validateTime(seconds * 1000, 'timeFromUnixSeconds', 'seconds');
}

export function timeFromOffsetString(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) fail('INVALID_TIME', 'timeFromOffsetString', 'time must be an ISO date-time with an explicit UTC offset and millisecond precision', { field: 'time' });
  const [, y, m, d, h, minute, second, , zone] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const offsetHour = zone === 'Z' ? 0 : Number(zone.slice(1, 3));
  const offsetMinute = zone === 'Z' ? 0 : Number(zone.slice(4, 6));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
      Number(h) > 23 || Number(minute) > 59 || Number(second) > 59 || offsetHour > 23 || offsetMinute > 59 || zone === '-00:00') {
    fail('INVALID_TIME', 'timeFromOffsetString', 'time contains an invalid date, time or UTC offset', { field: 'time' });
  }
  return validateTime(Date.parse(value), 'timeFromOffsetString');
}

export function validateSessionDate(value, operation, field = 'sessionDate', index) {
  assertPlainObject(value, operation, field);
  assertKnownKeys(value, new Set(['year', 'month', 'day']), operation, field);
  const { year, month, day } = value;
  if (!Number.isInteger(year) || year < 1 || year > 9999) {
    fail('INVALID_SESSION_DATE', operation, `"${field}.year" must be an integer from 1 to 9999`, {
      field: `${field}.year`,
      index
    });
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    fail('INVALID_SESSION_DATE', operation, `"${field}.month" must be an integer from 1 to 12`, {
      field: `${field}.month`,
      index
    });
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    fail('INVALID_SESSION_DATE', operation, `"${field}.day" is not a valid Gregorian day`, {
      field: `${field}.day`,
      index
    });
  }
  return Object.freeze({ year, month, day });
}

/** Normalizes a timeline slot and drops unknown fields. */
export function normalizeSlot(value, operation, index) {
  assertPlainObject(value, operation, `slots[${index}]`);
  const barId = assertString(value.barId, operation, 'barId', { nonEmpty: true });
  const slot = { barId };
  if (value.time !== undefined) slot.time = validateTime(value.time, operation, 'time', index);
  if (value.sessionDate !== undefined) {
    slot.sessionDate = validateSessionDate(value.sessionDate, operation, 'sessionDate', index);
  }
  return Object.freeze(slot);
}

export function normalizeSlots(value, operation) {
  assertArray(value, operation, 'slots');
  const out = [];
  const seen = new Set();
  for (let i = 0; i < value.length; i += 1) {
    const slot = normalizeSlot(value[i], operation, i);
    if (seen.has(slot.barId)) {
      fail('DUPLICATE_BAR_ID', operation, `duplicate "barId" in slot batch at index ${i}`, {
        field: 'barId',
        index: i
      });
    }
    seen.add(slot.barId);
    out.push(slot);
  }
  return out;
}

function normalizeVolume(value, operation, index, field = 'volume') {
  if (value === null) return null;
  if (value === undefined) return undefined;
  assertFiniteNumber(value, operation, field, index);
  if (value < 0) {
    fail('INVALID_VOLUME', operation, `"${field}" must not be negative`, { field, index });
  }
  return value;
}

export function normalizeOhlcPoint(value, operation, index) {
  assertPlainObject(value, operation, `data[${index}]`);
  const barId = assertString(value.barId, operation, 'barId', { nonEmpty: true });
  const open = assertFiniteNumber(value.open, operation, 'open', index);
  const high = assertFiniteNumber(value.high, operation, 'high', index);
  const low = assertFiniteNumber(value.low, operation, 'low', index);
  const close = assertFiniteNumber(value.close, operation, 'close', index);
  if (!(low <= open && open <= high)) {
    fail('INVALID_OHLC', operation, 'OHLC relation "low <= open <= high" is violated', {
      field: 'open',
      index
    });
  }
  if (!(low <= close && close <= high)) {
    fail('INVALID_OHLC', operation, 'OHLC relation "low <= close <= high" is violated', {
      field: 'close',
      index
    });
  }
  const volume = normalizeVolume(value.volume, operation, index);
  const buyVolume = normalizeVolume(value.buyVolume, operation, index, 'buyVolume');
  const sellVolume = normalizeVolume(value.sellVolume, operation, index, 'sellVolume');
  const point = { barId, open, high, low, close };
  if (volume !== undefined) point.volume = volume;
  if (buyVolume !== undefined) point.buyVolume = buyVolume;
  if (sellVolume !== undefined) point.sellVolume = sellVolume;
  return Object.freeze(point);
}

export function normalizeNumericPoint(value, operation, index) {
  assertPlainObject(value, operation, `data[${index}]`);
  const barId = assertString(value.barId, operation, 'barId', { nonEmpty: true });
  const numeric = assertFiniteNumber(value.value, operation, 'value', index);
  return Object.freeze({ barId, value: numeric });
}

export function normalizePoint(type, value, operation, index) {
  return type === 'line' || type === 'histogram' || type === 'area' || type === 'baseline'
    ? normalizeNumericPoint(value, operation, index)
    : normalizeOhlcPoint(value, operation, index);
}

export function isOhlcType(type) {
  return type === 'candlestick' || type === 'bar';
}

const TIME_ZONE_OK = (() => {
  try {
    return typeof Intl === 'object' && typeof Intl.DateTimeFormat === 'function';
  } catch {
    return false;
  }
})();

export function validateTimeZone(value, operation, field = 'timeZone') {
  assertString(value, operation, field, { nonEmpty: true });
  if (!TIME_ZONE_OK) {
    fail('INVALID_ARGUMENT', operation, 'IANA time zones are not available in this runtime', {
      field
    });
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
  } catch {
    fail('INVALID_ARGUMENT', operation, `"${field}" must be a valid IANA time zone`, { field });
  }
  return value;
}

/** Validates series metadata. Identity is all-or-nothing. */
export function normalizeMetadata(value, operation, { requiredIdentity = true } = {}) {
  assertPlainObject(value, operation, 'metadata');
  assertKnownKeys(value, METADATA_FIELDS, operation, 'metadata');
  for (const key of IDENTITY_FIELDS) {
    if (value[key] === undefined) {
      fail('INVALID_ARGUMENT', operation, `"metadata.${key}" is required`, {
        field: `metadata.${key}`
      });
    }
    assertString(value[key], operation, `metadata.${key}`, { nonEmpty: true });
  }
  if (!requiredIdentity) {
    // Kept for symmetry: partial identities are never accepted.
  }
  const out = {
    instrumentId: value.instrumentId,
    interval: value.interval,
    sourceId: value.sourceId
  };
  for (const key of ['board', 'market', 'instrumentType', 'currency', 'priceUnit', 'volumeUnit']) {
    if (value[key] !== undefined) out[key] = assertString(value[key], operation, `metadata.${key}`, { nonEmpty: true });
  }
  if (value.priceStep !== undefined) {
    out.priceStep = assertPositiveNumber(value.priceStep, operation, 'metadata.priceStep');
  }
  if (value.observedAt !== undefined) {
    out.observedAt = validateTime(value.observedAt, operation, 'metadata.observedAt');
  }
  if (value.delayMs !== undefined) {
    out.delayMs = assertNonNegativeNumber(value.delayMs, operation, 'metadata.delayMs');
  }
  if (value.timeZone !== undefined) {
    out.timeZone = validateTimeZone(value.timeZone, operation, 'metadata.timeZone');
  }
  if (value.calendar !== undefined) {
    assertPlainObject(value.calendar, operation, 'metadata.calendar');
    assertKnownKeys(value.calendar, new Set(['timeZone']), operation, 'metadata.calendar');
    if (value.calendar.timeZone === undefined) {
      fail('INVALID_ARGUMENT', operation, '"metadata.calendar.timeZone" is required', {
        field: 'metadata.calendar.timeZone'
      });
    }
    out.calendar = Object.freeze({
      timeZone: validateTimeZone(value.calendar.timeZone, operation, 'metadata.calendar.timeZone')
    });
  }
  return Object.freeze(out);
}

export function sameIdentity(a, b) {
  if (!a || !b) return false;
  return a.instrumentId === b.instrumentId && a.interval === b.interval && a.sourceId === b.sourceId;
}

/** Two series may share a price scale only when their declared units match. */
export function scalesCompatible(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (!sameIdentity(a, b)) return false;
  return a.currency === b.currency && a.priceUnit === b.priceUnit;
}
