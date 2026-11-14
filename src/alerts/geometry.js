import { ALERT_ERROR_CODES, AlertError } from './errors.js';

export const SERIES_FIELDS = Object.freeze(['open', 'high', 'low', 'close', 'volume', 'value']);
export const DRAWING_TYPES = Object.freeze(['horizontal', 'segment', 'ray']);
export const SCALES = Object.freeze(['linear', 'log']);

const SOURCE_KINDS = Object.freeze(['series', 'indicator', 'constant', 'drawing']);
const INCLINED_DRAWINGS = Object.freeze(['segment', 'ray']);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function checkKeys(object, allowed, path, push, label = 'field') {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) push(path ? `${path}.${key}` : key, `unknown ${label}`);
  }
}

/** Deterministic stringification used for identities and deduplication. */
export function stableStringify(value) {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).filter(key => value[key] !== undefined).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

/**
 * Stable identity used by observations: chart identity and the complete
 * series or indicator source. Levels are not in the observation value map.
 */
export function sourceKey(source) {
  if (!source || typeof source !== 'object') return 'unknown';
  switch (source.kind) {
    case 'series':
      return `series:${stableStringify([source.chartId ?? null, source.seriesId, source.field])}`;
    case 'indicator':
      return `indicator:${stableStringify([source.chartId ?? null, source.indicatorId, source.formula, source.params, source.output, source.semanticVersion])}`;
    case 'constant':
      return 'constant';
    case 'drawing':
      return `drawing:${source.drawingType}`;
    default:
      return `unknown:${String(source.kind)}`;
  }
}

/** A level does not travel in the numeric observation map. */
export function sourceIsLevel(source) {
  return source?.kind === 'constant' || (source?.kind === 'drawing' && source.drawingType === 'horizontal');
}

export function isInclinedDrawing(source) {
  return source?.kind === 'drawing' && INCLINED_DRAWINGS.includes(source.drawingType);
}

/** A source whose value changes with the observed slot. */
export function sourceIsDynamic(source) {
  return source?.kind === 'series' || source?.kind === 'indicator' || isInclinedDrawing(source);
}

export function isLogDrawing(source) {
  return isInclinedDrawing(source) && source.scale === 'log';
}

function stringField(value, path, push, { optional = false } = {}) {
  if (value === undefined || value === null) {
    if (!optional) push(path, 'is required');
    return null;
  }
  if (typeof value !== 'string' || value.length === 0) {
    push(path, 'must be a non-empty string');
    return null;
  }
  return value;
}

function unitsField(value, path, push) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    push(path, 'must be a non-empty string when provided');
    return null;
  }
  return value;
}

function finiteField(value, path, push) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    push(path, 'must be a finite number');
    return null;
  }
  return value;
}

export function isJsonValue(value, depth = 0) {
  if (depth > 32) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(entry => isJsonValue(entry, depth + 1));
  if (isPlainObject(value)) return Object.values(value).every(entry => isJsonValue(entry, depth + 1));
  return false;
}

export function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (isPlainObject(value)) {
    const result = {};
    for (const key of Object.keys(value)) result[key] = cloneJson(value[key]);
    return result;
  }
  return value;
}

/**
 * Validate and normalize one alert source. Field problems are appended to
 * `push`; the returned source is structurally valid or null.
 */
export function normalizeSource(source, path, push) {
  if (!isPlainObject(source)) {
    push(path, 'must be a source object');
    return null;
  }
  if (!SOURCE_KINDS.includes(source.kind)) {
    push(`${path}.kind`, `must be one of ${SOURCE_KINDS.join(', ')}`);
    return null;
  }

  if (source.kind === 'constant') {
    checkKeys(source, ['kind', 'value', 'units'], path, push);
    const value = finiteField(source.value, `${path}.value`, push);
    return value === null
      ? null
      : { kind: 'constant', value, units: unitsField(source.units, `${path}.units`, push) };
  }

  if (source.kind === 'series') {
    checkKeys(source, ['kind', 'seriesId', 'field', 'units', 'chartId'], path, push);
    const seriesId = stringField(source.seriesId, `${path}.seriesId`, push);
    let field = null;
    if (!SERIES_FIELDS.includes(source.field)) push(`${path}.field`, `must be one of ${SERIES_FIELDS.join(', ')}`);
    else field = source.field;
    return seriesId && field
      ? {
          kind: 'series',
          seriesId,
          field,
          units: unitsField(source.units, `${path}.units`, push),
          chartId: stringField(source.chartId, `${path}.chartId`, push, { optional: true })
        }
      : null;
  }

  if (source.kind === 'indicator') {
    checkKeys(source, ['kind', 'indicatorId', 'formula', 'params', 'output', 'semanticVersion', 'units', 'chartId'], path, push);
    const indicatorId = stringField(source.indicatorId, `${path}.indicatorId`, push);
    const formula = stringField(source.formula, `${path}.formula`, push);
    const output = stringField(source.output, `${path}.output`, push);
    const semanticVersion = stringField(source.semanticVersion, `${path}.semanticVersion`, push);
    let params = null;
    if (!isPlainObject(source.params)) push(`${path}.params`, 'must be an object of formula parameters');
    else if (!isJsonValue(source.params)) push(`${path}.params`, 'must contain only finite JSON values');
    else params = cloneJson(source.params);
    return indicatorId && formula && params && output && semanticVersion
      ? {
          kind: 'indicator',
          indicatorId,
          formula,
          params,
          output,
          semanticVersion,
          units: unitsField(source.units, `${path}.units`, push),
          chartId: stringField(source.chartId, `${path}.chartId`, push, { optional: true })
        }
      : null;
  }

  // drawing
  if (!DRAWING_TYPES.includes(source.drawingType)) {
    checkKeys(source, ['kind', 'drawingId', 'drawingType', 'scale', 'points', 'price', 'units', 'chartId'], path, push);
    push(`${path}.drawingType`, `must be one of ${DRAWING_TYPES.join(', ')}`);
    return null;
  }

  if (source.drawingType === 'horizontal') {
    checkKeys(source, ['kind', 'drawingId', 'drawingType', 'price', 'units', 'chartId'], path, push);
    const price = finiteField(source.price, `${path}.price`, push);
    return price === null
      ? null
      : {
          kind: 'drawing',
          drawingId: stringField(source.drawingId, `${path}.drawingId`, push, { optional: true }),
          drawingType: 'horizontal',
          price,
          units: unitsField(source.units, `${path}.units`, push),
          chartId: stringField(source.chartId, `${path}.chartId`, push, { optional: true })
        };
  }

  checkKeys(source, ['kind', 'drawingId', 'drawingType', 'scale', 'points', 'units', 'chartId'], path, push);
  if (!SCALES.includes(source.scale)) push(`${path}.scale`, `must be one of ${SCALES.join(', ')}`);
  if (!Array.isArray(source.points) || source.points.length !== 2) {
    push(`${path}.points`, 'must contain exactly two {anchorBarId, offset, price} points');
    return null;
  }
  const points = [];
  for (let i = 0; i < 2; i += 1) {
    const point = source.points[i];
    const pointPath = `${path}.points[${i}]`;
    if (!isPlainObject(point)) {
      push(pointPath, 'must be an {anchorBarId, offset, price} object');
      points.push(null);
      continue;
    }
    checkKeys(point, ['anchorBarId', 'offset', 'price'], pointPath, push);
    const anchorBarId = stringField(point.anchorBarId, `${pointPath}.anchorBarId`, push);
    const offset = finiteField(point.offset, `${pointPath}.offset`, push);
    const price = finiteField(point.price, `${pointPath}.price`, push);
    if (source.scale === 'log' && price !== null && price <= 0) {
      push(`${pointPath}.price`, 'must be strictly positive for a log scale');
    }
    points.push(anchorBarId !== null && offset !== null && price !== null ? { anchorBarId, offset, price } : null);
  }
  if (points[0] && points[1] && points[0].anchorBarId === points[1].anchorBarId && points[0].offset === points[1].offset) {
    push(`${path}.points[1]`, 'must not coincide with the first point');
  }
  if (source.scale === 'linear' && points[0] && points[1] && !Number.isFinite(points[1].price - points[0].price)) {
    push(`${path}.points`, 'linear price difference must be finite');
  }
  if (!SCALES.includes(source.scale) || points.some(point => point === null)) return null;
  return {
    kind: 'drawing',
    drawingId: stringField(source.drawingId, `${path}.drawingId`, push, { optional: true }),
    drawingType: source.drawingType,
    scale: source.scale,
    points,
    units: unitsField(source.units, `${path}.units`, push),
    chartId: stringField(source.chartId, `${path}.chartId`, push, { optional: true })
  };
}

function anchorIndex(anchorBarId, resolveBarIndex, chartId) {
  if (typeof resolveBarIndex !== 'function') return null;
  const index = resolveBarIndex(anchorBarId, chartId);
  return Number.isFinite(index) ? index : null;
}

/**
 * Threshold of a drawing at an observed index. Returns `unresolved` when a
 * host anchor lookup is missing, `out-of-range` when the observed bar is not
 * covered, and throws for a host-confirmed degenerate geometry.
 *
 * @param {object} source normalized inclined drawing or horizontal level
 * @param {number} observedIndex
 * @param {(barId: string, chartId?: string) => number | null | undefined} [resolveBarIndex]
 */
export function resolveDrawingThreshold(source, observedIndex, resolveBarIndex) {
  if (source.drawingType === 'horizontal') return { status: 'ok', threshold: source.price };
  const [first, second] = source.points;
  const firstIndex = anchorIndex(first.anchorBarId, resolveBarIndex, source.chartId ?? undefined);
  const secondIndex = anchorIndex(second.anchorBarId, resolveBarIndex, source.chartId ?? undefined);
  if (firstIndex === null || secondIndex === null) {
    return {
      status: 'unresolved',
      anchors: [firstIndex === null ? first.anchorBarId : null, secondIndex === null ? second.anchorBarId : null].filter(id => id !== null)
    };
  }
  const x0 = firstIndex + first.offset;
  const x1 = secondIndex + second.offset;
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: resolved anchor position is not finite');
  }
  if (!Number.isFinite(observedIndex)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: observed index is not finite');
  }
  if (x0 === x1) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: anchor positions coincide after host mapping');
  }
  const numerator = observedIndex - x0;
  const denominator = x1 - x0;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: geometry difference is not finite');
  }
  const t = numerator / denominator;
  if (!Number.isFinite(t)) {
    throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: relative position is not finite');
  }
  if (source.drawingType === 'segment' && (t < 0 || t > 1)) return { status: 'out-of-range' };
  if (source.drawingType === 'ray' && t < 0) return { status: 'out-of-range' };

  let threshold;
  if (source.scale === 'log') {
    if (!(first.price > 0) || !(second.price > 0)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: log anchors must be strictly positive');
    }
    const difference = Math.log(second.price) - Math.log(first.price);
    const displacement = t * difference;
    const exponent = Math.log(first.price) + displacement;
    if (!Number.isFinite(difference) || !Number.isFinite(displacement) || !Number.isFinite(exponent)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: log interpolation is not finite');
    }
    threshold = Math.exp(exponent);
    if (!Number.isFinite(threshold) || threshold <= 0) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: log threshold is not a positive finite value');
    }
  } else {
    const difference = second.price - first.price;
    const displacement = t * difference;
    if (!Number.isFinite(difference) || !Number.isFinite(displacement)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold: linear interpolation is not finite');
    }
    threshold = first.price + displacement;
    if (!Number.isFinite(threshold)) {
      throw new AlertError(ALERT_ERROR_CODES.INVALID_GEOMETRY, 'drawing threshold is not finite');
    }
  }
  return { status: 'ok', threshold, t };
}
