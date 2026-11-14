/**
 * Public error type. Every rejected chart operation throws a ChartError.
 * Messages identify the operation and the offending field/index and never
 * contain caller-provided values.
 */
export class ChartError extends Error {
  /**
   * @param {string} code stable machine-readable code
   * @param {string} message actionable description
   * @param {{operation?: string, field?: string, index?: number, barId?: string, seriesId?: string, cause?: unknown}} [details]
   */
  constructor(code, message, details = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ChartError';
    this.code = code;
    if (details.operation !== undefined) this.operation = details.operation;
    if (details.field !== undefined) this.field = details.field;
    if (details.index !== undefined) this.index = details.index;
    if (details.barId !== undefined) this.barId = details.barId;
    if (details.seriesId !== undefined) this.seriesId = details.seriesId;
  }
}

/**
 * @param {string} code
 * @param {string} operation
 * @param {string} message
 * @param {object} [details]
 * @returns {never}
 */
export function fail(code, operation, message, details = {}) {
  throw new ChartError(code, `${operation}: ${message}`, { operation, ...details });
}

export const ERROR_CODES = Object.freeze({
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_NUMBER: 'INVALID_NUMBER',
  INVALID_TIME: 'INVALID_TIME',
  INVALID_SESSION_DATE: 'INVALID_SESSION_DATE',
  DUPLICATE_BAR_ID: 'DUPLICATE_BAR_ID',
  UNKNOWN_BAR_ID: 'UNKNOWN_BAR_ID',
  UNKNOWN_SERIES: 'UNKNOWN_SERIES',
  UNKNOWN_PANE: 'UNKNOWN_PANE',
  UNKNOWN_POINT: 'UNKNOWN_POINT',
  UNKNOWN_OPTION: 'UNKNOWN_OPTION',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  OUT_OF_ORDER: 'OUT_OF_ORDER',
  INVALID_OHLC: 'INVALID_OHLC',
  INVALID_VOLUME: 'INVALID_VOLUME',
  INVALID_RANGE: 'INVALID_RANGE',
  INVALID_MODE: 'INVALID_MODE',
  INVALID_BASE: 'INVALID_BASE',
  LOG_RANGE: 'LOG_RANGE',
  INVALID_PARAMETER: 'INVALID_PARAMETER',
  SERIES_OWNERSHIP: 'SERIES_OWNERSHIP',
  PANE_OWNERSHIP: 'PANE_OWNERSHIP',
  LAST_PANE: 'LAST_PANE',
  PANE_NOT_EMPTY: 'PANE_NOT_EMPTY',
  INCOMPATIBLE_SCALE: 'INCOMPATIBLE_SCALE',
  CHART_DESTROYED: 'CHART_DESTROYED',
  INVALID_EVENT: 'INVALID_EVENT',
  INVALID_BATCH: 'INVALID_BATCH',
  STALE_PLAN: 'STALE_PLAN',
  UNRESOLVED_ANCHOR: 'UNRESOLVED_ANCHOR',
  DERIVED_SOURCE: 'DERIVED_SOURCE',
  DERIVED_STATE: 'DERIVED_STATE',
  DOM_UNAVAILABLE: 'DOM_UNAVAILABLE',
  INVALID_CONTAINER: 'INVALID_CONTAINER'
});
