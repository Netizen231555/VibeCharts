/**
 * Error type for the interaction and UI layers.
 *
 * Every rejected operation carries a stable `code` plus the `field` and
 * `action` (or gesture/control) it concerns, so callers can report the
 * failure without guessing. Errors never contain external payloads.
 */
export class InteractionError extends Error {
  constructor(message, { code = 'INTERACTION_ERROR', field = null, action = null, detail = null } = {}) {
    super(message);
    this.name = 'InteractionError';
    this.code = code;
    this.field = field;
    this.action = action;
    this.detail = detail;
  }

  toJSON() {
    return { name: this.name, message: this.message, code: this.code, field: this.field, action: this.action };
  }
}

export function interactionError(message, details) {
  return new InteractionError(message, details);
}

export function isInteractionError(value) {
  return value instanceof InteractionError;
}
