import { ALERT_ERROR_CODES, AlertError, errorText } from './errors.js';
import {
  ALERT_SCHEMA_VERSION,
  deepFreeze,
  exportDefinition,
  validateAlertDefinition,
  validateDefinitionsDocument,
  validateObservation
} from './definition.js';
import {
  checkKeys,
  cloneJson,
  isInclinedDrawing,
  isLogDrawing,
  isPlainObject,
  resolveDrawingThreshold,
  sourceIsLevel,
  sourceKey,
  stableStringify
} from './geometry.js';

const BACKEND_METHODS = Object.freeze(['create', 'read', 'update', 'pause', 'resume', 'delete', 'subscribe']);
const BACKEND_STATUSES = Object.freeze(['active', 'paused', 'completed', 'expired', 'error', 'unknown']);
const DELIVERY_STATUSES = Object.freeze(['pending', 'delivered', 'failed', 'unknown']);
const OUTCOMES = Object.freeze(['confirmed', 'rejected', 'conflict', 'unknown', 'error']);

const sideOf = d => (d > 0 ? 'positive' : d < 0 ? 'negative' : 'equal');

function normalizeDelivery(delivery) {
  if (!isPlainObject(delivery) || !DELIVERY_STATUSES.includes(delivery.status)) return null;
  return { status: delivery.status, error: errorText(delivery.error) };
}

function normalizeOutcome(result) {
  if (!isPlainObject(result) || !OUTCOMES.includes(result.outcome)) {
    return { outcome: 'unknown', error: 'adapter returned an untyped result' };
  }
  return result;
}

function once(fn) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    fn();
  };
}

/**
 * Create a deterministic local alert engine.
 *
 * The engine is pure: it owns no DOM, timers, network or storage. Host hooks
 * (`clock`, `notify`, `resolveSource`, `resolveBarIndex`, `unitsCompatible`)
 * are the only ways to observe time, deliver notifications, resolve sources
 * and map drawing anchors. A backend transport is supplied explicitly via
 * `setBackendAdapter`.
 *
 * @param {{
 *   clock?: (() => number) | {now(): number},
 *   notify?: (event: object) => {status: string, error?: unknown} | void,
 *   authority?: 'local'|'backend',
 *   requestSnapshot?: (reason: 'version-gap'|'gap', stream: object | null) => void,
 *   createRequestId?: (operation: string, alertId: string) => string,
 *   simulation?: boolean,
 *   resolveSource?: (source: object) => boolean | {available?: boolean, units?: string},
 *   resolveBarIndex?: (barId: string, chartId?: string) => number | null | undefined,
 *   unitsCompatible?: (leftUnits: string, rightUnits: string) => boolean
 * }} [options]
 */
export function createAlertEngine(options = {}) {
  if (!isPlainObject(options)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: options must be an object');
  }
  const clock = options.clock ?? null;
  if (clock !== null && typeof clock !== 'function' && !(isPlainObject(clock) && typeof clock.now === 'function')) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: clock must be a function or {now()}');
  }
  if (options.notify !== undefined && typeof options.notify !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: notify must be a function');
  }
  if (options.requestSnapshot !== undefined && typeof options.requestSnapshot !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: requestSnapshot must be a function');
  }
  if (options.createRequestId !== undefined && typeof options.createRequestId !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: createRequestId must be a function');
  }
  const defaultAuthority = options.authority ?? 'local';
  if (!['local', 'backend'].includes(defaultAuthority)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: authority must be local or backend');
  }
  if (options.resolveSource !== undefined && typeof options.resolveSource !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: resolveSource must be a function');
  }
  if (options.resolveBarIndex !== undefined && typeof options.resolveBarIndex !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: resolveBarIndex must be a function');
  }
  if (options.unitsCompatible !== undefined && typeof options.unitsCompatible !== 'function') {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'createAlertEngine: unitsCompatible must be a function');
  }

  const validationCtx = {
    defaultAuthority,
    resolveSource: options.resolveSource,
    unitsCompatible: options.unitsCompatible,
    resolveBarIndex: options.resolveBarIndex
  };
  const notify = typeof options.notify === 'function' ? options.notify : null;
  const resolveBarIndex = options.resolveBarIndex ?? null;
  let simulation = options.simulation === true;

  let records = new Map();
  const retired = new Map();
  const listeners = new Set();
  const keyIndex = new Map();
  const barWatchers = new Set();
  const blockedSources = [];
  const streams = new Map();
  let sessionAlive = true;
  let consolidated = true;
  let needsSnapshot = false;
  let lastListenerError = null;
  let lastClockError = null;

  let backendAdapter = null;
  let backendUnsubscribe = null;
  let backendError = null;
  let backendIdempotency = null;
  let requestCounter = 0;
  const usedRequestIds = new Set();
  const externalEvents = new Map();
  const pendingCreates = new Map();
  const inFlightDefinitions = new Set();

  function trustedNow() {
    if (clock === null) return null;
    try {
      const value = typeof clock === 'function' ? clock() : clock.now();
      if (!Number.isFinite(value)) return null;
      return value;
    } catch (error) {
      lastClockError = errorText(error);
      return null;
    }
  }

  function emit(change) {
    for (const listener of [...listeners]) {
      try {
        listener(change);
      } catch (error) {
        lastListenerError = errorText(error);
      }
    }
  }

  function resetContinuity(record, { quiet = true, clearVersion = true } = {}) {
    const evaluation = record.evaluation;
    evaluation.initialized = false;
    evaluation.armed = false;
    evaluation.side = null;
    evaluation.lastD = null;
    evaluation.quietInit = quiet;
    evaluation.skippedReason = null;
    if (clearVersion) {
      evaluation.lastVersion = null;
    }
  }

  function expiryState(definition) {
    if (definition.expiresAt === null) return { known: true, expired: false };
    const now = trustedNow();
    if (now === null) return { known: false, expired: null };
    return { known: true, expired: now >= definition.expiresAt };
  }

  function computeStatus(record) {
    const definition = record.definition;
    const evaluation = record.evaluation;
    if (definition.authority === 'backend') {
      const backend = record.backend;
      if (backend.syncState === 'unknown') return { status: 'unknown', reason: 'backend-outcome-unknown' };
      if (backend.confirmedRevision === definition.revision && backend.confirmedStatus) {
        return { status: backend.confirmedStatus, reason: backend.error ? 'backend-error' : null };
      }
      return { status: 'unknown', reason: 'authority-unconfirmed' };
    }
    if (evaluation.completed) return { status: 'completed', reason: 'once-fired' };
    if (evaluation.pauseCause === 'user') return { status: 'paused', reason: 'user' };
    if (evaluation.sourceError) return { status: 'error', reason: 'source-unavailable' };
    if (evaluation.errorState) return { status: 'error', reason: evaluation.errorState };
    if (evaluation.inconsistent) return { status: 'unknown', reason: 'version-gap' };
    if (evaluation.pauseCause === 'geometry' || evaluation.geometryMissing) return { status: 'paused', reason: 'anchor-unresolved' };
    if (!simulation && !sessionAlive) return { status: 'unknown', reason: 'session-stopped' };
    if (!simulation && !consolidated) return { status: 'unknown', reason: 'unconsolidated' };
    const expiry = expiryState(definition);
    if (!expiry.known) return { status: 'unknown', reason: 'expiry-clock-unknown' };
    if (expiry.expired) return { status: 'expired', reason: 'expired' };
    if (evaluation.needsActivation) return { status: 'unknown', reason: 'awaiting-activation' };
    return { status: 'active', reason: evaluation.skippedReason ?? null };
  }

  function refreshStatus(record) {
    const next = computeStatus(record);
    const changed = next.status !== record.evaluation.status || next.reason !== record.evaluation.reason;
    record.evaluation.status = next.status;
    record.evaluation.reason = next.reason;
    return changed;
  }

  function refreshAndEmit(record, force = false) {
    if (refreshStatus(record) || force) {
      emit({
        type: 'alert-state',
        alertId: record.definition.id,
        revision: record.definition.revision,
        status: record.evaluation.status,
        reason: record.evaluation.reason,
        sourceError: record.evaluation.sourceError
      });
    }
  }

  function evaluationAllowed(record) {
    const evaluation = record.evaluation;
    const definition = record.definition;
    if (definition.authority !== 'local') return false;
    if (evaluation.completed) return false;
    if (evaluation.pauseCause === 'user') return false;
    if (evaluation.geometryMissing) return false;
    if (evaluation.sourceError) return false;
    if (evaluation.errorState === 'version-conflict') return false;
    if (evaluation.inconsistent) return false;
    if (!simulation && !sessionAlive) return false;
    if (!simulation && !consolidated) return false;
    const expiry = expiryState(definition);
    if (!expiry.known || expiry.expired) return false;
    return true;
  }

  function createRecord(definition, { needsActivation = false, events = [], eventsById = new Map() } = {}) {
    const record = {
      definition,
      evaluation: {
        status: 'active',
        reason: null,
        initialized: false,
        armed: false,
        side: null,
        lastD: null,
        quietInit: false,
        lastVersion: null,
        lastBarId: null,
        completed: false,
        geometryMissing: false,
        pauseCause: null,
        skippedReason: null,
        errorState: null,
        inconsistent: false,
        blockedStreams: new Map(),
        needsActivation,
        events,
        eventsById
      },
      delivery: { status: 'unavailable', error: null },
      backend: {
        syncState: 'unconfirmed',
        confirmedRevision: null,
        confirmedStatus: null,
        error: null,
        confirmationError: null,
        requestId: null,
        pending: null
      }
    };
    if (definition.authority === 'local') {
      const block = blockFor(record);
      if (block) record.evaluation.sourceError = block.reason;
    }
    refreshStatus(record);
    return record;
  }

  function register(record) {
    records.set(record.definition.id, record);
    for (const source of [record.definition.left, record.definition.right]) {
      if (source.kind === 'series' || source.kind === 'indicator') {
        const key = sourceKey(source);
        if (!keyIndex.has(key)) keyIndex.set(key, new Set());
        keyIndex.get(key).add(record);
      }
      if (isInclinedDrawing(source)) barWatchers.add(record);
    }
  }

  function unregister(record) {
    records.delete(record.definition.id);
    for (const set of keyIndex.values()) set.delete(record);
    barWatchers.delete(record);
    for (const [key, set] of keyIndex) if (set.size === 0) keyIndex.delete(key);
  }

  function view(record) {
    const definition = record.definition;
    const evaluation = record.evaluation;
    return deepFreeze({
      id: definition.id,
      revision: definition.revision,
      definition,
      authority: definition.authority,
      evaluation: {
        status: evaluation.status,
        reason: evaluation.reason,
        initialized: evaluation.initialized,
        armed: evaluation.armed,
        completed: evaluation.completed,
        pauseCause: evaluation.pauseCause,
        skippedReason: evaluation.skippedReason,
        sourceError: evaluation.sourceError,
        lastBarId: evaluation.lastBarId,
        observationVersion: evaluation.lastVersion,
        eventCount: evaluation.events.length
      },
      delivery: { ...record.delivery },
      events: [...evaluation.events],
      backend: definition.authority === 'backend' ? {
        syncState: record.backend.syncState,
        confirmedRevision: record.backend.confirmedRevision,
        confirmedStatus: record.backend.confirmedStatus,
        requestId: record.backend.requestId,
        error: record.backend.error,
        confirmationError: record.backend.confirmationError
      } : null
    });
  }

  function requireRecord(id) {
    const record = records.get(id);
    if (!record) {
      throw new AlertError(ALERT_ERROR_CODES.ALERT_NOT_FOUND, 'alert operation: alert was not found', [], { alertId: id });
    }
    return record;
  }

  function requireLocalRecord(id, operation) {
    const record = requireRecord(id);
    if (record.definition.authority !== 'local') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, `${operation}: the alert is owned by the backend`, [
        { path: 'authority', message: 'use the backend adapter methods for a backend-owned alert' }
      ], { alertId: id });
    }
    return record;
  }

  function requireRevision(record, expectedRevision, operation) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, `${operation}: expectedRevision must be a positive integer`, [
        { path: 'expectedRevision', message: 'must be a positive integer' }
      ]);
    }
    if (record.definition.revision !== expectedRevision) {
      throw new AlertError(
        ALERT_ERROR_CODES.REVISION_CONFLICT,
        `${operation}: the definition changed since it was read`,
        [{ path: 'expectedRevision', message: `does not match the current revision ${record.definition.revision}` }],
        { alertId: record.definition.id, expectedRevision, currentRevision: record.definition.revision }
      );
    }
  }

  function sourceMatches(ref, source) {
    if (!isPlainObject(ref) || source.kind !== ref.kind) return false;
    if (ref.chartId != null && source.chartId != null && ref.chartId !== source.chartId) return false;
    if (ref.kind === 'series') return source.seriesId === ref.seriesId && (ref.field === undefined || source.field === ref.field);
    if (ref.kind === 'indicator') {
      return source.indicatorId === ref.indicatorId &&
        (ref.output === undefined || source.output === ref.output) &&
        (ref.semanticVersion === undefined || source.semanticVersion === ref.semanticVersion) &&
        (ref.params === undefined || stableStringify(source.params) === stableStringify(ref.params));
    }
    if (ref.kind === 'drawing') return (ref.drawingId === undefined || source.drawingId === ref.drawingId) &&
      (ref.drawingType === undefined || source.drawingType === ref.drawingType);
    return true;
  }

  function recordUsesRef(record, ref) {
    return sourceMatches(ref, record.definition.left) || sourceMatches(ref, record.definition.right);
  }

  function blockFor(record) {
    for (const block of blockedSources) if (recordUsesRef(record, block.ref)) return block;
    return null;
  }

  function checkRef(ref, operation) {
    if (!isPlainObject(ref) || typeof ref.kind !== 'string') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, `${operation}: source reference must be an object with a kind`, [
        { path: 'ref.kind', message: 'must identify a series, indicator, drawing, or constant source' }
      ]);
    }
  }

  function markSourceRemoved(ref, reason = 'source-removed') {
    checkRef(ref, 'markSourceRemoved');
    blockedSources.push({ ref: cloneJson(ref), reason });
    for (const record of records.values()) {
      if (record.definition.authority !== 'local') continue;
      if (recordUsesRef(record, ref)) {
        const nextReason = blockFor(record).reason;
        const changed = record.evaluation.sourceError !== nextReason;
        record.evaluation.sourceError = nextReason;
        resetContinuity(record);
        refreshAndEmit(record, changed);
      }
    }
    return { blocked: blockedSources.length };
  }

  function markSourceAvailable(ref) {
    checkRef(ref, 'markSourceAvailable');
    const serialized = stableStringify(ref);
    for (let i = blockedSources.length - 1; i >= 0; i -= 1) {
      if (stableStringify(blockedSources[i].ref) === serialized) blockedSources.splice(i, 1);
    }
    for (const record of records.values()) {
      if (record.definition.authority !== 'local') continue;
      if (!record.evaluation.sourceError) continue;
      const nextReason = blockFor(record)?.reason ?? null;
      if (record.evaluation.sourceError !== nextReason) {
        record.evaluation.sourceError = nextReason;
        resetContinuity(record);
        refreshAndEmit(record, true);
      }
    }
    return { blocked: blockedSources.length };
  }

  function setSourceAvailable(ref, available, reason = 'source-removed') {
    return available ? markSourceAvailable(ref) : markSourceRemoved(ref, reason);
  }

  function setGeometryResolved(id, resolved) {
    const record = requireLocalRecord(id, 'setGeometryResolved');
    if (typeof resolved !== 'boolean') throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'setGeometryResolved: resolved must be boolean');
    const missing = !resolved;
    if (record.evaluation.geometryMissing === missing) return view(record);
    record.evaluation.geometryMissing = missing;
    if (resolved && record.evaluation.pauseCause === 'geometry') record.evaluation.pauseCause = null;
    resetContinuity(record);
    refreshAndEmit(record);
    return view(record);
  }

  // ---- evaluation ---------------------------------------------------------

  function canonicalObservation(observation) {
    return stableStringify(observation);
  }

  function resolveSide(source, observation, values) {
    if (source.kind === 'constant') return { status: 'ok', value: source.value };
    if (source.kind === 'drawing') {
      if (source.drawingType === 'horizontal') return { status: 'ok', value: source.price };
      if (observation.barId === null) return { status: 'unsupported', reason: 'inclined-drawing-requires-bar' };
      if (typeof resolveBarIndex !== 'function') return { status: 'anchor-unresolved', reason: 'bar-unresolved' };
      let index;
      try {
        index = resolveBarIndex(observation.barId, source.chartId ?? undefined);
        if (!Number.isFinite(index)) return { status: 'anchor-unresolved', reason: 'bar-unresolved' };
        if (observation.index !== null && observation.index !== index) {
          return { status: 'error', reason: 'bar-resolution-conflict', message: 'observed index does not match bar identity' };
        }
      } catch (error) {
        return { status: 'error', reason: 'bar-resolution-failed', message: errorText(error) };
      }
      try {
        const threshold = resolveDrawingThreshold(source, index, resolveBarIndex);
        if (threshold.status === 'unresolved') return { status: 'anchor-unresolved', reason: 'anchor-unresolved' };
        if (threshold.status === 'out-of-range') return { status: 'out-of-area' };
        return { status: 'ok', value: threshold.threshold };
      } catch (error) {
        if (error instanceof AlertError) return { status: 'error', reason: 'invalid-geometry', message: error.message };
        throw error;
      }
    }
    const key = sourceKey(source);
    if (!Object.prototype.hasOwnProperty.call(values, key)) return { status: 'missing' };
    const value = values[key];
    if (value === null || value === undefined) return { status: 'missing' };
    return { status: 'ok', value };
  }

  function runtimeFailure(record, reason, message) {
    resetContinuity(record);
    record.evaluation.errorState = reason;
    emit({
      type: 'alert-error',
      alertId: record.definition.id,
      revision: record.definition.revision,
      code: reason,
      message
    });
    refreshAndEmit(record);
  }

  function skipEvaluation(record, reason) {
    resetContinuity(record);
    record.evaluation.skippedReason = reason;
    refreshAndEmit(record);
  }

  function buildLocalEvent(record, observation, left, right, d, transition) {
    const definition = record.definition;
    const streamPart = observation.stream === null ? '' : `:${encodeURIComponent(stableStringify(observation.stream))}`;
    const eventId = `alert:${encodeURIComponent(definition.id)}:${definition.revision}${streamPart}:${encodeURIComponent(observation.version)}:${transition}`;
    const event = {
      eventId,
      alertId: definition.id,
      revision: definition.revision,
      authority: 'local',
      operation: definition.operation,
      observationMode: definition.observationMode,
      observationVersion: observation.version,
      transition,
      left,
      right,
      d,
      sources: { left: sourceKey(definition.left), right: sourceKey(definition.right) },
      simulated: simulation,
      delivery: { status: 'pending', error: null }
    };
    if (observation.stream !== null) event.stream = observation.stream;
    if (observation.barId !== null) {
      event.barId = observation.barId;
      event.state = observation.state;
    }
    if (observation.time !== null) event.time = observation.time;
    return event;
  }

  function deliver(record, event) {
    if (simulation) {
      const delivery = { status: 'simulated', error: null };
      record.delivery = delivery;
      return delivery;
    }
    if (notify === null) {
      const delivery = { status: 'unavailable', error: null };
      record.delivery = delivery;
      return delivery;
    }
    let result;
    try {
      result = notify(event);
    } catch (error) {
      const delivery = { status: 'failed', error: errorText(error) };
      record.delivery = delivery;
      return delivery;
    }
    const normalized = normalizeDelivery(result);
    const delivery = normalized ?? { status: 'unknown', error: null };
    record.delivery = { ...delivery };
    return delivery;
  }

  function fire(record, observation, left, right, d, previousSide, summary) {
    const definition = record.definition;
    const evaluation = record.evaluation;
    const target = definition.operation === 'above' || definition.operation === 'crossUp' ? 'positive' : 'negative';
    const transition = `${definition.operation}:${previousSide ?? 'init'}->${target}`;
    const event = buildLocalEvent(record, observation, left, right, d, transition);
    const content = stableStringify({ ...event, delivery: undefined });
    const prior = evaluation.eventsById.get(event.eventId);
    if (prior !== undefined) {
      if (prior !== content) runtimeFailure(record, 'version-conflict', 'the same event identity was produced with different content');
      return null;
    }
    if (definition.mode === 'once') evaluation.completed = true;
    evaluation.armed = false;
    const delivery = deliver(record, event);
    event.delivery = delivery;
    deepFreeze(event);
    evaluation.eventsById.set(event.eventId, content);
    evaluation.events.push(event);
    emit({
      type: 'alert-event',
      alertId: definition.id,
      revision: definition.revision,
      event
    });
    summary.eventIds.push(event.eventId);
    return event;
  }

  function applyObservation(record, d) {
    const definition = record.definition;
    const evaluation = record.evaluation;
    const hysteresis = definition.hysteresis;
    const operation = definition.operation;
    const isUp = operation === 'above' || operation === 'crossUp';
    const isTrue = isUp ? d > 0 : d < 0;
    const rearm = isUp ? d <= -hysteresis : d >= hysteresis;

    if (!evaluation.initialized) {
      const quiet = evaluation.quietInit;
      evaluation.initialized = true;
      evaluation.quietInit = false;
      evaluation.side = sideOf(d);
      evaluation.lastD = d;
      if (operation === 'above' || operation === 'below') {
        if (isTrue && !quiet) {
          evaluation.armed = false;
          return true;
        }
        evaluation.armed = isTrue ? false : rearm;
        return false;
      }
      if (isTrue) {
        evaluation.armed = false;
        return false;
      }
      evaluation.armed = operation === 'crossUp' ? d <= 0 : d >= 0;
      return false;
    }

    let fired = false;
    if (isTrue) {
      if (evaluation.armed) {
        fired = true;
        evaluation.armed = false;
      }
    } else if (!evaluation.armed && rearm) {
      evaluation.armed = true;
    }
    evaluation.side = sideOf(d);
    evaluation.lastD = d;
    return fired;
  }

  function evaluateValues(record, observation, summary) {
    const definition = record.definition;
    const evaluation = record.evaluation;
    if (evaluation.errorState && evaluation.errorState !== 'version-conflict') evaluation.errorState = null;

    if (observation.barId === null) {
      const leftDynamic = !sourceIsLevel(definition.left);
      const rightDynamic = !sourceIsLevel(definition.right);
      if (isInclinedDrawing(definition.left) || isInclinedDrawing(definition.right)) {
        skipEvaluation(record, 'inclined-drawing-requires-bar');
        return;
      }
      if (leftDynamic && rightDynamic) {
        skipEvaluation(record, 'stream-comparison-requires-bar');
        return;
      }
    }

    const values = observation.values ?? Object.create(null);
    const leftResult = resolveSide(definition.left, observation, values);
    const rightResult = resolveSide(definition.right, observation, values);
    for (const result of [leftResult, rightResult]) {
      if (result.status === 'error') {
        runtimeFailure(record, result.reason, result.message ?? 'source resolution failed');
        return;
      }
      if (result.status === 'anchor-unresolved') {
        evaluation.pauseCause = 'geometry';
        resetContinuity(record);
        evaluation.skippedReason = 'anchor-unresolved';
        refreshAndEmit(record);
        return;
      }
      if (result.status === 'out-of-area') {
        if (evaluation.pauseCause === 'geometry') evaluation.pauseCause = null;
        skipEvaluation(record, 'out-of-area');
        return;
      }
      if (result.status === 'unsupported') {
        skipEvaluation(record, result.reason);
        return;
      }
      if (result.status === 'missing') {
        skipEvaluation(record, 'missing-value');
        return;
      }
    }

    const left = leftResult.value;
    const right = rightResult.value;
    if (isLogDrawing(definition.left) && !(right > 0)) {
      runtimeFailure(record, 'invalid-log-value', 'the observed value must be strictly positive for a log drawing');
      return;
    }
    if (isLogDrawing(definition.right) && !(left > 0)) {
      runtimeFailure(record, 'invalid-log-value', 'the observed value must be strictly positive for a log drawing');
      return;
    }
    const d = left - right;
    if (!Number.isFinite(d)) {
      runtimeFailure(record, 'non-finite-result', 'the subtraction result is not finite');
      return;
    }

    evaluation.pauseCause = null;
    evaluation.skippedReason = null;
    evaluation.lastBarId = observation.barId;
    const previousSide = evaluation.side;
    const fired = applyObservation(record, d);
    if (fired) fire(record, observation, left, right, d, previousSide, summary);
  }

  function streamKey(stream) {
    return stream === null ? '' : stableStringify(stream);
  }

  function streamState(stream) {
    const key = streamKey(stream);
    let state = streams.get(key);
    if (!state) {
      state = { key, identity: stream, lastVersion: null, versions: new Map(), records: new Set(), pendingInit: new Set(), inconsistent: false };
      streams.set(key, state);
    }
    return state;
  }

  function interruptStream(state, candidates, reason) {
    const alreadyInconsistent = state.inconsistent;
    state.inconsistent = true;
    needsSnapshot = true;
    for (const record of candidates) state.records.add(record.definition.id);
    for (const id of state.records) {
      const record = records.get(id);
      if (!record || record.definition.authority !== 'local') continue;
      const evaluation = record.evaluation;
      if (record.evaluation.blockedStreams.has(state.key)) continue;
      evaluation.blockedStreams.set(state.key, reason);
      evaluation.inconsistent = true;
      if (reason === 'version-conflict') evaluation.errorState = reason;
      resetContinuity(record);
      emit({
        type: 'alert-error',
        alertId: id,
        revision: record.definition.revision,
        code: reason,
        message: reason === 'version-conflict'
          ? 'the same observation version was delivered with different content'
          : 'the observation stream requires a confirmed snapshot'
      });
      refreshAndEmit(record);
    }
    if (!alreadyInconsistent && options.requestSnapshot) options.requestSnapshot(reason === 'gap' ? 'gap' : 'version-gap', state.identity);
  }

  function applyObservationToRecord(record, observation, summary) {
    const evaluation = record.evaluation;
    evaluation.lastVersion = observation.version;
    evaluation.needsActivation = false;
    if (observation.snapshot) {
      if (observation.values) evaluateValues(record, observation, summary);
      return;
    }
    if (observation.correct) {
      resetContinuity(record, { clearVersion: false });
      evaluation.skippedReason = 'corrected';
      refreshAndEmit(record);
      return;
    }
    if (observation.barId !== null && record.definition.observationMode === 'closed' && observation.state !== 'closed') {
      evaluation.skippedReason = 'awaiting-close';
      refreshAndEmit(record);
      return;
    }
    if (observation.error) {
      resetContinuity(record, { clearVersion: false });
      evaluation.errorState = 'source-error';
      emit({
        type: 'alert-error',
        alertId: record.definition.id,
        revision: record.definition.revision,
        code: 'source-error',
        message: 'the host reported a source error'
      });
      refreshAndEmit(record);
      return;
    }
    evaluateValues(record, observation, summary);
  }

  function candidateRecords(observation, state) {
    const selected = new Set();
    const all = observation.stream === null &&
      (observation.snapshot || observation.gap || observation.correct || (observation.error && !observation.error.sourceKey));
    if (all) {
      for (const record of records.values()) if (record.definition.authority === 'local') selected.add(record);
      return selected;
    }
    const keys = new Set(Object.keys(observation.values ?? {}));
    if (observation.error?.sourceKey) keys.add(observation.error.sourceKey);
    for (const key of keys) {
      const set = keyIndex.get(key);
      if (set) for (const record of set) if (record.definition.authority === 'local') selected.add(record);
    }
    if (observation.barId !== null && !observation.error && keys.size === 0) {
      for (const id of state.records) {
        const record = records.get(id);
        if (record?.definition.authority === 'local') selected.add(record);
      }
    }
    if (observation.barId !== null) {
      for (const record of barWatchers) if (record.definition.authority === 'local') selected.add(record);
    }
    return selected;
  }

  function processRecord(record, observation, summary) {
    if (!evaluationAllowed(record)) return false;
    applyObservationToRecord(record, observation, summary);
    refreshAndEmit(record);
    return true;
  }

  // ---- public operations --------------------------------------------------

  function add(definition) {
    if (isPlainObject(definition) && definition.revision !== undefined && definition.revision !== 1) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'add: a new alert must start at revision 1', [
        { path: 'revision', message: 'must be 1 for a new alert' }
      ]);
    }
    const normalized = validateAlertDefinition({ ...definition, revision: 1 }, validationCtx);
    if (records.has(normalized.id)) {
      throw new AlertError(ALERT_ERROR_CODES.ALERT_EXISTS, 'add: an alert with this id already exists', [
        { path: 'id', message: 'must be unique' }
      ], { alertId: normalized.id });
    }
    const record = createRecord(normalized);
    register(record);
    refreshAndEmit(record);
    emit({ type: 'alert-added', alertId: normalized.id, revision: normalized.revision });
    return view(record);
  }

  function get(id) {
    const record = requireRecord(id);
    refreshStatus(record);
    return view(record);
  }

  function list() {
    return [...records.values()].map(record => {
      refreshStatus(record);
      return view(record);
    });
  }

  function prepareUpdate(id, patch, expectedRevision) {
    const record = requireLocalRecord(id, 'update');
    requireRevision(record, expectedRevision, 'update');
    if (!isPlainObject(patch)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'update: patch must be an object', [
        { path: 'patch', message: 'must be an object' }
      ]);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'revision')) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'update: revision is managed by the engine', [
        { path: 'revision', message: 'must not be supplied in a patch' }
      ]);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'id') && patch.id !== id) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'update: the alert id cannot change', [
        { path: 'id', message: 'must match the alert being updated' }
      ]);
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'authority') && patch.authority !== record.definition.authority) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'update: the alert authority cannot change', [
        { path: 'authority', message: 'must match the existing authority' }
      ]);
    }
    const candidate = validateAlertDefinition(
      { ...record.definition, ...patch, id, revision: record.definition.revision + 1 },
      validationCtx
    );
    return { record, candidate, expectedRevision };
  }

  function commitUpdates(prepared) {
    for (const { record, expectedRevision } of prepared) {
      if (records.get(record.definition.id) !== record) {
        throw new AlertError(ALERT_ERROR_CODES.ALERT_NOT_FOUND, 'update: alert was removed before commit');
      }
      requireRevision(record, expectedRevision, 'update');
    }
    for (const { record, candidate } of prepared) {
      const id = record.definition.id;
      const sourcesChanged = sourceKey(record.definition.left) !== sourceKey(candidate.left) ||
        sourceKey(record.definition.right) !== sourceKey(candidate.right);
      const blockedStreams = record.evaluation.blockedStreams;
      unregister(record);
      record.definition = candidate;
      record.evaluation = {
        ...createRecord(candidate).evaluation,
        events: record.evaluation.events,
        eventsById: record.evaluation.eventsById
      };
      record.evaluation.quietInit = true;
      if (!sourcesChanged) {
        record.evaluation.blockedStreams = blockedStreams;
        record.evaluation.inconsistent = blockedStreams.size > 0;
        if ([...blockedStreams.values()].includes('version-conflict')) record.evaluation.errorState = 'version-conflict';
      } else {
        for (const state of streams.values()) state.records.delete(id);
      }
      register(record);
      record.delivery = { status: 'unavailable', error: null };
    }
    for (const { record, candidate } of prepared) {
      refreshAndEmit(record);
      emit({ type: 'alert-updated', alertId: candidate.id, revision: candidate.revision });
    }
    return prepared.map(({ record }) => view(record));
  }

  function prepareUpdates(updates) {
    if (!Array.isArray(updates)) throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'prepareUpdates: updates must be an array');
    const seen = new Set();
    const prepared = updates.map(({ id, patch, expectedRevision }) => {
      if (seen.has(id)) throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'prepareUpdates: duplicate alert id');
      seen.add(id);
      return prepareUpdate(id, patch, expectedRevision);
    });
    let active = true;
    return { commit() {
      if (!active) throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, 'prepared updates were already committed');
      active = false;
      return commitUpdates(prepared);
    } };
  }

  function update(id, patch, expectedRevision) {
    return commitUpdates([prepareUpdate(id, patch, expectedRevision)])[0];
  }

  function pause(id, expectedRevision) {
    const record = requireLocalRecord(id, 'pause');
    requireRevision(record, expectedRevision, 'pause');
    if (record.evaluation.status === 'completed') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, 'pause: a completed alert cannot be paused', [
        { path: 'state', message: 'the alert is completed' }
      ]);
    }
    if (record.evaluation.pauseCause !== null) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, 'pause: the alert is already paused', [
        { path: 'state', message: 'the alert is already paused' }
      ]);
    }
    record.evaluation.pauseCause = 'user';
    resetContinuity(record);
    refreshAndEmit(record);
    emit({ type: 'alert-paused', alertId: id, revision: record.definition.revision });
    return view(record);
  }

  function resume(id, expectedRevision) {
    const record = requireLocalRecord(id, 'resume');
    requireRevision(record, expectedRevision, 'resume');
    if (record.evaluation.pauseCause !== 'user') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, 'resume: the alert is not paused by the user', [
        { path: 'state', message: 'the alert is not in a user pause' }
      ]);
    }
    record.evaluation.pauseCause = null;
    resetContinuity(record);
    record.evaluation.lastVersion = null;
    refreshAndEmit(record);
    emit({ type: 'alert-resumed', alertId: id, revision: record.definition.revision });
    return view(record);
  }

  function remove(id) {
    const record = requireLocalRecord(id, 'remove');
    unregister(record);
    for (const state of streams.values()) state.records.delete(id);
    for (const state of streams.values()) state.pendingInit.delete(id);
    retired.set(id, record);
    emit({ type: 'alert-removed', alertId: id, revision: record.definition.revision });
    return { removed: true, alertId: id };
  }

  function getRetired(id) {
    const record = retired.get(id);
    if (!record) {
      throw new AlertError(ALERT_ERROR_CODES.ALERT_NOT_FOUND, 'getRetired: no removed alert was found', [], { alertId: id });
    }
    return view(record);
  }

  function events(alertId) {
    const record = records.get(alertId) ?? retired.get(alertId);
    return record ? [...record.evaluation.events] : [];
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'subscribe: listener must be a function', [
        { path: 'listener', message: 'must be a function' }
      ]);
    }
    listeners.add(listener);
    return once(() => listeners.delete(listener));
  }

  function observe(input) {
    const observation = validateObservation(input);
    const summary = { evaluated: 0, skipped: 0, eventIds: [] };
    if (!sessionAlive && !simulation) {
      summary.skipped = records.size;
      return summary;
    }
    if (observation.snapshot) {
      confirmSnapshot({
        ...(observation.stream === null ? {} : { stream: observation.stream }),
        version: observation.version, values: observation.values,
        barId: observation.barId, time: observation.time, state: observation.state, index: observation.index
      });
      return summary;
    }
    if (!simulation && !consolidated) {
      summary.skipped = records.size;
      return summary;
    }
    const state = streamState(observation.stream);
    const candidates = candidateRecords(observation, state);
    if (state.inconsistent) {
      interruptStream(state, candidates, state.reason);
      summary.skipped = candidates.size;
      return summary;
    }
    const canonical = canonicalObservation(observation);
    const seen = state.versions.get(observation.version);
    if (seen !== undefined) {
      if (seen !== canonical) {
        state.reason = 'version-conflict';
        interruptStream(state, candidates, state.reason);
      }
      return summary;
    }
    if (state.lastVersion === observation.version) return summary;
    if (observation.gap ||
        (observation.stream !== null && state.lastVersion === null) ||
        (state.lastVersion !== null && observation.prevVersion !== null && observation.prevVersion !== state.lastVersion) ||
        (observation.stream !== null && state.lastVersion !== null && observation.prevVersion === null)) {
      state.reason = observation.gap ? 'gap' : 'version-gap';
      interruptStream(state, candidates, state.reason);
      summary.skipped = candidates.size;
      return summary;
    }
    state.versions.set(observation.version, canonical);
    state.lastVersion = observation.version;
    if (observation.barId !== null && !observation.error && Object.keys(observation.values ?? {}).length === 0) {
      for (const record of records.values()) {
        if (record.definition.authority === 'local' &&
            (observation.state === 'closed' || record.definition.observationMode === 'partial')) {
          state.pendingInit.add(record.definition.id);
        }
      }
    }
    for (const record of candidates) {
      if (state.pendingInit.delete(record.definition.id)) resetContinuity(record);
      state.records.add(record.definition.id);
      if (processRecord(record, observation, summary)) summary.evaluated += 1;
      else summary.skipped += 1;
    }
    return summary;
  }

  function confirmSnapshot(input = {}) {
    if (!isPlainObject(input)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'confirmSnapshot: snapshot must be an object');
    }
    const fields = [];
    checkKeys(input, ['stream', 'version', 'values', 'barId', 'time', 'state', 'index'], '', (path, message) => fields.push({ path, message }));
    if (typeof input.version !== 'string' || input.version.length === 0) {
      fields.push({ path: 'version', message: 'must be a non-empty confirmed stream boundary' });
    }
    if (fields.length > 0) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'confirmSnapshot: invalid reconciliation snapshot', fields);
    }
    const observation = validateObservation({
      ...(input.stream === undefined ? {} : { stream: input.stream }),
      version: input.version,
      state: input.state ?? 'closed',
      barId: input.barId,
      time: input.time,
      index: input.index,
      values: input.values,
      snapshot: true
    });
    const state = streamState(observation.stream);
    const candidates = candidateRecords(observation, state);
    for (const record of candidates) state.records.add(record.definition.id);
    state.lastVersion = observation.version;
    state.pendingInit = new Set([...records.values()]
      .filter(record => record.definition.authority === 'local')
      .map(record => record.definition.id));
    state.inconsistent = false;
    state.reason = null;
    needsSnapshot = [...streams.values()].some(stream => stream.inconsistent);
    if (!needsSnapshot) consolidated = true;
    for (const id of state.records) {
      const record = records.get(id);
      if (!record || record.definition.authority !== 'local') continue;
      const evaluation = record.evaluation;
      evaluation.blockedStreams.delete(state.key);
      evaluation.inconsistent = evaluation.blockedStreams.size > 0;
      if (evaluation.errorState === 'version-conflict') {
        evaluation.errorState = [...evaluation.blockedStreams.values()].includes('version-conflict') ? 'version-conflict' : null;
      } else if (!evaluation.inconsistent) {
        evaluation.errorState = null;
      }
      evaluation.needsActivation = false;
      resetContinuity(record);
      evaluation.lastVersion = observation.version;
      refreshAndEmit(record);
    }
    if (observation.values) {
      const summary = { evaluated: 0, skipped: 0, eventIds: [] };
      for (const record of candidates) {
        state.pendingInit.delete(record.definition.id);
        processRecord(record, observation, summary);
      }
    }
    emit({ type: 'session-reconciled', version: input.version, stream: observation.stream });
    return getSession();
  }

  function disconnect(reason = 'source-disconnected') {
    consolidated = false;
    needsSnapshot = true;
    for (const state of streams.values()) {
      state.inconsistent = true;
      state.reason = 'version-gap';
    }
    for (const record of records.values()) {
      if (record.definition.authority !== 'local') continue;
      record.evaluation.inconsistent = false;
      record.evaluation.errorState = null;
      resetContinuity(record);
      refreshAndEmit(record);
    }
    emit({ type: 'session-disconnected', reason });
    return getSession();
  }

  function disconnectStream(stream) {
    const observation = validateObservation({ stream, version: 'validation', values: {} });
    if (observation.stream === null) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'disconnectStream: a scoped stream is required');
    }
    const state = streamState(observation.stream);
    state.reason = 'gap';
    interruptStream(state, new Set(), 'gap');
    emit({ type: 'stream-disconnected', stream: observation.stream });
    return getSession();
  }

  function reconnect() {
    return getSession();
  }

  function stopSession() {
    sessionAlive = false;
    for (const record of records.values()) {
      if (record.definition.authority !== 'local') continue;
      resetContinuity(record);
      refreshAndEmit(record);
    }
    emit({ type: 'session-stopped' });
    return getSession();
  }

  function startSession() {
    sessionAlive = true;
    consolidated = false;
    needsSnapshot = true;
    for (const state of streams.values()) {
      state.inconsistent = true;
      state.reason = 'version-gap';
    }
    for (const record of records.values()) {
      if (record.definition.authority !== 'local') continue;
      record.evaluation.inconsistent = false;
      record.evaluation.errorState = null;
      resetContinuity(record);
      refreshAndEmit(record);
    }
    emit({ type: 'session-started' });
    return getSession();
  }

  function setSimulation(value) {
    simulation = value === true;
    for (const record of records.values()) refreshAndEmit(record);
    return simulation;
  }

  function getSession() {
    return deepFreeze({
      alive: sessionAlive,
      consolidated,
      needsSnapshot,
      simulation,
      clock: clock !== null,
      lastClockError
    });
  }

  function exportDefinitions() {
    return deepFreeze({
      schemaVersion: ALERT_SCHEMA_VERSION,
      definitions: [...records.values()].map(record => exportDefinition(record.definition))
    });
  }

  function importDefinitions(document) {
    const normalized = validateDefinitionsDocument(document, validationCtx);
    const next = new Map();
    for (const definition of normalized.definitions) {
      const previous = records.get(definition.id);
      const keepEvents = previous && previous.definition.revision === definition.revision;
      next.set(definition.id, createRecord(definition, {
        needsActivation: definition.authority === 'local',
        events: keepEvents ? previous.evaluation.events : [],
        eventsById: keepEvents ? previous.evaluation.eventsById : new Map()
      }));
    }
    for (const record of [...records.values()]) unregister(record);
    records = next;
    for (const record of records.values()) register(record);
    emit({ type: 'alerts-imported', count: records.size });
    return { imported: records.size };
  }

  // ---- backend adapter ----------------------------------------------------

  /**
   * A backend confirmation is only authoritative when it names the concrete
   * formula, params, output, and semantic version of every indicator source in
   * the revision. A matching indicator id alone is never treated as proof that
   * the backend evaluates the same graph.
   */
  function indicatorConfirmation(def, result) {
    const sources = [];
    for (const side of ['left', 'right']) {
      if (def[side].kind === 'indicator') sources.push({ path: side, source: def[side] });
    }
    if (sources.length === 0) return null;
    const entries = Array.isArray(result.confirmation?.indicators) ? result.confirmation.indicators : null;
    if (!entries) {
      return {
        path: `${sources[0].path}.semanticVersion`,
        message: 'backend confirmation must include formula, params, output, and semanticVersion for each indicator source'
      };
    }
    const used = new Set();
    for (const { path, source } of sources) {
      const index = entries.findIndex((entry, entryIndex) => {
        if (used.has(entryIndex) || !isPlainObject(entry)) return false;
        return entry.formula === source.formula &&
          entry.output === source.output &&
          entry.semanticVersion === source.semanticVersion &&
          stableStringify(entry.params) === stableStringify(source.params);
      });
      if (index === -1) {
        return {
          path: `${path}.semanticVersion`,
          message: 'backend indicator confirmation does not match formula, params, output, and semanticVersion'
        };
      }
      used.add(index);
    }
    return null;
  }

  function normalizeConfirmed(record, definition, result, expectedRevision, { requireAdvance = true, requireMatch = false } = {}) {
    if (typeof result.alertId !== 'string' || result.alertId.length === 0) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend confirmation: alertId is required');
    }
    if (!Number.isSafeInteger(result.revision) || result.revision < 1) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend confirmation: revision must be a positive integer');
    }
    if (!BACKEND_STATUSES.includes(result.status)) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend confirmation: status is not a known evaluation status');
    }
    if (expectedRevision !== null) {
      const stale = requireAdvance ? result.revision <= expectedRevision : result.revision < expectedRevision;
      if (stale) {
        throw new AlertError(
          ALERT_ERROR_CODES.BACKEND_REJECTED,
          requireAdvance
            ? 'backend confirmation: revision did not advance'
            : 'backend confirmation: revision went backwards'
        );
      }
    }
    const confirmed = validateAlertDefinition(
      { ...definition, ...(result.definition ?? {}), id: definition.id, revision: result.revision, authority: 'backend' },
      validationCtx
    );
    if (requireMatch) {
      const requested = validateAlertDefinition({ ...definition, revision: result.revision }, validationCtx);
      if (stableStringify(confirmed) !== stableStringify(requested)) {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend confirmation: definition differs from the requested revision');
      }
    }
    if (record.evaluation.completed && record.definition.revision === result.revision && result.status !== 'completed') {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend confirmation: a completed once revision cannot be reactivated');
    }
    if (record.definition.revision !== result.revision) record.evaluation.completed = false;
    const confirmationError = indicatorConfirmation(confirmed, result);
    record.definition = confirmed;
    record.backend.syncState = 'confirmed';
    record.backend.confirmedRevision = result.revision;
    record.backend.confirmedStatus = confirmationError ? 'error' : result.status;
    record.backend.requestId = result.requestId ?? record.backend.requestId;
    record.backend.error = confirmationError
      ? `indicator-confirmation: ${confirmationError.path}: ${confirmationError.message}`
      : null;
    record.backend.confirmationError = confirmationError;
    record.backend.pending = null;
    refreshAndEmit(record);
    return confirmed;
  }

  function backendUnknown(record, result, pending) {
    if (record) {
      record.backend.syncState = 'unknown';
      record.backend.error = errorText(result.error);
      record.backend.pending = pending;
      record.backend.requestId = result.requestId ?? record.backend.requestId;
      refreshAndEmit(record);
      emit({
        type: 'backend-sync',
        alertId: record.definition.id,
        revision: record.definition.revision,
        syncState: 'unknown',
        requestId: record.backend.requestId
      });
    }
    return {
      outcome: 'unknown',
      requestId: result.requestId ?? pending?.requestId ?? null,
      alertId: record?.definition.id ?? pending?.definition.id ?? null
    };
  }

  function rejection(result) {
    const fields = Array.isArray(result.error?.fields) ? result.error.fields : [];
    const reason = errorText(result.error?.message ?? result.error);
    return new AlertError(
      ALERT_ERROR_CODES.BACKEND_REJECTED,
      reason ? `backend rejected the alert operation: ${reason}` : 'backend rejected the alert operation',
      fields,
      { reason }
    );
  }

  function conflict(result, expectedRevision) {
    return new AlertError(
      ALERT_ERROR_CODES.REVISION_CONFLICT,
      'backend reported a revision conflict',
      [{ path: 'expectedRevision', message: 'does not match the backend revision' }],
      { expectedRevision, currentRevision: result.currentRevision ?? null }
    );
  }

  function setBackendAdapter(adapter) {
    if (adapter === null || adapter === undefined) {
      detachBackend();
      return { attached: false };
    }
    const fields = BACKEND_METHODS
      .filter(method => typeof adapter[method] !== 'function')
      .map(method => ({ path: method, message: 'adapter must provide this function' }));
    const idempotency = adapter.idempotency;
    if (!isPlainObject(idempotency) ||
        typeof idempotency.supported !== 'boolean' ||
        typeof idempotency.scope !== 'string' ||
        idempotency.scope.length === 0) {
      fields.push({
        path: 'idempotency',
        message: 'must explicitly report {supported: boolean, scope: non-empty string}'
      });
    }
    if (fields.length > 0) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ADAPTER, 'setBackendAdapter: adapter contract is incomplete', fields);
    }
    detachBackend();
    let unsubscribe;
    try {
      unsubscribe = adapter.subscribe(handleBackendMessage);
    } catch (error) {
      backendError = { code: 'BACKEND_SUBSCRIPTION', message: errorText(error) ?? 'backend subscription failed' };
      emit({ type: 'backend-error', error: backendError });
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ADAPTER, 'setBackendAdapter: subscription failed', [
        { path: 'subscribe', message: 'threw while subscribing' }
      ], { cause: error });
    }
    if (typeof unsubscribe !== 'function') {
      backendError = { code: 'BACKEND_SUBSCRIPTION', message: 'subscribe did not return an unsubscribe function' };
      emit({ type: 'backend-error', error: backendError });
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ADAPTER, 'setBackendAdapter: subscription failed', [
        { path: 'subscribe', message: 'must return an idempotent unsubscribe function' }
      ]);
    }
    backendAdapter = adapter;
    backendUnsubscribe = once(unsubscribe);
    backendIdempotency = { supported: adapter.idempotency.supported, scope: adapter.idempotency.scope };
    backendError = null;
    emit({ type: 'backend-attached' });
    return { attached: true };
  }

  function detachBackend() {
    if (!backendAdapter && !backendUnsubscribe) return;
    if (backendUnsubscribe) {
      try {
        backendUnsubscribe();
      } catch (error) {
        backendError = { code: 'BACKEND_UNSUBSCRIBE', message: errorText(error) };
      } finally {
        backendUnsubscribe = null;
      }
    }
    backendAdapter = null;
    backendIdempotency = null;
    for (const record of records.values()) {
      if (record.definition.authority !== 'backend') continue;
      record.backend.confirmedRevision = null;
      record.backend.confirmedStatus = null;
      record.backend.syncState = 'unconfirmed';
      refreshAndEmit(record);
    }
    emit({ type: 'backend-detached' });
  }

  function handleBackendStatus(message) {
    const record = requireRecord(message.alertId);
    if (record.definition.authority !== 'backend') {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend status: the alert is not owned by the backend');
    }
    if (!Number.isSafeInteger(message.revision) || message.revision < 1) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend status: revision must be a positive integer');
    }
    if (!BACKEND_STATUSES.includes(message.status)) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend status: unknown evaluation status');
    }
    if (record.evaluation.completed && record.definition.revision === message.revision && message.status !== 'completed') {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend status: a completed once revision cannot be reactivated');
    }
    if (record.backend.syncState !== 'confirmed' || record.definition.revision !== message.revision) {
      if (record.backend.syncState !== 'unknown') {
        backendUnknown(record, { error: 'status does not identify a confirmed definition' }, { type: 'read' });
      }
      return;
    }
    const sameConfirmedRevision = record.backend.confirmedRevision === message.revision &&
      record.backend.confirmedStatus !== null;
    record.backend.confirmedRevision = message.revision;
    record.backend.pending = null;
    record.backend.syncState = 'confirmed';
    const hasIndicator = record.definition.left.kind === 'indicator' || record.definition.right.kind === 'indicator';
    const stale = record.backend.confirmationError;
    if (hasIndicator && !(sameConfirmedRevision && stale === null)) {
      record.backend.confirmedStatus = 'error';
      record.backend.error = stale
        ? `indicator-confirmation: ${stale.path}: ${stale.message}`
        : 'indicator-confirmation: backend status did not confirm formula, params, and semanticVersion for this revision';
      if (!stale) {
        record.backend.confirmationError = {
          path: record.definition.left.kind === 'indicator' ? 'left.semanticVersion' : 'right.semanticVersion',
          message: 'backend status did not confirm indicator compatibility'
        };
      }
    } else {
      record.backend.confirmedStatus = message.status;
      record.backend.error = null;
      record.backend.confirmationError = null;
    }
    refreshAndEmit(record);
  }

  function handleBackendEvent(event) {
    if (!isPlainObject(event)) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: event must be an object');
    }
    if (typeof event.eventId !== 'string' || event.eventId.length === 0) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: eventId is required');
    }
    if (typeof event.alertId !== 'string' || event.alertId.length === 0) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: alertId is required');
    }
    if (!Number.isSafeInteger(event.revision) || event.revision < 1) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: revision must be a positive integer');
    }
    const content = stableStringify({ ...event, delivery: undefined });
    const prior = externalEvents.get(event.eventId);
    if (prior !== undefined) {
      if (prior !== content) {
        throw new AlertError(ALERT_ERROR_CODES.VERSION_CONFLICT, 'backend event: the same eventId was redelivered with different content');
      }
      const record = records.get(event.alertId);
      if (record && record.definition.revision === event.revision && event.delivery) {
        const delivery = normalizeDelivery(event.delivery);
        if (delivery && (delivery.status !== record.delivery.status || delivery.error !== record.delivery.error)) {
          record.delivery = delivery;
          emit({ type: 'alert-delivery', alertId: event.alertId, revision: event.revision, eventId: event.eventId, delivery: { ...delivery } });
        }
      }
      return;
    }
    const record = records.get(event.alertId);
    if (!record) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: the alert is unknown locally');
    }
    if (record.definition.authority !== 'backend') {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: the alert is owned by the local authority');
    }
    if (record.backend.confirmedRevision !== event.revision) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: the event revision is not the confirmed revision');
    }
    if (event.operation !== record.definition.operation || event.observationMode !== record.definition.observationMode ||
        typeof event.observationVersion !== 'string' || event.observationVersion.length === 0 ||
        !isPlainObject(event.sources) || event.sources.left !== sourceKey(record.definition.left) ||
        event.sources.right !== sourceKey(record.definition.right) ||
        !Number.isFinite(event.left) || !Number.isFinite(event.right) || !Number.isFinite(event.d) ||
        event.d !== event.left - event.right ||
        ((event.operation === 'above' || event.operation === 'crossUp') ? event.d <= 0 : event.d >= 0) ||
        event.simulated === true ||
        (event.barId !== undefined && (typeof event.barId !== 'string' || event.barId.length === 0)) ||
        (event.time !== undefined && (typeof event.time !== 'number' || !Number.isFinite(event.time) || Math.abs(event.time) > 8640000000000000))) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: source, observation, comparison or rule is invalid');
    }
    if (record.definition.mode === 'once' && record.evaluation.completed) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend event: once revision has already completed');
    }
    externalEvents.set(event.eventId, content);
    const stored = deepFreeze(cloneJson(event));
    record.evaluation.events.push(stored);
    if (event.delivery) {
      const delivery = normalizeDelivery(event.delivery);
      if (delivery) record.delivery = delivery;
    }
    if (record.definition.mode === 'once') {
      record.evaluation.completed = true;
      record.backend.confirmedStatus = 'completed';
      refreshAndEmit(record);
    }
    emit({ type: 'alert-event', alertId: event.alertId, revision: event.revision, event: stored });
  }

  function handleBackendMessage(message) {
    try {
      if (!isPlainObject(message) || typeof message.type !== 'string') {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend message must have a typed shape');
      }
      if (message.type === 'event') handleBackendEvent(message.event);
      else if (message.type === 'status') handleBackendStatus(message);
      else if (message.type === 'error') {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, errorText(message.error) ?? 'backend subscription error');
      } else {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backend message type is not supported');
      }
    } catch (error) {
      if (!(error instanceof AlertError)) throw error;
      backendError = { code: error.code, message: error.message };
      emit({ type: 'backend-error', error: backendError });
    }
  }

  function safeCall(invoke) {
    try {
      return { ok: true, value: invoke() };
    } catch (error) {
      return { ok: false, error: errorText(error) ?? 'adapter call failed' };
    }
  }

  function callMutation(definitions, invoke) {
    inFlightDefinitions.add(definitions);
    try { return safeCall(invoke); }
    finally { inFlightDefinitions.delete(definitions); }
  }

  function requireBackend() {
    if (!backendAdapter) {
      throw new AlertError(ALERT_ERROR_CODES.BACKEND_UNAVAILABLE, 'backend operation: no backend adapter is attached');
    }
    return backendAdapter;
  }

  function nextRequestId(operation, alertId) {
    const requestId = options.createRequestId
      ? options.createRequestId(operation, alertId)
      : globalThis.crypto?.randomUUID?.();
    if (typeof requestId !== 'string' || requestId.length === 0 || usedRequestIds.has(requestId)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'backend operation: a unique requestId is required; provide createRequestId if secure UUID generation is unavailable');
    }
    usedRequestIds.add(requestId);
    requestCounter += 1;
    return requestId;
  }

  function backendCreate(definition) {
    const adapter = requireBackend();
    if (isPlainObject(definition) && definition.authority !== 'backend') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'backendCreate: definition authority must be backend', [
        { path: 'authority', message: 'must be "backend"' }
      ]);
    }
    if (isPlainObject(definition) && definition.revision !== undefined && definition.revision !== 1) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'backendCreate: a new alert must start at revision 1', [
        { path: 'revision', message: 'must be 1 for a new alert' }
      ]);
    }
    const normalized = validateAlertDefinition({ ...definition, authority: 'backend', revision: 1 }, validationCtx);
    if (records.has(normalized.id) || pendingCreates.has(normalized.id)) {
      throw new AlertError(ALERT_ERROR_CODES.ALERT_EXISTS, 'backendCreate: an alert with this id exists or awaits reconciliation', [
        { path: 'id', message: 'must be unique' }
      ]);
    }
    const requestId = nextRequestId('create', normalized.id);
    const call = callMutation([normalized], () => adapter.create(normalized, requestId));
    if (!call.ok) {
      pendingCreates.set(normalized.id, { definition: normalized, requestId });
      return backendUnknown(null, { outcome: 'unknown', error: call.error, requestId }, { type: 'create', definition: normalized, requestId });
    }
    const result = normalizeOutcome(call.value);
    if (result.outcome === 'confirmed') {
      if (result.alertId !== normalized.id || result.revision !== normalized.revision) {
        pendingCreates.set(normalized.id, { definition: normalized, requestId });
        return backendUnknown(null, { error: 'confirmation does not identify the requested revision', requestId }, { type: 'create', definition: normalized, requestId });
      }
      const record = createRecord(normalized);
      register(record);
      try {
        normalizeConfirmed(record, normalized, result, 0, { requireMatch: true });
      } catch (error) {
        unregister(record);
        pendingCreates.set(normalized.id, { definition: normalized, requestId });
        return backendUnknown(null, { error: errorText(error), requestId }, { type: 'create', definition: normalized, requestId });
      }
      pendingCreates.delete(normalized.id);
      emit({ type: 'alert-added', alertId: normalized.id, revision: record.definition.revision });
      return {
        outcome: 'confirmed',
        alertId: normalized.id,
        revision: record.definition.revision,
        status: record.backend.confirmedStatus,
        requestId
      };
    }
    if (result.outcome === 'rejected') throw rejection(result);
    if (result.outcome === 'conflict') throw conflict(result, 1);
    pendingCreates.set(normalized.id, { definition: normalized, requestId });
    return backendUnknown(null, { ...result, requestId }, { type: 'create', definition: normalized, requestId });
  }

  function requireBackendRecord(id, operation) {
    const record = requireRecord(id);
    if (record.definition.authority !== 'backend') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, `${operation}: the alert is owned by the local authority`, [
        { path: 'authority', message: 'must be "backend"' }
      ]);
    }
    if (record.backend.syncState === 'unknown') {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_STATE, `${operation}: reconcile the unknown backend outcome before another mutation`, [
        { path: 'alertId', message: 'requires backendRead reconciliation' }
      ]);
    }
    return record;
  }

  function backendUpdate(id, patch, expectedRevision) {
    const adapter = requireBackend();
    const record = requireBackendRecord(id, 'backendUpdate');
    requireRevision(record, expectedRevision, 'backendUpdate');
    if (!isPlainObject(patch)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'backendUpdate: patch must be an object', [
        { path: 'patch', message: 'must be an object' }
      ]);
    }
    const candidate = validateAlertDefinition(
      { ...record.definition, ...patch, id, revision: expectedRevision + 1 },
      validationCtx
    );
    const requestId = nextRequestId('update', id);
    const call = callMutation([record.definition, candidate], () => adapter.update(id, candidate, expectedRevision, requestId));
    if (!call.ok) {
      return backendUnknown(record, { outcome: 'unknown', error: call.error, requestId }, { type: 'update', candidate, expectedRevision, requestId });
    }
    const result = normalizeOutcome(call.value);
    if (result.outcome === 'confirmed') {
      try {
        if (result.alertId !== id || result.revision !== candidate.revision) {
          throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendUpdate: confirmation does not identify the requested revision');
        }
        normalizeConfirmed(record, candidate, result, expectedRevision, { requireMatch: true });
      } catch (error) {
        return backendUnknown(record, { error: errorText(error), requestId }, { type: 'update', candidate, expectedRevision, requestId });
      }
      emit({ type: 'alert-updated', alertId: id, revision: record.definition.revision });
      return { outcome: 'confirmed', alertId: id, revision: record.definition.revision, status: record.backend.confirmedStatus, requestId };
    }
    if (result.outcome === 'rejected') throw rejection(result);
    if (result.outcome === 'conflict') throw conflict(result, expectedRevision);
    return backendUnknown(record, { ...result, requestId }, { type: 'update', candidate, expectedRevision, requestId });
  }

  function backendStateChange(operation, id, expectedRevision) {
    const adapter = requireBackend();
    const record = requireBackendRecord(id, operation);
    requireRevision(record, expectedRevision, operation);
    const requestId = nextRequestId(operation, id);
    const call = callMutation([record.definition], () => adapter[operation](id, expectedRevision, requestId));
    if (!call.ok) {
      return backendUnknown(record, { outcome: 'unknown', error: call.error, requestId }, { type: operation, expectedRevision, requestId });
    }
    const result = normalizeOutcome(call.value);
    if (result.outcome === 'confirmed') {
      try {
        if (result.alertId !== id || (operation === 'pause' && result.status !== 'paused')) {
          throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, `${operation}: confirmation does not establish the requested state`);
        }
        normalizeConfirmed(record, record.definition, result, expectedRevision, { requireAdvance: false, requireMatch: true });
      } catch (error) {
        return backendUnknown(record, { error: errorText(error), requestId }, { type: operation, expectedRevision, requestId });
      }
      const type = operation === 'pause' ? 'alert-paused' : 'alert-resumed';
      emit({ type, alertId: id, revision: record.definition.revision });
      return { outcome: 'confirmed', alertId: id, revision: record.definition.revision, status: record.backend.confirmedStatus, requestId };
    }
    if (result.outcome === 'rejected') throw rejection(result);
    if (result.outcome === 'conflict') throw conflict(result, expectedRevision);
    return backendUnknown(record, { ...result, requestId }, { type: operation, expectedRevision, requestId });
  }

  function backendPause(id, expectedRevision) {
    return backendStateChange('pause', id, expectedRevision);
  }

  function backendResume(id, expectedRevision) {
    return backendStateChange('resume', id, expectedRevision);
  }

  function backendDelete(id, expectedRevision) {
    const adapter = requireBackend();
    const record = requireBackendRecord(id, 'backendDelete');
    requireRevision(record, expectedRevision, 'backendDelete');
    const requestId = nextRequestId('delete', id);
    const call = callMutation([record.definition], () => adapter.delete(id, expectedRevision, requestId));
    if (!call.ok) {
      return backendUnknown(record, { outcome: 'unknown', error: call.error, requestId }, { type: 'delete', expectedRevision, requestId });
    }
    const result = normalizeOutcome(call.value);
    if (result.outcome === 'confirmed') {
      if (result.alertId !== id || !Number.isSafeInteger(result.revision) || result.revision < expectedRevision) {
        return backendUnknown(record, { error: 'delete confirmation does not identify the requested alert revision', requestId }, { type: 'delete', expectedRevision, requestId });
      }
      unregister(record);
      retired.set(id, record);
      emit({ type: 'alert-removed', alertId: id, revision: record.definition.revision });
      return { outcome: 'confirmed', alertId: id, revision: result.revision, status: result.status ?? 'unknown', requestId };
    }
    if (result.outcome === 'rejected') throw rejection(result);
    if (result.outcome === 'conflict') throw conflict(result, expectedRevision);
    return backendUnknown(record, { ...result, requestId }, { type: 'delete', expectedRevision, requestId });
  }

  function backendRead(id) {
    const adapter = requireBackend();
    if (typeof id !== 'string' || id.length === 0) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_ARGUMENT, 'backendRead: alert id must be a non-empty string');
    }
    const call = safeCall(() => adapter.read(id));
    if (!call.ok) {
      return { outcome: 'unknown', alertId: id, error: call.error };
    }
    const result = normalizeOutcome(call.value);
    if (result.outcome === 'error') {
      const record = records.get(id);
      if (record) {
        record.backend.error = errorText(result.error?.message ?? result.error);
        refreshAndEmit(record);
      }
      emit({ type: 'backend-error', error: { code: 'BACKEND_READ', message: errorText(result.error?.message ?? result.error) } });
      return { outcome: 'error', alertId: id };
    }
    if (result.outcome === 'confirmed') {
      if (result.alertId !== id || (result.definition?.id !== undefined && result.definition.id !== id)) {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendRead: confirmation returned a different alert id');
      }
      if (!isPlainObject(result.definition)) {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendRead: a confirmed definition is required');
      }
      if (!Number.isSafeInteger(result.revision) || result.revision < 1 || !BACKEND_STATUSES.includes(result.status)) {
        throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendRead: confirmed revision or status is invalid');
      }
      let record = records.get(id);
      if (record) {
        if (result.revision < record.definition.revision) {
          throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendRead: confirmed revision went backwards');
        }
        if (result.revision === record.definition.revision) {
          const readDefinition = validateAlertDefinition(
            { ...record.definition, ...result.definition, id, revision: result.revision, authority: 'backend' }, validationCtx
          );
          if (stableStringify(readDefinition) !== stableStringify(record.definition)) {
            throw new AlertError(ALERT_ERROR_CODES.BACKEND_REJECTED, 'backendRead: confirmed definition changed without a new revision');
          }
        }
        normalizeConfirmed(record, record.definition, { ...result, alertId: result.alertId ?? id }, null);
        emit({ type: 'alert-updated', alertId: id, revision: record.definition.revision });
      } else {
        const initial = validateAlertDefinition(
          { ...result.definition, id, revision: result.revision, authority: 'backend' },
          validationCtx
        );
        record = createRecord(initial);
        register(record);
        normalizeConfirmed(record, initial, { ...result, alertId: result.alertId ?? id }, null);
        emit({ type: 'alert-added', alertId: id, revision: record.definition.revision });
      }
      pendingCreates.delete(id);
      return {
        outcome: 'confirmed',
        alertId: id,
        revision: record.definition.revision,
        status: record.backend.confirmedStatus
      };
    }
    const record = records.get(id);
    if (record) {
      record.backend.syncState = 'unknown';
      record.backend.pending = { type: 'read', requestId: result.requestId ?? null };
      refreshAndEmit(record);
    }
    return { outcome: 'unknown', alertId: id, requestId: result.requestId ?? null };
  }

  function getBackendState() {
    return deepFreeze({
      attached: backendAdapter !== null,
      idempotency: backendIdempotency,
      lastError: backendError,
      needsSnapshot,
      requests: requestCounter,
      pendingCreates: [...pendingCreates.keys()]
    });
  }

  return Object.freeze({
    add,
    get,
    list,
    update,
    prepareUpdates,
    pause,
    resume,
    remove,
    getRetired,
    events,
    subscribe,
    observe,
    confirmSnapshot,
    disconnect,
    disconnectStream,
    reconnect,
    stopSession,
    startSession,
    setSimulation,
    getSession,
    markSourceRemoved,
    markSourceAvailable,
    setSourceAvailable,
    setGeometryResolved,
    exportDefinitions,
    importDefinitions,
    setBackendAdapter,
    backendCreate,
    backendUpdate,
    backendPause,
    backendResume,
    backendDelete,
    backendRead,
    getBackendState,
    getPendingBackendDefinitions() {
      return deepFreeze([
        ...[...pendingCreates.values()].map(pending => cloneJson(pending.definition)),
        ...[...records.values()].flatMap(record => record.backend.pending?.candidate ? [cloneJson(record.backend.pending.candidate)] : []),
        ...[...inFlightDefinitions].flatMap(definitions => definitions.map(cloneJson))
      ]);
    },
    getDiagnostics() {
      return deepFreeze({
        alertCount: records.size,
        listenerCount: listeners.size,
        lastListenerError,
        lastClockError,
        blockedSources: blockedSources.map(block => ({ ref: block.ref, reason: block.reason }))
      });
    }
  });
}

export { ALERT_SCHEMA_VERSION, validateAlertDefinition, validateObservation, sourceKey };
