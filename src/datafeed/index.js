/**
 * Index datafeed integration controller.
 *
 * The application owns transport, authentication, storage and the data source.
 * This module only translates an injected `IndexDatafeed` into chart operations
 * and exposes validation/version/reconciliation state. It performs no network
 * access, creates no timers and touches no DOM or storage.
 *
 * Injected chart adapter contract (owned by the chart core):
 *   chart.replaceData({ slots, series: [{ seriesId, points }] })
 *       Atomic full replacement of the timeline and every listed series point
 *       set. Validates the complete next state before mutating anything; on any
 *       error the existing timeline, series data, metadata, scales and view are
 *       unchanged. This is the only operation used to install initial history or
 *       a host snapshot.
 *   chart.applyBatch({ timeline: { op: 'append' | 'prepend', slots }, series: [{ seriesId, points }] })
 *   chart.series(seriesId) -> { setData(points), update(point), prepend(points), correct(point) }
 *   chart.subscribe('destroy', handler) -> unsubscribe
 *   chart.applyObservation?(observation)  // optional display hook, never creates slots
 *
 * `chart.applyBatch` is the atomic operation for a new stream slot plus point and
 * for a page of older history. Existing-slot appends and last-point replaces use
 * `series.update`; historical fixes use `series.correct`.
 */

const MAX_BUFFERED_EVENTS = 1000;
const DEFAULT_PAGE_SIZE = 500;
const BAR_STATES = new Set(['partial', 'closed']);
const FEED_EVENT_TYPES = new Set(['append', 'replace', 'correct', 'snapshot', 'status', 'error', 'gap']);
const OBSERVATION_EVENT_TYPES = new Set(['snapshot', 'observation', 'status', 'error']);
const CONTEXT_FIELDS = ['instrumentId', 'interval', 'sourceId'];

export class DatafeedError extends Error {
  constructor(code, message, { operation = null, field = null, context = null } = {}) {
    super(message);
    this.name = 'DatafeedError';
    this.code = code;
    this.operation = operation;
    this.field = field;
    this.context = context;
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(code, message, details = {}) {
  throw new DatafeedError(code, message, details);
}

function cloneContext(context) {
  return context ? { ...context } : null;
}

function contextLabel(context) {
  if (!context) return null;
  return `${context.instrumentId}/${context.interval}/${context.sourceId}`;
}

function assertNonEmptyString(value, operation, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail('validation', `${operation}: ${field} must be a non-empty string`, { operation, field });
  }
  return value;
}

function assertFiniteNumber(value, operation, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('validation', `${operation}: ${field} must be a finite number`, { operation, field });
  }
  return value;
}

function assertVersionString(value, operation, field) {
  return assertNonEmptyString(value, operation, field);
}

function validateContext(context, operation) {
  if (!isRecord(context)) {
    fail('invalid-context', `${operation}: context must be an object`, { operation, field: 'context' });
  }
  const normalized = {};
  for (const key of CONTEXT_FIELDS) {
    normalized[key] = assertNonEmptyString(context[key], operation, `context.${key}`);
  }
  return normalized;
}

function assertSameContext(actual, expected, operation, field) {
  for (const key of CONTEXT_FIELDS) {
    if (actual[key] !== expected[key]) {
      fail(
        'context-mismatch',
        `${operation}: response context does not match the requested context (field: context.${key})`,
        { operation, field: `${field}.${key}`, context: contextLabel(expected) },
      );
    }
  }
}

function validateSessionDate(value, operation, field) {
  if (!isRecord(value)) {
    fail('validation', `${operation}: ${field} must be an object`, { operation, field });
  }
  for (const key of ['year', 'month', 'day']) {
    if (!Number.isSafeInteger(value[key])) {
      fail('validation', `${operation}: ${field}.${key} must be a safe integer`, {
        operation,
        field: `${field}.${key}`,
      });
    }
  }
  if (value.year < 1000 || value.year > 9999 || value.month < 1 || value.month > 12 || value.day < 1 || value.day > 31) {
    fail('validation', `${operation}: ${field} is outside the supported calendar range`, {
      operation,
      field,
    });
  }
  const date = new Date(Date.UTC(value.year, value.month - 1, value.day));
  if (
    date.getUTCFullYear() !== value.year ||
    date.getUTCMonth() !== value.month - 1 ||
    date.getUTCDate() !== value.day
  ) {
    fail('validation', `${operation}: ${field} is not a valid calendar date`, { operation, field });
  }
  return { year: value.year, month: value.month, day: value.day };
}

function validateSlot(slot, operation, field) {
  if (!isRecord(slot)) {
    fail('validation', `${operation}: ${field} must be an object`, { operation, field });
  }
  const normalized = { barId: assertNonEmptyString(slot.barId, operation, `${field}.barId`) };
  if (slot.time !== undefined) {
    if (!Number.isSafeInteger(slot.time) || Math.abs(slot.time) > 8640000000000000) {
      fail('validation', `${operation}: ${field}.time must be Unix milliseconds within the Date range`, {
        operation,
        field: `${field}.time`,
      });
    }
    normalized.time = slot.time;
  }
  if (slot.sessionDate !== undefined) {
    normalized.sessionDate = validateSessionDate(slot.sessionDate, operation, `${field}.sessionDate`);
  }
  return normalized;
}

function validatePoint(point, operation, field) {
  if (!isRecord(point)) {
    fail('validation', `${operation}: ${field} must be an object`, { operation, field });
  }
  if (point.kind !== 'ohlcv' && point.kind !== 'numeric') {
    fail('validation', `${operation}: ${field}.kind must be 'ohlcv' or 'numeric'`, {
      operation,
      field: `${field}.kind`,
    });
  }
  const barId = assertNonEmptyString(point.barId, operation, `${field}.barId`);

  if (point.kind === 'numeric') {
    return { kind: 'numeric', barId, value: assertFiniteNumber(point.value, operation, `${field}.value`) };
  }

  const open = assertFiniteNumber(point.open, operation, `${field}.open`);
  const high = assertFiniteNumber(point.high, operation, `${field}.high`);
  const low = assertFiniteNumber(point.low, operation, `${field}.low`);
  const close = assertFiniteNumber(point.close, operation, `${field}.close`);
  if (high < low || high < open || high < close || low > open || low > close) {
    fail('validation', `${operation}: ${field} has an inconsistent OHLC range`, {
      operation,
      field,
    });
  }
  const normalized = { kind: 'ohlcv', barId, open, high, low, close };
  for (const name of ['volume', 'buyVolume', 'sellVolume']) {
    if (point[name] === undefined) continue;
    const amount = assertFiniteNumber(point[name], operation, `${field}.${name}`);
    if (amount < 0) {
      fail('validation', `${operation}: ${field}.${name} must not be negative`, {
        operation,
        field: `${field}.${name}`,
      });
    }
    normalized[name] = amount;
  }
  return normalized;
}

function validateObservation(observation, operation, field) {
  if (!isRecord(observation)) {
    fail('validation', `${operation}: ${field} must be an object`, { operation, field });
  }
  const normalized = {
    sourceId: assertNonEmptyString(observation.sourceId, operation, `${field}.sourceId`),
    value: assertFiniteNumber(observation.value, operation, `${field}.value`),
  };
  if (observation.barId !== undefined) {
    normalized.barId = assertNonEmptyString(observation.barId, operation, `${field}.barId`);
  }
  if (observation.time !== undefined) {
    if (!Number.isSafeInteger(observation.time) || Math.abs(observation.time) > 8640000000000000) {
      fail('validation', `${operation}: ${field}.time must be Unix milliseconds within the Date range`, {
        operation,
        field: `${field}.time`,
      });
    }
    normalized.time = observation.time;
  }
  if (!BAR_STATES.has(observation.state)) {
    fail('validation', `${operation}: ${field}.state must be 'partial' or 'closed'`, {
      operation,
      field: `${field}.state`,
    });
  }
  normalized.state = observation.state;
  Object.assign(normalized, validateVersionPair(observation, operation, field));
  return normalized;
}

function validateVersionPair(source, operation, fieldPrefix) {
  const hasVersion = source.version !== undefined;
  const hasPrevious = source.prevVersion !== undefined;
  if (hasVersion !== hasPrevious) {
    fail(
      'validation',
      `${operation}: ${fieldPrefix}version and prevVersion must be supplied together`,
      { operation, field: `${fieldPrefix}prevVersion` },
    );
  }
  if (!hasVersion) return {};
  return {
    version: assertVersionString(source.version, operation, `${fieldPrefix}version`),
    prevVersion: assertVersionString(source.prevVersion, operation, `${fieldPrefix}prevVersion`),
  };
}

function validateBarState(value, operation, field) {
  if (!BAR_STATES.has(value)) {
    fail('validation', `${operation}: ${field} must be 'partial' or 'closed'`, { operation, field });
  }
  return value;
}

/**
 * Validates the host datafeed shape. A declared capability without its method is
 * a configuration error; an undeclared method is never required and never called
 * by the controller.
 */
export function validateDatafeed(feed) {
  const operation = 'validateDatafeed';
  if (!isRecord(feed)) {
    fail('configuration', 'validateDatafeed: feed must be an object', { operation, field: 'feed' });
  }
  if (!isRecord(feed.capabilities)) {
    fail('configuration', 'validateDatafeed: capabilities must be an object', {
      operation,
      field: 'capabilities',
    });
  }
  const capabilities = {};
  for (const key of ['history', 'stream', 'observations']) {
    if (typeof feed.capabilities[key] !== 'boolean') {
      fail('configuration', `validateDatafeed: capabilities.${key} must be a boolean`, {
        operation,
        field: `capabilities.${key}`,
      });
    }
    capabilities[key] = feed.capabilities[key];
  }

  let intervals = null;
  if (feed.capabilities.intervals !== undefined) {
    if (!Array.isArray(feed.capabilities.intervals)) {
      fail('configuration', 'validateDatafeed: capabilities.intervals must be an array', {
        operation,
        field: 'capabilities.intervals',
      });
    }
    const seen = new Set();
    intervals = feed.capabilities.intervals.map((interval, index) => {
      const value = assertNonEmptyString(interval, operation, `capabilities.intervals[${index}]`);
      if (seen.has(value)) {
        fail('configuration', `validateDatafeed: capabilities.intervals[${index}] is duplicated`, {
          operation,
          field: `capabilities.intervals[${index}]`,
        });
      }
      seen.add(value);
      return value;
    });
  }

  const methods = { history: 'loadHistory', stream: 'subscribe', observations: 'observe' };
  for (const [capability, method] of Object.entries(methods)) {
    if (capabilities[capability] && typeof feed[method] !== 'function') {
      fail(
        'configuration',
        `validateDatafeed: capabilities.${capability} is declared but feed.${method} is not a function`,
        { operation, field: `capabilities.${capability}` },
      );
    }
  }
  if (feed.requestSnapshot !== undefined && typeof feed.requestSnapshot !== 'function') {
    fail('configuration', 'validateDatafeed: requestSnapshot must be a function when present', {
      operation,
      field: 'requestSnapshot',
    });
  }

  return Object.freeze({
    capabilities: Object.freeze({ ...capabilities, intervals: intervals ? [...intervals] : null }),
    reliable: capabilities.stream && typeof feed.requestSnapshot === 'function',
  });
}

function validateHistoryPayload(result, expectedContext, operation) {
  if (!isRecord(result)) {
    fail('validation', `${operation}: history must be an object`, { operation, field: 'history' });
  }
  const context = validateContext(result.context, `${operation}.context`);
  assertSameContext(context, expectedContext, operation, 'context');

  if (!Array.isArray(result.slots)) {
    fail('validation', `${operation}: slots must be an array`, { operation, field: 'slots' });
  }
  const slotIds = new Set();
  const slots = result.slots.map((slot, index) => {
    const normalized = validateSlot(slot, operation, `slots[${index}]`);
    if (slotIds.has(normalized.barId)) {
      fail('validation', `${operation}: duplicate slot barId at slots[${index}]`, {
        operation,
        field: `slots[${index}].barId`,
      });
    }
    slotIds.add(normalized.barId);
    return normalized;
  });
  const slotIndex = new Map(slots.map((slot, index) => [slot.barId, index]));

  if (!Array.isArray(result.series)) {
    fail('validation', `${operation}: series must be an array`, { operation, field: 'series' });
  }
  const seriesIds = new Set();
  const series = result.series.map((entry, seriesIndex) => {
    if (!isRecord(entry)) {
      fail('validation', `${operation}: series[${seriesIndex}] must be an object`, {
        operation,
        field: `series[${seriesIndex}]`,
      });
    }
    const seriesId = assertNonEmptyString(entry.seriesId, operation, `series[${seriesIndex}].seriesId`);
    if (seriesIds.has(seriesId)) {
      fail('validation', `${operation}: duplicate seriesId at series[${seriesIndex}]`, {
        operation,
        field: `series[${seriesIndex}].seriesId`,
      });
    }
    seriesIds.add(seriesId);
    if (!Array.isArray(entry.points)) {
      fail('validation', `${operation}: series[${seriesIndex}].points must be an array`, {
        operation,
        field: `series[${seriesIndex}].points`,
      });
    }
    const pointIds = new Set();
    let previousIndex = -1;
    const points = entry.points.map((point, pointIndex) => {
      const field = `series[${seriesIndex}].points[${pointIndex}]`;
      const normalized = validatePoint(point, operation, field);
      const index = slotIndex.get(normalized.barId);
      if (index === undefined) {
        fail('validation', `${operation}: ${field} references an unknown slot`, {
          operation,
          field: `${field}.barId`,
        });
      }
      if (pointIds.has(normalized.barId)) {
        fail('validation', `${operation}: duplicate point barId at ${field}`, {
          operation,
          field: `${field}.barId`,
        });
      }
      if (index <= previousIndex) {
        fail('validation', `${operation}: ${field} is not in host slot order`, {
          operation,
          field,
        });
      }
      pointIds.add(normalized.barId);
      previousIndex = index;
      return normalized;
    });
    return { seriesId, points };
  });

  if (typeof result.hasMore !== 'boolean') {
    fail('validation', `${operation}: hasMore must be a boolean supplied by the host`, {
      operation,
      field: 'hasMore',
    });
  }
  let nextBefore;
  if (result.nextBefore !== undefined) {
    nextBefore = assertNonEmptyString(result.nextBefore, operation, 'nextBefore');
  }
  const sourceStatus = assertNonEmptyString(result.sourceStatus, operation, 'sourceStatus');
  let snapshotVersion;
  if (result.snapshotVersion !== undefined) {
    snapshotVersion = assertVersionString(result.snapshotVersion, operation, 'snapshotVersion');
  }
  let reconciledGapIds;
  if (result.reconciledGapIds !== undefined) {
    if (!Array.isArray(result.reconciledGapIds)) {
      fail('validation', `${operation}: reconciledGapIds must be an array`, {
        operation, field: 'reconciledGapIds',
      });
    }
    reconciledGapIds = result.reconciledGapIds.map((id, index) =>
      assertNonEmptyString(id, operation, `reconciledGapIds[${index}]`));
    if (new Set(reconciledGapIds).size !== reconciledGapIds.length) {
      fail('validation', `${operation}: reconciledGapIds must be unique`, {
        operation, field: 'reconciledGapIds',
      });
    }
    if (reconciledGapIds.length > 0 && snapshotVersion === undefined) {
      fail('validation', `${operation}: reconciledGapIds requires snapshotVersion`, {
        operation, field: 'snapshotVersion',
      });
    }
  }

  return {
    context,
    slots,
    series,
    hasMore: result.hasMore,
    ...(nextBefore !== undefined ? { nextBefore } : {}),
    sourceStatus,
    ...(snapshotVersion !== undefined ? { snapshotVersion } : {}),
    ...(reconciledGapIds !== undefined ? { reconciledGapIds } : {}),
  };
}

/**
 * Validates a history page against its request, including context identity,
 * unique identities, OHLC ranges, slot-relative point order and cursor shape.
 */
export function validateHistoryResult(result, request) {
  const operation = 'validateHistoryResult';
  if (!isRecord(request)) {
    fail('validation', 'validateHistoryResult: request must be an object', {
      operation,
      field: 'request',
    });
  }
  const context = validateContext(request.context, `${operation}.request.context`);
  if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
    fail('validation', 'validateHistoryResult: request.limit must be a positive safe integer', {
      operation,
      field: 'request.limit',
      context: contextLabel(context),
    });
  }
  if (request.before !== undefined) {
    assertNonEmptyString(request.before, operation, 'request.before');
  }
  const history = validateHistoryPayload(result, context, operation);
  if (
    request.before !== undefined &&
    history.hasMore &&
    history.nextBefore === request.before
  ) {
    fail('no-progress', 'validateHistoryResult: nextBefore repeats the request cursor', {
      operation,
      field: 'nextBefore',
      context: contextLabel(context),
    });
  }
  return history;
}

/** Validates a chart feed event against the active context. */
export function validateFeedEvent(event, context) {
  const operation = 'validateFeedEvent';
  const expectedContext = validateContext(context, `${operation}.context`);
  if (!isRecord(event)) {
    fail('validation', 'validateFeedEvent: event must be an object', {
      operation,
      field: 'event',
      context: contextLabel(expectedContext),
    });
  }
  if (!FEED_EVENT_TYPES.has(event.type)) {
    fail('validation', 'validateFeedEvent: unsupported event type', {
      operation,
      field: 'type',
      context: contextLabel(expectedContext),
    });
  }

  if (event.type === 'gap') {
    const eventContext = validateContext(event.context, `${operation}.gap.context`);
    assertSameContext(eventContext, expectedContext, operation, 'context');
    if (!isRecord(event.range)) {
      fail('validation', 'validateFeedEvent: range must be an object', {
        operation, field: 'range',
      });
    }
    return {
      type: 'gap',
      context: eventContext,
      gapId: assertNonEmptyString(event.gapId, operation, 'gapId'),
      range: {
        fromBarId: assertNonEmptyString(event.range.fromBarId, operation, 'range.fromBarId'),
        toBarId: assertNonEmptyString(event.range.toBarId, operation, 'range.toBarId'),
      },
    };
  }

  if (event.type === 'append') {
    const seriesId = assertNonEmptyString(event.seriesId, operation, 'seriesId');
    const point = validatePoint(event.point, operation, 'point');
    let slot;
    if (event.slot !== undefined) {
      slot = validateSlot(event.slot, operation, 'slot');
      if (slot.barId !== point.barId) {
        fail('validation', 'validateFeedEvent: append slot.barId must match point.barId', {
          operation,
          field: 'slot.barId',
        });
      }
    }
    const barState = validateBarState(event.barState, operation, 'barState');
    return {
      type: 'append',
      seriesId,
      point,
      ...(slot ? { slot } : {}),
      barState,
      ...validateVersionPair(event, operation, ''),
    };
  }

  if (event.type === 'replace' || event.type === 'correct') {
    return {
      type: event.type,
      seriesId: assertNonEmptyString(event.seriesId, operation, 'seriesId'),
      point: validatePoint(event.point, operation, 'point'),
      barState: validateBarState(event.barState, operation, 'barState'),
      ...validateVersionPair(event, operation, ''),
    };
  }

  if (event.type === 'snapshot') {
    return {
      type: 'snapshot',
      history: validateHistoryPayload(event.history, expectedContext, `${operation}.history`),
    };
  }

  if (event.type === 'status') {
    return { type: 'status', status: assertNonEmptyString(event.status, operation, 'status') };
  }

  return { type: 'error', message: assertNonEmptyString(event.message, operation, 'message') };
}

/** Validates an observation feed event against the active context. */
export function validateObservationEvent(event, context) {
  const operation = 'validateObservationEvent';
  const expectedContext = validateContext(context, `${operation}.context`);
  if (!isRecord(event)) {
    fail('validation', 'validateObservationEvent: event must be an object', {
      operation,
      field: 'event',
      context: contextLabel(expectedContext),
    });
  }
  if (!OBSERVATION_EVENT_TYPES.has(event.type)) {
    fail('validation', 'validateObservationEvent: unsupported event type', {
      operation,
      field: 'type',
      context: contextLabel(expectedContext),
    });
  }

  if (event.type === 'snapshot') {
    const normalized = {
      type: 'snapshot',
      observation: validateObservation(event.observation, operation, 'observation'),
    };
    if (event.snapshotVersion !== undefined) {
      normalized.snapshotVersion = assertVersionString(event.snapshotVersion, operation, 'snapshotVersion');
    }
    return normalized;
  }

  if (event.type === 'observation') {
    return { type: 'observation', observation: validateObservation(event.observation, operation, 'observation') };
  }

  if (event.type === 'status') {
    return { type: 'status', status: assertNonEmptyString(event.status, operation, 'status') };
  }

  return { type: 'error', message: assertNonEmptyString(event.message, operation, 'message') };
}

function cloneSlot(slot) {
  return {
    barId: slot.barId,
    ...(slot.time !== undefined ? { time: slot.time } : {}),
    ...(slot.sessionDate ? { sessionDate: { ...slot.sessionDate } } : {}),
  };
}

function clonePoint(point) {
  return { ...point };
}

function cloneObservation(observation) {
  return { ...observation };
}

function slotKey(slot) {
  return JSON.stringify([
    slot.barId,
    slot.time === undefined ? null : slot.time,
    slot.sessionDate ? [slot.sessionDate.year, slot.sessionDate.month, slot.sessionDate.day] : null,
  ]);
}

function pointKey(point) {
  if (point.kind === 'numeric') return [point.kind, point.barId, point.value];
  return [
    point.kind,
    point.barId,
    point.open,
    point.high,
    point.low,
    point.close,
    point.volume === undefined ? null : point.volume,
    point.buyVolume === undefined ? null : point.buyVolume,
    point.sellVolume === undefined ? null : point.sellVolume,
  ];
}

function changeKey(change) {
  return JSON.stringify([
    change.type,
    change.seriesId,
    pointKey(change.point),
    change.slot ? slotKey(change.slot) : null,
    change.barState,
  ]);
}

function historyKey(history) {
  return JSON.stringify([
    history.slots.map(slotKey),
    history.series.map((entry) => [entry.seriesId, entry.points.map(pointKey)]),
    history.snapshotVersion === undefined ? null : history.snapshotVersion,
  ]);
}

function observationKey(observation) {
  return JSON.stringify([
    observation.sourceId,
    observation.value,
    observation.barId === undefined ? null : observation.barId,
    observation.time === undefined ? null : observation.time,
    observation.state,
  ]);
}

/**
 * Removes URLs and credential-like fragments from provider messages. Errors
 * identify the operation and field, never tokens, cookies or raw response data.
 */
function sanitizeText(value) {
  if (typeof value !== 'string' || value.trim() === '') return 'provider reported an error';
  let text = value.replace(/https?:\/\/[^\s"'<>]+/gi, '[url]');
  text = text.replace(
    /\b(authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi,
    '$1=[redacted]',
  );
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]');
  if (text.length > 200) text = `${text.slice(0, 197)}...`;
  return text;
}

function isAbortError(error) {
  return Boolean(error) && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
}

function safeCall(callback, ...args) {
  if (typeof callback !== 'function') return;
  try {
    callback(...args);
  } catch {
    // Consumer callbacks must not break the integration state machine.
  }
}

function validateChartAdapter(chart) {
  const operation = 'createDatafeedController';
  if (!isRecord(chart)) {
    fail('configuration', 'createDatafeedController: chart adapter is required', {
      operation,
      field: 'chart',
    });
  }
  for (const method of ['replaceData', 'applyBatch', 'series', 'subscribe']) {
    if (typeof chart[method] !== 'function') {
      fail('configuration', `createDatafeedController: chart.${method} must be a function`, {
        operation,
        field: `chart.${method}`,
      });
    }
  }
}

/**
 * Creates a controller intended to be assigned to `chart.connectDatafeed`.
 * Options: { chart, onStatus, onError, onObservation, pageSize }.
 */
export function createDatafeedController(options = {}) {
  const { chart, onStatus, onError, onObservation } = options;
  validateChartAdapter(chart);
  const pageSize =
    options.pageSize === undefined ? DEFAULT_PAGE_SIZE : options.pageSize;
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    fail('configuration', 'createDatafeedController: pageSize must be a positive safe integer', {
      operation: 'createDatafeedController',
      field: 'pageSize',
    });
  }

  const emptyCapabilities = Object.freeze({
    history: false,
    stream: false,
    observations: false,
    intervals: null,
  });

  let destroyed = false;
  let feed = null;
  let context = null;
  let capabilities = emptyCapabilities;
  let reliable = false;
  let connected = false;

  let generation = 0;
  let loadSequence = 0;
  let abortController = null;
  let loading = false;

  let status = 'disconnected';
  let dataStatus = 'none';
  let chartHasData = false;
  let error = null;

  let hasMore = false;
  let nextBefore = null;
  let initialApplied = false;
  let chartEpoch = 0;

  // Timeline mirror, kept to enforce host order and point/slot identities.
  let slots = [];
  let slotIndex = new Map();
  let seriesPoints = new Map();
  let lastBarId = new Map();

  // Chart stream state.
  let streamOpen = false;
  let streamUnsubscribe = null;
  let chartBoundary;
  let chartVersion;
  let chartVersionSource = null;
  let chartSnapshotHistoryKey;
  let applyingHistoryVersion;
  let applyingHistory = false;
  let lastChangeKey;
  let chartConsistent = true;
  let chartAwaitingSnapshot = false;
  let chartSnapshotRequested = false;
  let chartStreamStatus = null;
  // IDs and endpoints are opaque; only the provider can confirm reconciliation.
  let missingRanges = new Map();
  let sourceStatus = null;
  let buffering = false;
  let buffered = [];
  let bufferOverflowed = false;

  // Independent observation stream state.
  let observeOpen = false;
  let observeUnsubscribe = null;
  let observations = new Map();
  let observationBoundary;
  let observationVersion;
  let observationVersionKey;
  let observationSnapshotKey;
  let observationConsistent = true;
  let observationAwaitingSnapshot = false;
  let observationSnapshotRequested = false;
  let observationInitialized = false;
  let observationStatus = null;
  let observationBuffered = [];
  let observationBufferOverflowed = false;

  const listeners = new Set();

  try {
    chart.subscribe('destroy', () => {
      if (destroyed) return;
      detachCurrent();
      connected = false;
      destroyed = true;
      incomingStatus('disconnected');
      emit('destroy');
    });
  } catch {
    throw new DatafeedError('configuration', 'createDatafeedController: chart.subscribe threw while registering destroy', {
      operation: 'createDatafeedController',
      field: 'chart.subscribe',
    });
  }

  function once(fn) {
    let called = false;
    return () => {
      if (called) return;
      called = true;
      try {
        fn();
      } catch {
        // Unsubscribe failures must not resurrect a closed subscription.
      }
    };
  }

  function currentContext() {
    return cloneContext(context);
  }

  function getCertainty() {
    let continuity = 'unconfirmed';
    if (!chartConsistent) continuity = 'broken';
    else if (reliable && chartBoundary !== undefined && chartVersion !== undefined) continuity = 'confirmed';

    let currentFreshness = 'unknown';
    if (!connected || destroyed) {
      if (chartHasData) currentFreshness = 'stale';
    } else if (!chartConsistent) {
      currentFreshness = 'stale';
    } else if (capabilities.stream && chartHasData && chartBoundary === undefined) {
      currentFreshness = 'stale';
    } else if (chartBoundary !== undefined && chartConsistent && reliable) {
      currentFreshness = 'fresh';
    }

    const completeness =
      chartConsistent && !chartAwaitingSnapshot && chartBoundary !== undefined && hasMore === false && chartHasData ? 'confirmed' : 'unconfirmed';

    return {
      completeness,
      continuity,
      freshness: currentFreshness,
      sourceStatus: sourceStatus ?? chartStreamStatus,
    };
  }

  function getState() {
    return {
      status,
      dataStatus,
      connected,
      destroyed,
      context: currentContext(),
      capabilities: {
        history: capabilities.history,
        stream: capabilities.stream,
        observations: capabilities.observations,
        intervals: capabilities.intervals ? [...capabilities.intervals] : null,
      },
      reliable,
      loading,
      hasMore,
      empty: dataStatus === 'empty',
      error: error
        ? {
            code: error.code,
            message: error.message,
            operation: error.operation,
            field: error.field,
          }
        : null,
      certainty: getCertainty(),
      timeline: {
        slotCount: slots.length,
        firstBarId: slots.length > 0 ? slots[0].barId : null,
        lastBarId: slots.length > 0 ? slots[slots.length - 1].barId : null,
      },
      chart: {
        snapshotVersion: chartBoundary ?? null,
        lastVersion: chartVersion ?? null,
        consistent: chartConsistent,
        awaitingSnapshot: chartAwaitingSnapshot,
        missingRanges: [...missingRanges.values()].map(({ gapId, range }) => ({
          gapId, range: { ...range },
        })),
        streamStatus: chartStreamStatus,
        buffered: buffered.length,
      },
      observationStream: {
        snapshotVersion: observationBoundary ?? null,
        lastVersion: observationVersion ?? null,
        consistent: observationConsistent,
        awaitingSnapshot: observationAwaitingSnapshot,
        status: observationStatus,
        initialized: observationInitialized,
        buffered: observationBuffered.length,
      },
      observations: [...observations.values()].map((entry) => ({
        sourceId: entry.observation.sourceId,
        observation: cloneObservation(entry.observation),
        snapshotVersion: entry.snapshotVersion,
        consistent: entry.consistent,
        initialized: entry.initialized,
      })),
      generation,
    };
  }

  function emit(kind) {
    if (listeners.size === 0) return;
    const snapshot = getState();
    for (const listener of [...listeners]) {
      safeCall(listener, snapshot, { kind });
    }
  }

  function incomingStatus(next) {
    if (status === next) return;
    const previous = status;
    status = next;
    emit('status');
    safeCall(onStatus, {
      status,
      previous,
      context: currentContext(),
      certainty: getCertainty(),
      error: error ? { code: error.code, message: error.message, operation: error.operation } : null,
    });
  }

  function setOperationError(nextError) {
    error = nextError;
    emit('error');
    safeCall(onError, nextError);
  }

  function wrapError(cause, operation, field) {
    if (cause instanceof DatafeedError) {
      return new DatafeedError(cause.code, cause.message, {
        operation,
        field: cause.field ?? field,
        context: cause.context ?? contextLabel(context),
      });
    }
    const detail = sanitizeText(cause && cause.message);
    return new DatafeedError('operation-failed', `${operation}: ${detail}`, {
      operation,
      field,
      context: contextLabel(context),
    });
  }

  function resetModel() {
    slots = [];
    slotIndex = new Map();
    seriesPoints = new Map();
    lastBarId = new Map();
  }

  function rebuildSlotIndex() {
    slotIndex = new Map(slots.map((slot, index) => [slot.barId, index]));
  }

  function seriesFor(seriesId, operation) {
    let series;
    try {
      series = chart.series(seriesId);
    } catch (cause) {
      throw wrapError(cause, operation, 'chart.series');
    }
    if (!isRecord(series)) {
      fail('configuration', `${operation}: chart.series(seriesId) did not return a series adapter`, {
        operation,
        field: 'chart.series',
        context: contextLabel(context),
      });
    }
    return series;
  }

  function pointsFor(seriesId) {
    let points = seriesPoints.get(seriesId);
    if (!points) {
      points = new Map();
      seriesPoints.set(seriesId, points);
    }
    return points;
  }

  function cancelLoads() {
    loadSequence += 1;
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    loading = false;
  }

  function detachCurrent() {
    generation += 1;
    cancelLoads();
    const releases = [streamUnsubscribe, observeUnsubscribe];
    streamUnsubscribe = null;
    observeUnsubscribe = null;
    const errors = [];
    for (const release of releases) {
      if (!release) continue;
      try { release(); } catch (error) { errors.push(error); }
    }
    streamOpen = false;
    observeOpen = false;
    buffering = false;
    buffered = [];
    bufferOverflowed = false;
    observationBuffered = [];
    observationBufferOverflowed = false;
    if (errors.length) throw new AggregateError(errors, 'datafeed: failed to release subscriptions');
  }

  function requestSnapshotInternal(stream) {
    if (destroyed || !feed || !context) return false;
    if (stream === 'chart') {
      if (chartSnapshotRequested) return false;
    } else if (observationSnapshotRequested) {
      return false;
    }
    if (typeof feed.requestSnapshot !== 'function') return false;
    if (stream === 'chart') chartSnapshotRequested = true;
    else observationSnapshotRequested = true;
    try {
      feed.requestSnapshot({ ...context }, stream);
    } catch (cause) {
      if (stream === 'chart') chartSnapshotRequested = false;
      else observationSnapshotRequested = false;
      setOperationError(wrapError(cause, 'requestSnapshot', 'requestSnapshot'));
    }
    return true;
  }

  function requestSnapshot(stream) {
    if (stream !== 'chart' && stream !== 'observations') {
      throw new DatafeedError(
        'validation',
        "requestSnapshot: stream must be 'chart' or 'observations'",
        { operation: 'requestSnapshot', field: 'stream', context: contextLabel(context) },
      );
    }
    return requestSnapshotInternal(stream);
  }

  // ---------------------------------------------------------------------------
  // Chart history
  // ---------------------------------------------------------------------------

  // A replacement that drops a slot still referenced by series data would leave
  // those points orphaned; the timeline must be reset explicitly instead.
  function assertReplacementKeepsReferences(nextSlots) {
    const nextBarIds = new Set(nextSlots.map((slot) => slot.barId));
    for (const [seriesId, points] of seriesPoints) {
      for (const barId of points.keys()) {
        if (!nextBarIds.has(barId)) {
          fail(
            'ambiguous-replacement',
            `history: replacement drops slot ${barId} still referenced by series ${seriesId}; call connect(null) to reset explicitly`,
            { operation: 'replaceData', field: 'slots', context: contextLabel(context) },
          );
        }
      }
    }
  }

  function replaceChartWithHistory(history) {
    const nextSlots = history.slots.map(cloneSlot);
    const nextSeries = history.series.map((entry) => ({
      seriesId: entry.seriesId,
      points: entry.points.map(clonePoint),
    }));

    assertReplacementKeepsReferences(nextSlots);

    // The adapter owns atomicity: it validates the whole next state before any
    // mutation, so a failure leaves the previous timeline, points and view intact.
    const previousApplyingHistory = applyingHistory;
    const previousApplyingVersion = applyingHistoryVersion;
    applyingHistory = true;
    applyingHistoryVersion = history.snapshotVersion;
    try {
      chart.replaceData({ slots: nextSlots, series: nextSeries });
    } catch (cause) {
      throw wrapError(cause, 'replaceData', 'chart.replaceData');
    } finally {
      applyingHistory = previousApplyingHistory;
      applyingHistoryVersion = previousApplyingVersion;
    }

    chartEpoch += 1;
    resetModel();
    slots = nextSlots.map(cloneSlot);
    rebuildSlotIndex();
    for (const entry of nextSeries) {
      const points = pointsFor(entry.seriesId);
      for (const point of entry.points) points.set(point.barId, clonePoint(point));
      if (entry.points.length > 0) {
        lastBarId.set(entry.seriesId, entry.points[entry.points.length - 1].barId);
      }
    }

    chartHasData = slots.length > 0;
    dataStatus = chartHasData ? 'available' : 'empty';
    initialApplied = true;
  }

  function adoptHistoryMetadata(history) {
    hasMore = history.hasMore;
    nextBefore = history.hasMore ? (history.nextBefore ?? null) : null;
    sourceStatus = history.sourceStatus;
    chartBoundary = history.snapshotVersion;
    chartVersion = history.snapshotVersion;
    chartVersionSource = history.snapshotVersion !== undefined ? 'snapshot' : null;
    chartSnapshotHistoryKey = history.snapshotVersion !== undefined ? historyKey(history) : undefined;
    lastChangeKey = undefined;
    chartConsistent = true;
    chartAwaitingSnapshot = false;
    if (missingRanges.size === 0) chartSnapshotRequested = false;
    if (missingRanges.size > 0) {
      chartConsistent = false;
      chartAwaitingSnapshot = true;
      buffering = true;
    }
  }

  function historyReconcilesGaps(history) {
    if (missingRanges.size === 0) return true;
    if (history.snapshotVersion === undefined || !history.reconciledGapIds) return false;
    const reconciled = new Set(history.reconciledGapIds);
    for (const gap of missingRanges.values()) {
      if (!reconciled.has(gap.gapId) || gap.oldVersions.has(history.snapshotVersion)) return false;
    }
    return true;
  }

  function rejectUnreconciledHistory(operation) {
    const wrapped = new DatafeedError(
      'unreconciled-gap',
      `${operation}: a new versioned snapshot must explicitly reconcile every reported gap`,
      { operation, field: 'reconciledGapIds', context: contextLabel(context) },
    );
    error = wrapped;
    chartConsistent = false;
    chartAwaitingSnapshot = true;
    buffering = true;
    incomingStatus(chartHasData ? 'reconciling' : 'error');
    setOperationError(wrapped);
  }

  function clearReconciledGaps(history, candidates) {
    if (!history.reconciledGapIds) return;
    for (const id of history.reconciledGapIds) {
      const gap = candidates.get(id);
      if (gap && missingRanges.get(id) === gap && !gap.oldVersions.has(history.snapshotVersion)) {
        missingRanges.delete(id);
      }
    }
  }

  function applyInitialResult(result, request, sequence) {
    let history;
    try {
      history = validateHistoryResult(result, request);
      if (history.slots.length === 0 && history.hasMore) {
        fail('no-progress', 'loadInitial: an empty history page cannot declare hasMore', {
          operation: 'loadInitial',
          field: 'hasMore',
          context: contextLabel(context),
        });
      }
      if (history.hasMore && history.nextBefore === undefined) {
        fail('no-progress', 'loadInitial: hasMore requires a usable nextBefore cursor', {
          operation: 'loadInitial',
          field: 'nextBefore',
          context: contextLabel(context),
        });
      }
    } catch (cause) {
      const wrapped = wrapError(cause, 'loadInitial', 'result');
      error = wrapped;
      loading = false;
      incomingStatus('error');
      setOperationError(wrapped);
      return;
    }

    if (sequence !== loadSequence || !connected || destroyed) return;
    if (!historyReconcilesGaps(history)) {
      loading = false;
      rejectUnreconciledHistory('loadInitial');
      return;
    }
    const reconciledGaps = new Map(missingRanges);


    try {
      cancelLoads();
      replaceChartWithHistory(history);
      clearReconciledGaps(history, reconciledGaps);
      adoptHistoryMetadata(history);
    } catch (cause) {
      const wrapped = wrapError(cause, 'loadInitial', 'chart');
      error = wrapped;
      loading = false;
      incomingStatus('error');
      setOperationError(wrapped);
      return;
    }

    if (missingRanges.size === 0) error = null;
    loading = false;
    incomingStatus(missingRanges.size > 0 ? 'reconciling' : (slots.length > 0 ? 'available' : 'empty'));
    replayChartBuffer();
    emit('history');
  }

  function runInitialLoad() {
    if (destroyed) return Promise.resolve(getState());
    if (!feed || !context) {
      if (!feed) incomingStatus('unavailable');
      return Promise.resolve(getState());
    }
    if (!capabilities.history) {
      throw new DatafeedError('capability-not-declared', 'loadInitial: history is not declared by the datafeed', {
        operation: 'loadInitial',
        field: 'capabilities.history',
        context: contextLabel(context),
      });
    }

    const sequence = ++loadSequence;
    if (abortController) abortController.abort();
    const controller = new AbortController();
    abortController = controller;
    loading = true;
    if (missingRanges.size === 0) error = null;
    buffering = capabilities.stream;
    incomingStatus(chartHasData || missingRanges.size > 0 ? 'reconciling' : 'loading');

    const request = { context: { ...context }, limit: pageSize };
    let promise;
    try {
      promise = feed.loadHistory(request, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted || sequence !== loadSequence || destroyed) {
        return Promise.resolve(getState());
      }
      const wrapped = wrapError(cause, 'loadInitial', 'loadHistory');
      error = wrapped;
      loading = false;
      buffering = capabilities.stream;
      incomingStatus('error');
      setOperationError(wrapped);
      return Promise.resolve(getState());
    }

    const resultPromise = Promise.resolve(promise).then(
      (result) => {
        if (sequence !== loadSequence || destroyed || controller.signal.aborted) {
          return getState();
        }
        applyInitialResult(result, request, sequence);
        return getState();
      },
      (cause) => {
        if (sequence !== loadSequence || destroyed || controller.signal.aborted || isAbortError(cause)) {
          return getState();
        }
        const wrapped = wrapError(cause, 'loadInitial', 'loadHistory');
        error = wrapped;
        loading = false;
        buffering = capabilities.stream;
        incomingStatus('error');
        setOperationError(wrapped);
        return getState();
      },
    );
    return resultPromise;
  }

  function loadInitial() {
    if (destroyed) return Promise.resolve(getState());
    if (!feed) {
      incomingStatus('unavailable');
      return Promise.resolve(getState());
    }
    if (missingRanges.size === 0) {
      buffered = [];
      bufferOverflowed = false;
    }
    return runInitialLoad();
  }

  function loadMore() {
    if (destroyed) return Promise.resolve(getState());
    if (!feed || !context) {
      incomingStatus('unavailable');
      return Promise.resolve(getState());
    }
    if (!capabilities.history) {
      throw new DatafeedError('capability-not-declared', 'loadMore: history is not declared by the datafeed', {
        operation: 'loadMore',
        field: 'capabilities.history',
        context: contextLabel(context),
      });
    }
    if (loading || !initialApplied || !hasMore) return Promise.resolve(getState());
    if (chartAwaitingSnapshot || !chartConsistent) {
      requestSnapshotInternal('chart');
      return Promise.resolve(getState());
    }

    if (!nextBefore) {
      const wrapped = new DatafeedError(
        'no-progress',
        'loadMore: hasMore is true but no usable nextBefore cursor is available',
        { operation: 'loadMore', field: 'nextBefore', context: contextLabel(context) },
      );
      error = wrapped;
      incomingStatus('error');
      setOperationError(wrapped);
      return Promise.resolve(getState());
    }

    const before = nextBefore;
    const sequence = ++loadSequence;
    if (abortController) abortController.abort();
    const controller = new AbortController();
    abortController = controller;
    const epochAtStart = chartEpoch;
    loading = true;
    error = null;
    const request = { context: { ...context }, before, limit: pageSize };

    let promise;
    try {
      promise = feed.loadHistory(request, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted || sequence !== loadSequence || destroyed) {
        return Promise.resolve(getState());
      }
      const wrapped = wrapError(cause, 'loadMore', 'loadHistory');
      error = wrapped;
      loading = false;
      incomingStatus('error');
      setOperationError(wrapped);
      return Promise.resolve(getState());
    }

    return Promise.resolve(promise).then(
      (result) => {
        if (sequence !== loadSequence || destroyed || controller.signal.aborted) return getState();
        applyOlderPage(result, request, epochAtStart);
        return getState();
      },
      (cause) => {
        if (sequence !== loadSequence || destroyed || controller.signal.aborted || isAbortError(cause)) {
          return getState();
        }
        const wrapped = wrapError(cause, 'loadMore', 'loadHistory');
        error = wrapped;
        loading = false;
        incomingStatus('error');
        setOperationError(wrapped);
        return getState();
      },
    );
  }

  function rejectOlderPage(code, message, field) {
    const wrapped = new DatafeedError(code, message, {
      operation: 'loadMore',
      field,
      context: contextLabel(context),
    });
    error = wrapped;
    loading = false;
    incomingStatus('error');
    setOperationError(wrapped);
  }

  function applyOlderPage(result, request, epochAtStart) {
    let page;
    try {
      page = validateHistoryResult(result, request);
    } catch (cause) {
      const wrapped = wrapError(cause, 'loadMore', 'result');
      loading = false;
      rejectOlderPage(wrapped.code, wrapped.message, wrapped.field ?? 'result');
      return;
    }

    if (page.slots.length === 0 && page.hasMore) {
      loading = false;
      rejectOlderPage(
        'no-progress',
        'loadMore: an empty older page cannot declare hasMore',
        'hasMore',
      );
      return;
    }
    if (page.hasMore && page.nextBefore === undefined) {
      loading = false;
      rejectOlderPage(
        'no-progress',
        'loadMore: hasMore requires a usable nextBefore cursor',
        'nextBefore',
      );
      return;
    }

    if (chartAwaitingSnapshot || !chartConsistent || chartEpoch !== epochAtStart) {
      loading = false;
      rejectOlderPage(
        'page-conflict',
        'loadMore: chart changed while the older page was loading; the page cannot be ordered',
        'page',
      );
      requestSnapshotInternal('chart');
      return;
    }

    for (const slot of page.slots) {
      if (slotIndex.has(slot.barId)) {
        loading = false;
        rejectOlderPage(
          'range',
          'loadMore: the older page overlaps existing timeline slots',
          'slots',
        );
        return;
      }
    }

    const series = page.series
      .filter((entry) => entry.points.length > 0)
      .map((entry) => ({ seriesId: entry.seriesId, points: entry.points.map(clonePoint) }));

    try {
      chart.applyBatch({
        timeline: { op: 'prepend', slots: page.slots.map(cloneSlot) },
        series,
      });
    } catch (cause) {
      loading = false;
      rejectOlderPage('chart-apply', wrapError(cause, 'loadMore', 'applyBatch').message, 'chart.applyBatch');
      return;
    }

    const hadSeries = new Map();
    for (const entry of page.series) {
      hadSeries.set(entry.seriesId, (seriesPoints.get(entry.seriesId)?.size ?? 0) > 0);
    }
    slots = [...page.slots.map(cloneSlot), ...slots];
    rebuildSlotIndex();
    for (const entry of page.series) {
      const points = pointsFor(entry.seriesId);
      for (const point of entry.points) points.set(point.barId, clonePoint(point));
      if (!hadSeries.get(entry.seriesId) && entry.points.length > 0) {
        lastBarId.set(entry.seriesId, entry.points[entry.points.length - 1].barId);
      }
    }

    hasMore = page.hasMore;
    nextBefore = page.hasMore ? page.nextBefore : null;
    sourceStatus = page.sourceStatus;
    error = null;
    loading = false;
    emit('history');
    incomingStatus(slots.length > 0 ? 'available' : 'empty');
  }

  // ---------------------------------------------------------------------------
  // Chart stream ordering
  // ---------------------------------------------------------------------------

  function pushBuffered(event) {
    if (bufferOverflowed) return;
    if (buffered.length >= MAX_BUFFERED_EVENTS) {
      bufferOverflowed = true;
      buffered = [];
      enterInconsistent('chart event buffer overflowed; a snapshot is required', 'stream', 'buffer');
      return;
    }
    buffering = true;
    buffered.push(event);
  }

  function enterInconsistent(message, operation, field) {
    if (chartAwaitingSnapshot) return;
    chartAwaitingSnapshot = true;
    chartConsistent = false;
    buffering = true;
    const wrapped = new DatafeedError('inconsistent', `${operation}: ${message}`, {
      operation,
      field,
      context: contextLabel(context),
    });
    error = wrapped;
    incomingStatus(chartHasData ? 'reconciling' : 'error');
    setOperationError(wrapped);
    requestSnapshotInternal('chart');
  }

  function applyChangeToChart(change) {
    const points = seriesPoints.get(change.seriesId) ?? new Map();
    const last = lastBarId.get(change.seriesId);

    if (change.type === 'append') {
      let newSlot = null;
      let index;
      if (change.slot) {
        const existingIndex = slotIndex.get(change.slot.barId);
        if (existingIndex !== undefined) {
          const existing = slots[existingIndex];
          if (slotKey(existing) !== slotKey(change.slot)) {
            fail('order', 'stream: append supplied a slot that conflicts with the existing slot', {
              operation: 'stream',
              field: 'slot',
              context: contextLabel(context),
            });
          }
          index = existingIndex;
        } else {
          newSlot = change.slot;
          index = slots.length;
        }
      } else {
        index = slotIndex.get(change.point.barId);
        if (index === undefined) {
          fail('order', 'stream: append references a slot that does not exist', {
            operation: 'stream',
            field: 'point.barId',
            context: contextLabel(context),
          });
        }
      }

      if (last !== undefined) {
        const lastIndex = slotIndex.get(last);
        if (index <= lastIndex) {
          fail(
            'order',
            index === lastIndex
              ? 'stream: append targets the last point slot; replace is required'
              : 'stream: append targets an older slot; correct is required',
            { operation: 'stream', field: 'point.barId', context: contextLabel(context) },
          );
        }
      }
      if (newSlot === null && points.has(change.point.barId)) {
        fail('order', 'stream: append duplicates a point on an existing slot', {
          operation: 'stream',
          field: 'point.barId',
          context: contextLabel(context),
        });
      }

      if (newSlot) {
        chart.applyBatch({
          timeline: { op: 'append', slots: [cloneSlot(newSlot)] },
          series: [{ seriesId: change.seriesId, points: [clonePoint(change.point)] }],
        });
        slots.push(cloneSlot(newSlot));
        slotIndex.set(newSlot.barId, slots.length - 1);
      } else {
        seriesFor(change.seriesId, 'stream').update(clonePoint(change.point));
      }
      pointsFor(change.seriesId).set(change.point.barId, clonePoint(change.point));
      lastBarId.set(change.seriesId, change.point.barId);
      return;
    }

    if (change.type === 'replace') {
      if (last === undefined || last !== change.point.barId) {
        fail('order', 'stream: replace is only allowed for the last point of the series', {
          operation: 'stream',
          field: 'point.barId',
          context: contextLabel(context),
        });
      }
      seriesFor(change.seriesId, 'stream').update(clonePoint(change.point));
      pointsFor(change.seriesId).set(change.point.barId, clonePoint(change.point));
      return;
    }

    if (change.type === 'correct') {
      if (!slotIndex.has(change.point.barId) || !points.has(change.point.barId)) {
        fail('order', 'stream: correct references a point that does not exist', {
          operation: 'stream',
          field: 'point.barId',
          context: contextLabel(context),
        });
      }
      seriesFor(change.seriesId, 'stream').correct(clonePoint(change.point));
      points.set(change.point.barId, clonePoint(change.point));
    }
  }

  function handleChange(event) {
    if (buffering) {
      pushBuffered(event);
      return;
    }
    if (chartAwaitingSnapshot) {
      pushBuffered(event);
      return;
    }

    const versioned = event.version !== undefined;
    if (!versioned) {
      try {
        applyChangeToChart(event);
      } catch (cause) {
        const wrapped = wrapError(cause, 'stream', 'event');
        error = wrapped;
        incomingStatus(chartHasData ? 'available' : 'error');
        setOperationError(wrapped);
        return;
      }
      emit('stream');
      incomingStatus(chartHasData ? 'available' : 'empty');
      return;
    }

    if (chartBoundary === undefined || chartVersion === undefined) {
      pushBuffered(event);
      enterInconsistent('versioned change cannot be ordered without a snapshot boundary', 'stream', 'prevVersion');
      return;
    }

    const key = changeKey(event);
    if (event.version === chartVersion) {
      if (chartVersionSource === 'change' && lastChangeKey !== undefined && lastChangeKey !== key) {
        pushBuffered(event);
        enterInconsistent('the same version was received with different content', 'stream', 'version');
      }
      return;
    }

    if (event.prevVersion !== chartVersion) {
      pushBuffered(event);
      enterInconsistent('a version gap was detected; the chain is not continuous', 'stream', 'prevVersion');
      return;
    }

    try {
      applyChangeToChart(event);
    } catch (cause) {
      const wrapped = wrapError(cause, 'stream', 'event');
      error = wrapped;
      incomingStatus(chartHasData ? 'available' : 'error');
      setOperationError(wrapped);
      return;
    }
    chartVersion = event.version;
    chartVersionSource = 'change';
    lastChangeKey = key;
    chartConsistent = true;
    emit('stream');
    incomingStatus(chartHasData ? 'available' : 'empty');
  }

  function includedVersions(queue, boundary) {
    const included = new Set([boundary]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const event of queue) {
        if (
          event.version !== undefined &&
          event.prevVersion !== undefined &&
          included.has(event.version) &&
          !included.has(event.prevVersion)
        ) {
          included.add(event.prevVersion);
          changed = true;
        }
      }
    }
    return included;
  }

  function replayChartBuffer(authoritative = false) {
    if (missingRanges.size > 0) {
      chartConsistent = false;
      chartAwaitingSnapshot = true;
      buffering = true;
      return;
    }
    if (buffered.length === 0) {
      buffering = false;
      if (chartBoundary !== undefined) {
        chartAwaitingSnapshot = false;
        chartConsistent = true;
        chartSnapshotRequested = false;
      }
      return;
    }
    const queue = buffered;

    if (chartBoundary === undefined) {
      if (queue.some((event) => event.version !== undefined)) {
        buffered = queue;
        enterInconsistent('buffered events cannot be ordered without a snapshot boundary', 'snapshot', 'snapshotVersion');
        return;
      }
      buffered = [];
      for (const event of queue) {
        try {
          applyChangeToChart(event);
        } catch (cause) {
          const wrapped = wrapError(cause, 'stream', 'event');
          error = wrapped;
          setOperationError(wrapped);
          buffering = false;
          return;
        }
      }
      buffering = false;
      chartConsistent = true;
      emit('stream');
      return;
    }

    const included = includedVersions(queue, chartBoundary);
    const remaining = queue.filter(
      (event) => event.version === undefined || !included.has(event.version),
    );

    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let index = 0; index < remaining.length; ) {
        const event = remaining[index];
        if (event.version === undefined) {
          index += 1;
          continue;
        }
        if (event.version === chartVersion) {
          if (chartVersionSource === 'change' && lastChangeKey !== undefined && lastChangeKey !== changeKey(event)) {
            buffered = remaining;
            enterInconsistent('the same version was received with different content', 'snapshot', 'version');
            return;
          }
          remaining.splice(index, 1);
          progressed = true;
          continue;
        }
        if (event.prevVersion === chartVersion) {
          try {
            applyChangeToChart(event);
          } catch (cause) {
            const wrapped = wrapError(cause, 'stream', 'event');
            error = wrapped;
            setOperationError(wrapped);
            buffered = remaining;
            enterInconsistent('a buffered event could not be applied', 'snapshot', 'event');
            return;
          }
          chartVersion = event.version;
          chartVersionSource = 'change';
          lastChangeKey = changeKey(event);
          remaining.splice(index, 1);
          progressed = true;
          continue;
        }
        index += 1;
      }
    }

    if (remaining.length > 0) {
      if (authoritative) {
        // A host snapshot at a fresh boundary is the reconciliation basis: events
        // that cannot be chained from it belong to the superseded boundary.
        buffered = [];
        bufferOverflowed = false;
        buffering = false;
        chartAwaitingSnapshot = false;
        chartConsistent = true;
        chartSnapshotRequested = false;
        error = null;
        emit('stream');
        incomingStatus(slots.length > 0 ? 'available' : 'empty');
        return;
      }
      buffered = remaining;
      enterInconsistent('buffered events remain unordered against the snapshot boundary', 'snapshot', 'version');
      return;
    }

    buffered = [];
    bufferOverflowed = false;
    buffering = false;
    chartAwaitingSnapshot = false;
    chartConsistent = true;
    chartSnapshotRequested = false;
    emit('stream');
    incomingStatus(slots.length > 0 ? 'available' : 'empty');
  }

  function handleSnapshot(event) {
    const history = event.history;
    if (!historyReconcilesGaps(history)) {
      chartSnapshotRequested = false;
      rejectUnreconciledHistory('snapshot');
      return;
    }
    const reconciledGaps = new Map(missingRanges);
    cancelLoads();
    if (
      history.snapshotVersion !== undefined &&
      chartBoundary === history.snapshotVersion &&
      chartSnapshotHistoryKey !== undefined &&
      chartSnapshotHistoryKey !== historyKey(history)
    ) {
      enterInconsistent('the same snapshot boundary was received with different content', 'snapshot', 'snapshotVersion');
      return;
    }
    chartSnapshotRequested = false;
    try {
      replaceChartWithHistory(history);
      clearReconciledGaps(history, reconciledGaps);
      adoptHistoryMetadata(history);
    } catch (cause) {
      const wrapped = wrapError(cause, 'snapshot', 'history');
      error = wrapped;
      incomingStatus('error');
      setOperationError(wrapped);
      return;
    }
    if (missingRanges.size === 0) error = null;
    emit('history');
    incomingStatus(missingRanges.size > 0 ? 'reconciling' : (slots.length > 0 ? 'available' : 'empty'));
    replayChartBuffer(reconciledGaps.size === 0);
  }

  function handleFeedEvent(rawEvent) {
    let event;
    try {
      event = validateFeedEvent(rawEvent, context);
    } catch (cause) {
      setOperationError(wrapError(cause, 'stream', 'event'));
      return;
    }

    if (event.type === 'gap') {
      const existing = missingRanges.get(event.gapId);
      if (existing) {
        if (existing.range.fromBarId !== event.range.fromBarId || existing.range.toBarId !== event.range.toBarId) {
          setOperationError(new DatafeedError('gap-conflict', 'stream: gapId was reused for a different range', {
            operation: 'stream', field: 'gapId', context: contextLabel(context),
          }));
        }
        return;
      }
      missingRanges.set(event.gapId, {
        gapId: event.gapId,
        range: event.range,
        oldVersions: new Set([chartBoundary, chartVersion, applyingHistoryVersion].filter((version) => version !== undefined)),
      });
      chartConsistent = false;
      chartAwaitingSnapshot = true;
      buffering = true;
      const wrapped = new DatafeedError('missing-range', 'stream: provider reported a missing range; request a reconciled snapshot', {
        operation: 'stream', field: 'range', context: contextLabel(context),
      });
      error = wrapped;
      incomingStatus(chartHasData ? 'reconciling' : 'error');
      setOperationError(wrapped);
      if (applyingHistory) {
        const currentGeneration = generation;
        queueMicrotask(() => {
          if (!destroyed && connected && generation === currentGeneration && missingRanges.size > 0) {
            requestSnapshotInternal('chart');
          }
        });
      } else {
        requestSnapshotInternal('chart');
      }
      return;
    }
    if (event.type === 'snapshot') {
      handleSnapshot(event);
      return;
    }
    if (event.type === 'status') {
      chartStreamStatus = event.status;
      sourceStatus = event.status;
      emit('status');
      return;
    }
    if (event.type === 'error') {
      const wrapped = new DatafeedError('provider-error', `stream: ${sanitizeText(event.message)}`, {
        operation: 'stream',
        field: 'message',
        context: contextLabel(context),
      });
      error = wrapped;
      setOperationError(wrapped);
      return;
    }
    handleChange(event);
  }

  // ---------------------------------------------------------------------------
  // Observation stream
  // ---------------------------------------------------------------------------

  function storeObservation(observation, snapshotVersion, consistent) {
    observations.set(observation.sourceId, {
      observation: cloneObservation(observation),
      snapshotVersion: snapshotVersion ?? null,
      consistent,
      initialized: observationInitialized,
    });
    if (typeof chart.applyObservation === 'function') {
      try {
        chart.applyObservation(cloneObservation(observation));
      } catch (cause) {
        setOperationError(wrapError(cause, 'observe', 'chart.applyObservation'));
      }
    }
  }

  function deliverObservation(observation, { alert, initializes = false }) {
    const entry = observations.get(observation.sourceId);
    if (entry) {
      entry.consistent = observationConsistent;
      entry.initialized = observationInitialized;
    }
    safeCall(onObservation, {
      observation: cloneObservation(observation),
      sourceId: observation.sourceId,
      snapshotVersion: observationBoundary ?? null,
      alert,
      initializes,
      consistent: observationConsistent,
      context: currentContext(),
    });
  }

  function enterObservationInconsistent(message, field) {
    if (observationAwaitingSnapshot) return;
    observationAwaitingSnapshot = true;
    observationConsistent = false;
    const wrapped = new DatafeedError('inconsistent', `observe: ${message}`, {
      operation: 'observe',
      field,
      context: contextLabel(context),
    });
    error = wrapped;
    for (const entry of observations.values()) entry.consistent = false;
    setOperationError(wrapped);
    requestSnapshotInternal('observations');
  }

  function pushObservationBuffer(event) {
    if (observationBufferOverflowed) return;
    if (observationBuffered.length >= MAX_BUFFERED_EVENTS) {
      observationBufferOverflowed = true;
      observationBuffered = [];
      enterObservationInconsistent('observation buffer overflowed; a snapshot is required', 'buffer');
      return;
    }
    observationBuffered.push(event);
  }

  function handleObservation(observation) {
    if (observationAwaitingSnapshot) {
      pushObservationBuffer({ type: 'observation', observation });
      return;
    }

    if (observation.version === undefined) {
      observationConsistent = false;
      storeObservation(observation, observationBoundary, false);
      observationInitialized = true;
      deliverObservation(observation, { alert: false });
      emit('observation');
      return;
    }

    if (observationBoundary === undefined || observationVersion === undefined) {
      pushObservationBuffer({ type: 'observation', observation });
      enterObservationInconsistent(
        'versioned observation cannot be ordered without a snapshot boundary',
        'prevVersion',
      );
      return;
    }

    const key = observationKey(observation);
    if (observation.version === observationVersion) {
      if (observationVersionKey !== undefined && observationVersionKey !== key) {
        pushObservationBuffer({ type: 'observation', observation });
        enterObservationInconsistent('the same observation version was received with different content', 'version');
      }
      return;
    }

    if (observation.prevVersion !== observationVersion) {
      pushObservationBuffer({ type: 'observation', observation });
      enterObservationInconsistent('an observation version gap was detected', 'prevVersion');
      return;
    }

    observationVersion = observation.version;
    observationVersionKey = key;
    observationConsistent = true;
    storeObservation(observation, observationBoundary, true);
    if (!observationInitialized) {
      observationInitialized = true;
      deliverObservation(observation, { alert: false, initializes: true });
    } else {
      deliverObservation(observation, { alert: true });
    }
    emit('observation');
  }

  function handleObservationSnapshot(event) {
    const observation = event.observation;
    const boundary = event.snapshotVersion;
    const key = observationKey(observation);

    if (
      boundary !== undefined &&
      observationBoundary === boundary &&
      observationSnapshotKey !== undefined &&
      observationSnapshotKey !== key
    ) {
      enterObservationInconsistent('the same snapshot boundary was received with different content', 'snapshotVersion');
      return;
    }

    observationBoundary = boundary;
    observationVersion = boundary;
    observationVersionKey = undefined;
    observationSnapshotKey = key;
    observationInitialized = false;
    observationConsistent = boundary !== undefined;
    observationAwaitingSnapshot = boundary === undefined;
    storeObservation(observation, boundary, observationConsistent);

    if (boundary === undefined) {
      if (observationBuffered.some((entry) => entry.observation.version !== undefined)) {
        enterObservationInconsistent('observations cannot be ordered without a snapshot boundary', 'snapshotVersion');
      }
      observationSnapshotRequested = false;
      emit('observation');
      return;
    }

    // Replay observations that chain from the new boundary. The first applied
    // value only initializes local alert state and emits no alert event.
    const remaining = observationBuffered.filter(
      (entry) => entry.observation.version !== undefined,
    );
    observationBuffered = [];
    let progressed = true;
    while (progressed) {
      progressed = false;
      for (let index = 0; index < remaining.length; ) {
        const entry = remaining[index];
        const next = entry.observation;
        if (next.prevVersion !== observationVersion) {
          index += 1;
          continue;
        }
        observationVersion = next.version;
        observationVersionKey = observationKey(next);
        observationConsistent = true;
        storeObservation(next, observationBoundary, true);
        if (!observationInitialized) {
          observationInitialized = true;
          deliverObservation(next, { alert: false, initializes: true });
        } else {
          deliverObservation(next, { alert: true });
        }
        remaining.splice(index, 1);
        progressed = true;
      }
    }

    if (remaining.length > 0) {
      // The host snapshot is the new basis; observations that cannot be chained
      // from its boundary belong to the superseded boundary.
      observationBuffered = [];
      observationBufferOverflowed = false;
    }

    observationAwaitingSnapshot = false;
    observationConsistent = true;
    observationSnapshotRequested = false;
    error = null;
    emit('observation');
  }

  function handleObservationEvent(rawEvent) {
    let event;
    try {
      event = validateObservationEvent(rawEvent, context);
    } catch (cause) {
      setOperationError(wrapError(cause, 'observe', 'event'));
      return;
    }

    if (event.type === 'snapshot') {
      handleObservationSnapshot(event);
      return;
    }
    if (event.type === 'status') {
      observationStatus = event.status;
      emit('status');
      return;
    }
    if (event.type === 'error') {
      const wrapped = new DatafeedError('provider-error', `observe: ${sanitizeText(event.message)}`, {
        operation: 'observe',
        field: 'message',
        context: contextLabel(context),
      });
      error = wrapped;
      setOperationError(wrapped);
      return;
    }
    handleObservation(event.observation);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions and lifecycle
  // ---------------------------------------------------------------------------

  function startChartSubscription() {
    if (!capabilities.stream) return;
    const currentGeneration = generation;
    const observer = {
      next(event) {
        if (destroyed || !streamOpen || currentGeneration !== generation) return;
        handleFeedEvent(event);
      },
      error(cause) {
        if (destroyed || !streamOpen || currentGeneration !== generation) return;
        const wrapped = wrapError(cause, 'subscribe', 'observer.error');
        error = wrapped;
        setOperationError(wrapped);
      },
    };
    streamOpen = true;
    try {
      const unsubscribe = feed.subscribe({ ...context }, observer);
      streamUnsubscribe = typeof unsubscribe === 'function' ? once(unsubscribe) : null;
    } catch (cause) {
      streamOpen = false;
      const wrapped = wrapError(cause, 'subscribe', 'subscribe');
      error = wrapped;
      incomingStatus('error');
      setOperationError(wrapped);
    }
  }

  function startObservationSubscription() {
    if (!capabilities.observations) return;
    const currentGeneration = generation;
    const observer = {
      next(event) {
        if (destroyed || !observeOpen || currentGeneration !== generation) return;
        handleObservationEvent(event);
      },
      error(cause) {
        if (destroyed || !observeOpen || currentGeneration !== generation) return;
        const wrapped = wrapError(cause, 'observe', 'observer.error');
        error = wrapped;
        setOperationError(wrapped);
      },
    };
    observeOpen = true;
    try {
      const unsubscribe = feed.observe({ ...context }, observer);
      observeUnsubscribe = typeof unsubscribe === 'function' ? once(unsubscribe) : null;
    } catch (cause) {
      observeOpen = false;
      const wrapped = wrapError(cause, 'observe', 'observe');
      error = wrapped;
      setOperationError(wrapped);
    }
  }

  function connect(nextFeed, nextContext) {
    if (destroyed) {
      throw new DatafeedError('destroyed', 'connect: the controller is destroyed', {
        operation: 'connect',
        field: 'controller',
      });
    }

    if (nextFeed === null || nextFeed === undefined) {
      detachCurrent();
      feed = null;
      context = null;
      capabilities = emptyCapabilities;
      reliable = false;
      connected = false;
      error = null;
      initialApplied = false;
      hasMore = false;
      nextBefore = null;
      missingRanges.clear();
      incomingStatus('unavailable');
      emit('connect');
      return Promise.resolve(getState());
    }

    const validated = validateDatafeed(nextFeed);
    const nextContextValue = validateContext(nextContext, 'connect.context');

    if (
      validated.capabilities.intervals &&
      !validated.capabilities.intervals.includes(nextContextValue.interval)
    ) {
      const wrapped = new DatafeedError(
        'unsupported-interval',
        `connect: interval is not declared by the datafeed for ${contextLabel(nextContextValue)}`,
        { operation: 'connect', field: 'context.interval', context: contextLabel(nextContextValue) },
      );
      error = wrapped;
      setOperationError(wrapped);
      throw wrapped;
    }

    const sameContext =
      context !== null &&
      context.instrumentId === nextContextValue.instrumentId &&
      context.interval === nextContextValue.interval &&
      context.sourceId === nextContextValue.sourceId;

    detachCurrent();
    const hadChartData = chartHasData;

    feed = nextFeed;
    context = nextContextValue;
    capabilities = validated.capabilities;
    reliable = validated.reliable;
    connected = true;

    chartStreamStatus = null;
    sourceStatus = null;
    error = null;
    buffering = capabilities.stream;
    buffered = [];
    bufferOverflowed = false;

    observationBoundary = undefined;
    observationVersion = undefined;
    observationVersionKey = undefined;
    observationSnapshotKey = undefined;
    observationConsistent = true;
    observationAwaitingSnapshot = false;
    observationSnapshotRequested = false;
    observationInitialized = false;
    observationStatus = null;
    observationBuffered = [];
    observationBufferOverflowed = false;

    if (!sameContext) {
      missingRanges.clear();
      chartBoundary = undefined;
      chartVersion = undefined;
      chartVersionSource = null;
      chartSnapshotHistoryKey = undefined;
      lastChangeKey = undefined;
      chartConsistent = true;
      chartAwaitingSnapshot = false;
      chartSnapshotRequested = false;
      hasMore = false;
      nextBefore = null;
      initialApplied = false;
      resetModel();
      chartHasData = false;
      dataStatus = 'none';
      observations = new Map();
    } else {
      // Keep the last committed history and metadata visible, but a reconnect
      // never proves continuity: the chain stays unconfirmed until reconciliation.
      chartConsistent = false;
      chartAwaitingSnapshot = missingRanges.size > 0;
      chartSnapshotRequested = false;
      observations = new Map(
        [...observations.entries()].map(([key, entry]) => [
          key,
          { ...entry, consistent: false, initialized: false },
        ]),
      );
    }

    const epochBeforeSubscribe = chartEpoch;
    startChartSubscription();
    startObservationSubscription();

    if (capabilities.history) {
      if (chartEpoch !== epochBeforeSubscribe) return Promise.resolve(getState());
      const result = runInitialLoad();
      if (missingRanges.size > 0) requestSnapshotInternal('chart');
      return result;
    }

    if (capabilities.stream) {
      incomingStatus(hadChartData || missingRanges.size > 0 ? 'reconciling' : 'loading');
      if (hadChartData || missingRanges.size > 0) requestSnapshotInternal('chart');
    } else {
      incomingStatus('unavailable');
    }
    emit('connect');
    return Promise.resolve(getState());
  }

  function disconnect() {
    if (destroyed) return;
    const wasConnected = connected;
    detachCurrent();
    if (!wasConnected && status === 'disconnected') {
      emit('disconnect');
      return;
    }
    connected = false;
    loading = false;
    incomingStatus('disconnected');
    emit('disconnect');
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new DatafeedError('validation', 'subscribe: listener must be a function', {
        operation: 'subscribe',
        field: 'listener',
      });
    }
    listeners.add(listener);
    return once(() => listeners.delete(listener));
  }

  function getObservations() {
    return [...observations.values()].map((entry) => ({
      sourceId: entry.observation.sourceId,
      observation: cloneObservation(entry.observation),
      snapshotVersion: entry.snapshotVersion,
      consistent: entry.consistent,
      initialized: entry.initialized,
    }));
  }

  return {
    connect,
    loadInitial,
    loadMore,
    disconnect,
    requestSnapshot,
    getState,
    subscribe,
    getObservations,
  };
}
