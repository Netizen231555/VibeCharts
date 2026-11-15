// Reading and validating one field value, shared by the description and the application of settings.
import { InteractionError } from '../../interaction/errors.js';
import { isPlainColor } from '../../drawings/color.js';

export function getPath(drawing, path) {
  let value = drawing;
  for (const key of path) {
    if (value === null || typeof value !== 'object') return undefined;
    value = value[key];
  }
  return value;
}

/** The current value of `field` in `drawing`; a value the field cannot read is an error, never a silent omission. */
export function readField(field, drawing) {
  const value = field.path ? getPath(drawing, field.path) : field.read(drawing);
  if (value === undefined) {
    throw new InteractionError(`Setting ${field.id} cannot be read from drawing ${drawing.id}`, {
      code: 'DRAWING_SETTING_UNREADABLE', field: field.id, detail: { drawingId: drawing.id },
    });
  }
  return value;
}

export function invalid(field, message) {
  return new InteractionError(`Invalid value for ${field.id}: ${message}`, { code: 'INVALID_DRAWING_SETTING', field: field.id });
}

/** Shape and range only: the store stays the authority on the document. Returns the normalized value. */
export function validateValue(field, value, context = {}) {
  const limits = field.limits ?? {};
  switch (field.type) {
    case 'color':
      if (!isPlainColor(value)) throw invalid(field, 'must be a plain CSS colour');
      break;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid(field, 'must be a finite number');
      if (value < limits.min || value > limits.max) throw invalid(field, `must be from ${limits.min} to ${limits.max}`);
      if (limits.integer && !Number.isInteger(value)) throw invalid(field, 'must be an integer');
      break;
    case 'boolean':
      if (typeof value !== 'boolean') throw invalid(field, 'must be true or false');
      break;
    case 'select':
      if (!limits.options.some((option) => option.value === value)) {
        throw invalid(field, `must be one of ${limits.options.map((option) => option.value).join(', ')}`);
      }
      break;
    case 'text':
      if (typeof value !== 'string') throw invalid(field, 'must be a string');
      if (value.length > (limits.maxLength ?? 200)) throw invalid(field, `must have at most ${limits.maxLength ?? 200} characters`);
      break;
    default:
      break;
  }
  if (field.validate) {
    try {
      return field.validate(value, context) ?? value;
    } catch (error) {
      if (error instanceof InteractionError) throw error;
      throw invalid(field, error.message);
    }
  }
  return value;
}

export const clone = (value) => (value === undefined ? value : structuredClone(value));

export function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
