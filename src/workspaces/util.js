import { fail } from './errors.js';

export const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function requireObject(value, field, code = 'invalid-argument') {
  if (!isPlainObject(value)) fail(code, `${field} must be an object`, { field });
  return value;
}

export function requireString(value, field, code = 'invalid-argument', allowEmpty = false) {
  if (typeof value !== 'string') fail(code, `${field} must be a string`, { field });
  if (!allowEmpty && value.length === 0) fail(code, `${field} must not be empty`, { field });
  return value;
}

export function requireFinite(value, field, code = 'invalid-argument') {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(code, `${field} must be a finite number`, { field });
  }
  return value;
}

export function requireInteger(value, field, { min = -Infinity, max = Infinity, code = 'invalid-argument' } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail(code, `${field} must be an integer between ${min} and ${max}`, { field });
  }
  return value;
}

export function requireBoolean(value, field, code = 'invalid-argument') {
  if (typeof value !== 'boolean') fail(code, `${field} must be a boolean`, { field });
  return value;
}

export function requireArray(value, field, code = 'invalid-argument') {
  if (!Array.isArray(value)) fail(code, `${field} must be an array`, { field });
  return value;
}

/**
 * Validates that a value can be represented by JSON and returns a detached copy.
 * Runtime objects (functions, DOM nodes, class instances, Map, Date, cycles) are errors,
 * because workspace snapshots must never contain them.
 */
export function toJsonClone(value, field = 'value', { code = 'invalid-state' } = {}, stack = new Set()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) fail(code, `${field} must be a finite number`, { field });
    return value;
  }
  if (type === 'undefined') fail(code, `${field} must not be undefined`, { field });
  if (type !== 'object') fail(code, `${field} must be JSON-serializable`, { field });
  if (stack.has(value)) fail(code, `${field} must not contain a cycle`, { field });
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) => toJsonClone(entry, `${field}[${index}]`, { code }, stack));
    }
    if (!isPlainObject(value)) {
      fail(code, `${field} must be a plain JSON object, not ${value.constructor?.name ?? 'an exotic object'}`, { field });
    }
    const output = {};
    for (const key of Object.keys(value)) {
      output[key] = toJsonClone(value[key], `${field}.${key}`, { code }, stack);
    }
    return output;
  } finally {
    stack.delete(value);
  }
}

export function uniqueBy(items, field, key = 'id', code = 'invalid-state') {
  const seen = new Set();
  items.forEach((item, index) => {
    const value = item?.[key];
    if (typeof value !== 'string' || value.length === 0) {
      fail(code, `${field}[${index}].${key} must be a non-empty string`, { field: `${field}[${index}].${key}` });
    }
    if (seen.has(value)) fail(code, `${field} contains duplicate ${key} "${value}"`, { field: `${field}[${index}].${key}` });
    seen.add(value);
  });
  return seen;
}

export function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
