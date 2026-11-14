import { ChartError } from '../errors.js';

/**
 * Stable machine-readable codes for alert operations. Kept local to the alert
 * package so the core error catalogue is not widened by an extension module.
 */
export const ALERT_ERROR_CODES = Object.freeze({
  INVALID_DEFINITION: 'INVALID_DEFINITION',
  INVALID_OBSERVATION: 'INVALID_OBSERVATION',
  INVALID_DOCUMENT: 'INVALID_DOCUMENT',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  ALERT_EXISTS: 'ALERT_EXISTS',
  ALERT_NOT_FOUND: 'ALERT_NOT_FOUND',
  REVISION_CONFLICT: 'REVISION_CONFLICT',
  INVALID_STATE: 'INVALID_STATE',
  INVALID_ADAPTER: 'INVALID_ADAPTER',
  BACKEND_UNAVAILABLE: 'BACKEND_UNAVAILABLE',
  BACKEND_REJECTED: 'BACKEND_REJECTED',
  INVALID_GEOMETRY: 'INVALID_GEOMETRY',
  NON_FINITE_RESULT: 'NON_FINITE_RESULT',
  VERSION_CONFLICT: 'VERSION_CONFLICT'
});

/**
 * Alert error with per-field diagnostics. `fields` is a frozen list of
 * `{ path, message }` entries so callers can attach the problem to a form
 * control without parsing prose.
 */
export class AlertError extends ChartError {
  /**
   * @param {string} code stable machine-readable code
   * @param {string} message actionable description without caller-provided values
   * @param {Array<{path: string, message: string}>} [fields]
   * @param {object} [details]
   */
  constructor(code, message, fields = [], details = {}) {
    super(code, message, details);
    this.name = 'AlertError';
    this.fields = Object.freeze(fields.map(entry => Object.freeze({ path: entry.path, message: entry.message })));
  }
}

/**
 * @param {string} code
 * @param {string} operation
 * @param {string} message
 * @param {Array<{path: string, message: string}>} [fields]
 * @param {object} [details]
 * @returns {never}
 */
export function failAlert(code, operation, message, fields = [], details = {}) {
  throw new AlertError(code, `${operation}: ${message}`, fields, { operation, ...details });
}

/** @param {string} path @param {string} message */
export const fieldError = (path, message) => ({ path, message });

/** Strip secrets from adapter/clock error text; only a short message is kept. */
export function errorText(error) {
  if (error === undefined || error === null) return null;
  const message = typeof error === 'string' ? error : error instanceof Error ? error.message : String(error?.message ?? '');
  const trimmed = message.trim();
  return trimmed ? trimmed.slice(0, 300) : null;
}
