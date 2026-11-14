import { ALERT_ERROR_CODES, AlertError } from './errors.js';
import {
  checkKeys,
  cloneJson,
  isPlainObject,
  isInclinedDrawing,
  normalizeSource,
  sourceIsDynamic,
  sourceIsLevel
} from './geometry.js';

export const ALERT_SCHEMA_VERSION = 1;
export const ALERT_OPERATIONS = Object.freeze(['above', 'below', 'crossUp', 'crossDown']);
export const ALERT_MODES = Object.freeze(['once', 'repeating']);
export const OBSERVATION_MODES = Object.freeze(['closed', 'partial']);
export const ALERT_AUTHORITIES = Object.freeze(['local', 'backend']);

const DEFINITION_KEYS = Object.freeze([
  'id',
  'revision',
  'name',
  'left',
  'right',
  'operation',
  'mode',
  'hysteresis',
  'observationMode',
  'authority',
  'expiresAt',
  'mapping'
]);
const OBSERVATION_KEYS = Object.freeze([
  'stream',
  'version',
  'prevVersion',
  'state',
  'barId',
  'time',
  'values',
  'error',
  'correct',
  'gap',
  'snapshot',
  'index'
]);

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}


function invalidDefinition(fields) {
  const summary = fields.map(entry => `${entry.path} ${entry.message}`).join('; ');
  return new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, `alert definition is invalid: ${summary}`, fields);
}

function sourceUnits(source, path, ctx, push) {
  let units = source.units ?? null;
  if (typeof ctx.resolveSource !== 'function') return units;
  let resolved;
  try {
    resolved = ctx.resolveSource(source);
  } catch (error) {
    push(path, `source resolution failed: ${error instanceof Error ? error.message : 'host error'}`);
    return units;
  }
  if (resolved === false) {
    push(path, 'source is not available on the host');
    return units;
  }
  if (resolved && typeof resolved === 'object') {
    if (resolved.available === false) push(path, 'source is not available on the host');
    if (typeof resolved.units === 'string' && resolved.units.length > 0) units = resolved.units;
  }
  return units;
}

function checkUnits(left, right, leftUnits, rightUnits, ctx, push) {
  const leftLevel = sourceIsLevel(left);
  const rightLevel = sourceIsLevel(right);
  if (leftUnits && rightUnits && leftUnits !== rightUnits) {
    const confirmed = typeof ctx.unitsCompatible === 'function' && ctx.unitsCompatible(leftUnits, rightUnits) === true;
    if (!confirmed) {
      push('left.units', 'is incompatible with the right source units');
      push('right.units', 'is incompatible with the left source units');
    }
    return;
  }
  if (leftUnits && !rightUnits && !rightLevel) {
    push('right.units', 'is unknown; the host must confirm compatibility with the left source');
  }
  if (!leftUnits && rightUnits && !leftLevel) {
    push('left.units', 'is unknown; the host must confirm compatibility with the right source');
  }
  if (!leftUnits && !rightUnits) {
    if (!leftLevel) push('left.units', 'is unknown; the host must confirm compatibility with the right source');
    if (!rightLevel) push('right.units', 'is unknown; the host must confirm compatibility with the left source');
  }
}

/**
 * Validate and normalize an alert definition. All problems are collected and
 * reported together before anything is committed. The returned definition is
 * deeply frozen and owns copies of caller-provided nested objects.
 *
 * @param {object} definition
 * @param {{defaultAuthority?: 'local'|'backend', resolveSource?: Function, unitsCompatible?: Function}} [ctx]
 */
export function validateAlertDefinition(definition, ctx = {}) {
  const fields = [];
  const push = (path, message) => fields.push({ path, message });
  if (!isPlainObject(definition)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_DEFINITION, 'alert definition is invalid: definition must be an object', [
      { path: 'definition', message: 'must be an object' }
    ]);
  }
  checkKeys(definition, DEFINITION_KEYS, '', push);

  if (typeof definition.id !== 'string' || definition.id.length === 0) {
    push('id', 'must be a non-empty stable identifier');
  } else if (definition.id !== definition.id.trim() || /[\u0000-\u001f\u007f]/.test(definition.id)) {
    push('id', 'must not contain control characters or surrounding whitespace');
  }
  const revision = definition.revision === undefined ? 1 : definition.revision;
  if (!Number.isSafeInteger(revision) || revision < 1) push('revision', 'must be a positive integer');

  if (definition.name !== undefined && definition.name !== null && typeof definition.name !== 'string') push('name', 'must be a string');

  const left = normalizeSource(definition.left, 'left', push);
  const right = normalizeSource(definition.right, 'right', push);
  if (typeof ctx.resolveBarIndex === 'function') {
    for (const [field, source] of [['left', left], ['right', right]]) {
      if (!isInclinedDrawing(source)) continue;
      try {
        const indices = source.points.map(point => ctx.resolveBarIndex(point.anchorBarId, source.chartId ?? undefined));
        if (indices.every(Number.isFinite)) {
          const first = indices[0] + source.points[0].offset;
          const second = indices[1] + source.points[1].offset;
          if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(second - first) || first === second) {
            push(`${field}.points`, 'resolved anchor positions must be finite and distinct');
          }
        }
      } catch (error) {
        push(`${field}.points`, `anchor lookup failed: ${error.message}`);
      }
    }
  }

  if (!ALERT_OPERATIONS.includes(definition.operation)) {
    push('operation', `must be one of ${ALERT_OPERATIONS.join(', ')}`);
  }
  if (!ALERT_MODES.includes(definition.mode)) push('mode', `must be one of ${ALERT_MODES.join(', ')}`);

  const hysteresis = definition.hysteresis === undefined ? 0 : definition.hysteresis;
  if (typeof hysteresis !== 'number' || !Number.isFinite(hysteresis) || hysteresis < 0) {
    push('hysteresis', 'must be a finite number >= 0');
  }

  const observationMode = definition.observationMode === undefined ? 'closed' : definition.observationMode;
  if (!OBSERVATION_MODES.includes(observationMode)) {
    push('observationMode', `must be one of ${OBSERVATION_MODES.join(', ')}`);
  }

  const authority = definition.authority ?? ctx.defaultAuthority ?? 'local';
  if (!ALERT_AUTHORITIES.includes(authority)) {
    push('authority', `must be one of ${ALERT_AUTHORITIES.join(', ')}`);
  }
  if (authority === 'backend') {
    for (const [path, source] of [['left', left], ['right', right]]) {
      if (source?.kind === 'drawing' && !source.drawingId) {
        push(`${path}.drawingId`, 'is required for a backend drawing alert');
      }
    }
  }

  let expiresAt = null;
  if (definition.expiresAt !== undefined && definition.expiresAt !== null) {
    if (typeof definition.expiresAt !== 'number' || !Number.isFinite(definition.expiresAt)) {
      push('expiresAt', 'must be a finite epoch-milliseconds value or null');
    } else {
      expiresAt = definition.expiresAt;
    }
  }

  let mapping = null;
  if (definition.mapping !== undefined && definition.mapping !== null) {
    if (!isPlainObject(definition.mapping)) {
      push('mapping', 'must be an explicit host mapping object');
    } else {
      checkKeys(definition.mapping, ['kind', 'id'], 'mapping', push);
      if (definition.mapping.kind !== 'host') push('mapping.kind', 'must be "host"');
      if (typeof definition.mapping.id !== 'string' || definition.mapping.id.length === 0) {
        push('mapping.id', 'must be a non-empty host mapping identifier');
      } else {
        mapping = { kind: 'host', id: definition.mapping.id };
      }
    }
  }

  if (left && right) {
    if (left.chartId && right.chartId && left.chartId !== right.chartId && mapping === null) {
      push('mapping', 'is required when the sources come from different host graphs');
    }
    if (!sourceIsDynamic(left) && !sourceIsDynamic(right)) {
      push('left', 'at least one side must reference a series, indicator output, or inclined drawing');
    }
    const leftUnits = sourceUnits(left, 'left.units', ctx, push);
    const rightUnits = sourceUnits(right, 'right.units', ctx, push);
    checkUnits(left, right, leftUnits, rightUnits, ctx, push);
  }

  if (fields.length > 0) throw invalidDefinition(fields);

  const normalized = {
    id: definition.id,
    revision,
    name: definition.name ?? null,
    left,
    right,
    operation: definition.operation,
    mode: definition.mode,
    hysteresis,
    observationMode,
    authority,
    expiresAt,
    mapping
  };
  return deepFreeze(normalized);
}

/**
 * Validate one consolidated numeric observation. `values` is a map from
 * `sourceKey()` to a finite number (or null for an explicitly missing value).
 * `version` is the host-provided opaque identity of this observation.
 *
 * @param {object} observation
 */
export function validateObservation(observation) {
  const fields = [];
  const push = (path, message) => fields.push({ path, message });
  if (!isPlainObject(observation)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_OBSERVATION, 'observation is invalid: observation must be an object', [
      { path: 'observation', message: 'must be an object' }
    ]);
  }
  checkKeys(observation, OBSERVATION_KEYS, '', push);
  let stream = null;
  if (observation.stream !== undefined) {
    if (!isPlainObject(observation.stream)) {
      push('stream', 'must identify the instrument, interval, and source');
    } else {
      checkKeys(observation.stream, ['instrumentId', 'interval', 'sourceId'], 'stream', push);
      for (const key of ['instrumentId', 'interval', 'sourceId']) {
        if (typeof observation.stream[key] !== 'string' || observation.stream[key].length === 0) {
          push(`stream.${key}`, 'must be a non-empty string');
        }
      }
      stream = {
        instrumentId: observation.stream.instrumentId,
        interval: observation.stream.interval,
        sourceId: observation.stream.sourceId
      };
    }
  }

  if (typeof observation.version !== 'string' || observation.version.length === 0) {
    push('version', 'must be a non-empty opaque observation version');
  }
  if (observation.prevVersion !== undefined && observation.prevVersion !== null) {
    if (typeof observation.prevVersion !== 'string' || observation.prevVersion.length === 0) {
      push('prevVersion', 'must be a non-empty opaque version when provided');
    }
  }
  let barId = null;
  if (observation.barId !== undefined && observation.barId !== null) {
    if (typeof observation.barId !== 'string' || observation.barId.length === 0) {
      push('barId', 'must be a non-empty string when provided');
    } else {
      barId = observation.barId;
    }
  }
  let state = null;
  if (observation.state !== undefined && observation.state !== null) {
    if (!OBSERVATION_MODES.includes(observation.state)) {
      push('state', `must be one of ${OBSERVATION_MODES.join(', ')}`);
    } else {
      state = observation.state;
    }
  } else if (barId !== null) {
    push('state', 'is required when barId is present');
  }
  let time = null;
  if (observation.time !== undefined && observation.time !== null) {
    if (!Number.isSafeInteger(observation.time) || Math.abs(observation.time) > 8640000000000000) push('time', 'must be Unix milliseconds within the Date range');
    else time = observation.time;
  }
  let index = null;
  if (observation.index !== undefined && observation.index !== null) {
    if (typeof observation.index !== 'number' || !Number.isFinite(observation.index)) {
      push('index', 'must be a finite numeric position when provided');
    } else {
      index = observation.index;
    }
  }

  let values = null;
  if (observation.values !== undefined && observation.values !== null) {
    if (!isPlainObject(observation.values)) {
      push('values', 'must be an object keyed by sourceKey');
    } else {
      values = {};
      for (const key of Object.keys(observation.values)) {
        if (key.length === 0) {
          push('values', 'source keys must be non-empty strings');
          continue;
        }
        const value = observation.values[key];
        if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
          push(`values.${key}`, 'must be a finite number or null');
        } else {
          values[key] = value;
        }
      }
    }
  }

  let error = null;
  if (observation.error !== undefined && observation.error !== null) {
    if (!isPlainObject(observation.error)) {
      push('error', 'must be an {message, sourceKey?} object');
    } else {
      checkKeys(observation.error, ['message', 'sourceKey'], 'error', push);
      if (typeof observation.error.message !== 'string' || observation.error.message.length === 0) {
        push('error.message', 'must be a non-empty string');
      }
      if (observation.error.sourceKey !== undefined && typeof observation.error.sourceKey !== 'string') {
        push('error.sourceKey', 'must be a string when provided');
      }
      error = {
        message: observation.error.message,
        sourceKey: observation.error.sourceKey ?? null
      };
    }
  }

  for (const flag of ['correct', 'gap', 'snapshot']) {
    if (observation[flag] !== undefined && typeof observation[flag] !== 'boolean') {
      push(flag, 'must be a boolean when provided');
    }
  }
  if (error && values) push('values', 'must be omitted when an observation error is reported');
  if (!values && !error && !observation.gap && !observation.correct && !observation.snapshot) {
    push('values', 'is required unless the observation reports an error, gap, correction, or snapshot');
  }

  if (fields.length > 0) {
    const summary = fields.map(entry => `${entry.path} ${entry.message}`).join('; ');
    throw new AlertError(ALERT_ERROR_CODES.INVALID_OBSERVATION, `observation is invalid: ${summary}`, fields);
  }

  return deepFreeze({
    stream,
    version: observation.version,
    prevVersion: observation.prevVersion ?? null,
    state,
    barId,
    time,
    index,
    values,
    error,
    correct: observation.correct === true,
    gap: observation.gap === true,
    snapshot: observation.snapshot === true
  });
}

/** Validate a versioned definitions document without applying it. */
export function validateDefinitionsDocument(document, ctx = {}) {
  const fields = [];
  const push = (path, message) => fields.push({ path, message });
  if (!isPlainObject(document)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_DOCUMENT, 'alert document is invalid: document must be an object', [
      { path: 'document', message: 'must be an object' }
    ]);
  }
  checkKeys(document, ['schemaVersion', 'definitions'], '', push);
  if (document.schemaVersion !== ALERT_SCHEMA_VERSION) {
    push('schemaVersion', `must be ${ALERT_SCHEMA_VERSION}`);
  }
  if (!Array.isArray(document.definitions)) {
    push('definitions', 'must be an array');
    throw new AlertError(ALERT_ERROR_CODES.INVALID_DOCUMENT, 'alert document is invalid: definitions must be an array', fields);
  }
  const definitions = [];
  const ids = new Set();
  document.definitions.forEach((definition, index) => {
    const path = `definitions[${index}]`;
    try {
      const normalized = validateAlertDefinition(definition, ctx);
      if (ids.has(normalized.id)) push(`${path}.id`, 'duplicates another definition id');
      else ids.add(normalized.id);
      definitions.push(normalized);
    } catch (error) {
      if (!(error instanceof AlertError)) throw error;
      for (const entry of error.fields) push(`${path}.${entry.path}`, entry.message);
    }
  });
  if (fields.length > 0) {
    const summary = fields.map(entry => `${entry.path} ${entry.message}`).join('; ');
    throw new AlertError(ALERT_ERROR_CODES.INVALID_DOCUMENT, `alert document is invalid: ${summary}`, fields);
  }
  return deepFreeze({ schemaVersion: ALERT_SCHEMA_VERSION, definitions });
}

/** Deep copy of a JSON-compatible definition for export. */
export function exportDefinition(definition) {
  return deepFreeze(cloneJson(definition));
}
