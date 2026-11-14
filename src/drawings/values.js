export class DrawingError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DrawingError';
    this.code = code;
    Object.assign(this, details);
  }
}

export function fail(code, message, details) {
  throw new DrawingError(code, message, details);
}

export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const isNumber = value => typeof value === 'number' && Number.isFinite(value);

export function requireString(value, field, { nonEmpty = true, max = 512 } = {}) {
  if (typeof value !== 'string') fail('invalid-field', `${field} must be a string`, { field });
  if (nonEmpty && value.trim() === '') fail('invalid-field', `${field} must not be empty`, { field });
  if (value.length > max) fail('invalid-field', `${field} is too long`, { field, max });
  return value;
}

export function requireBoolean(value, field) {
  if (typeof value !== 'boolean') fail('invalid-field', `${field} must be a boolean`, { field });
  return value;
}

export function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

export function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (isObject(value)) {
    const result = {};
    for (const key of Object.keys(value)) result[key] = clone(value[key]);
    return result;
  }
  return value;
}

export function equal(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => equal(item, b[index]));
  }
  if (isObject(a) && isObject(b)) {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal(a[key], b[key]));
  }
  return false;
}
