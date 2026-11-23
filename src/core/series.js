import { fail } from '../errors.js';
import {
  assertArray,
  assertPlainObject,
  isOhlcType,
  normalizeMetadata,
  normalizePoint
} from './validate.js';

function copyPoint(point) {
  const out = { barId: point.barId };
  if ('value' in point) {
    out.value = point.value;
    return out;
  }
  out.open = point.open;
  out.high = point.high;
  out.low = point.low;
  out.close = point.close;
  if ('volume' in point) out.volume = point.volume;
  if ('buyVolume' in point) out.buyVolume = point.buyVolume;
  if ('sellVolume' in point) out.sellVolume = point.sellVolume;
  return out;
}

function copyMetadata(metadata) {
  if (!metadata) return null;
  const out = { ...metadata };
  if (metadata.calendar) out.calendar = { ...metadata.calendar };
  return out;
}

/**
 * One data series bound to the chart timeline. Points are ordered by the
 * host timeline, never by barId or time. The series never sorts input.
 */
export class Series {
  constructor({ id, type, options = {}, timeline, owner = null }) {
    this._id = id;
    this._type = type;
    this._timeline = timeline;
    this._owner = owner;
    this._options = Object.freeze({ ...options });
    this._metadata = options.metadata ?? null;
    this._points = [];
    this._byId = new Map();
    this._revision = 0;
    this._pane = null;
    this._priceScaleId = options.priceScaleId ?? 'right';
  }

  get id() { this._owner?._assertAlive?.('series.id'); return this._id; }
  get type() { this._owner?._assertAlive?.('series.type'); return this._type; }
  get pane() { this._owner?._assertAlive?.('series.pane'); return this._pane; }
  set pane(value) { this._owner?._assertAlive?.('series.pane'); this._pane = value; }
  get priceScaleId() { this._owner?._assertAlive?.('series.priceScaleId'); return this._priceScaleId; }
  set priceScaleId(value) { this._owner?._assertAlive?.('series.priceScaleId'); this._priceScaleId = value; }

  get revision() {
    this._owner?._assertAlive?.('series.revision');
    return this._revision;
  }

  get length() {
    this._owner?._assertAlive?.('series.length');
    return this._points.length;
  }

  get isOhlc() {
    this._owner?._assertAlive?.('series.isOhlc');
    return isOhlcType(this.type);
  }

  metadata() {
    this._owner?._assertAlive?.('series.metadata');
    return copyMetadata(this._metadata);
  }

  data() {
    this._owner?._assertAlive?.('series.data');
    return this._points.map(copyPoint);
  }

  point(barId) {
    this._owner?._assertAlive?.('series.point');
    const point = this._byId.get(barId);
    return point ? copyPoint(point) : null;
  }

  lastPoint() {
    this._owner?._assertAlive?.('series.lastPoint');
    const point = this._points[this._points.length - 1];
    return point ? copyPoint(point) : null;
  }

  _indexOfPointBarId(barId) {
    const index = this._timeline.indexOf(barId);
    if (index === null) {
      fail('UNKNOWN_BAR_ID', 'series', 'point references a slot that does not exist in the timeline', {
        field: 'barId',
        barId
      });
    }
    return index;
  }

  _normalizeList(data, operation) {
    assertArray(data, operation, 'data');
    const points = [];
    for (let i = 0; i < data.length; i += 1) {
      points.push(normalizePoint(this.type, data[i], operation, i));
    }
    return points;
  }

  _validateStrictlyIncreasing(points, operation, startIndex = 0, indexOf = null) {
    const resolve = indexOf ?? ((barId) => this._timeline.indexOf(barId));
    let previous = startIndex - 1;
    for (let i = 0; i < points.length; i += 1) {
      const index = resolve(points[i].barId);
      if (index === null) {
        fail('UNKNOWN_BAR_ID', operation, 'point references a slot that does not exist in the timeline', {
          field: 'barId',
          index: i
        });
      }
      if (index <= previous) {
        fail('OUT_OF_ORDER', operation, 'points must follow the host timeline order', {
          field: 'barId',
          index: i
        });
      }
      previous = index;
    }
  }

  _checkDuplicateAgainstSeries(points, operation) {
    for (let i = 0; i < points.length; i += 1) {
      if (this._byId.has(points[i].barId)) {
        fail('DUPLICATE_BAR_ID', operation, 'point already exists in the series', {
          field: 'barId',
          index: i
        });
      }
    }
  }

  _firstPointIndex(indexOf = null) {
    if (this._points.length === 0) return null;
    const resolve = indexOf ?? ((barId) => this._timeline.indexOf(barId));
    return resolve(this._points[0].barId);
  }

  _lastPointIndex(indexOf = null) {
    if (this._points.length === 0) return null;
    const resolve = indexOf ?? ((barId) => this._timeline.indexOf(barId));
    return resolve(this._points[this._points.length - 1].barId);
  }

  /**
   * Validates a mutation and returns a candidate state. Never mutates.
   * @param {'setData'|'prepend'|'update'|'correct'|'append'} operation
   */
  _prepare(operation, data, metadata, indexOfOverride = null) {
    const op = `series.${operation}`;
    if (metadata !== undefined && operation !== 'setData') {
      fail('INVALID_ARGUMENT', op, 'metadata can only be changed with setData', { field: 'metadata' });
    }
    const indexOf = indexOfOverride ?? ((barId) => this._timeline.indexOf(barId));
    if (operation === 'setData') {
      const points = this._normalizeList(data, op);
      this._validateStrictlyIncreasing(points, op, 0, indexOf);
      let nextMetadata = this._metadata;
      if (metadata !== undefined) {
        nextMetadata = normalizeMetadata(metadata, op);
      }
      return { operation, points, metadata: nextMetadata, metadataChanged: metadata !== undefined };
    }

    if (operation === 'prepend') {
      const points = this._normalizeList(data, op);
      if (points.length === 0) return { operation, points, noop: true };
      this._validateStrictlyIncreasing(points, op, 0, indexOf);
      this._checkDuplicateAgainstSeries(points, op);
      const first = this._firstPointIndex(indexOf);
      if (first !== null) {
        const lastNew = indexOf(points[points.length - 1].barId);
        if (lastNew >= first) {
          fail('OUT_OF_ORDER', op, 'prepended points must precede every existing point', {
            field: 'barId',
            index: points.length - 1
          });
        }
      }
      return { operation, points, metadata: this._metadata, metadataChanged: false };
    }

    if (operation === 'append') {
      const points = this._normalizeList(data, op);
      if (points.length === 0) return { operation, points, noop: true };
      this._validateStrictlyIncreasing(points, op, 0, indexOf);
      const last = this._lastPointIndex(indexOf);
      if (last !== null) {
        const firstNew = indexOf(points[0].barId);
        if (firstNew <= last) {
          fail('OUT_OF_ORDER', op, 'appended points must follow every existing point', {
            field: 'barId',
            index: 0
          });
        }
      }
      this._checkDuplicateAgainstSeries(points, op);
      return { operation, points, metadata: this._metadata, metadataChanged: false };
    }

    if (operation === 'update') {
      assertPlainObject(data, op, 'point');
      const point = normalizePoint(this.type, data, op, 0);
      const index = indexOf(point.barId);
      if (index === null) {
        fail('UNKNOWN_BAR_ID', op, 'point references a slot that does not exist in the timeline', {
          field: 'barId'
        });
      }
      if (this._points.length > 0) {
        const lastPoint = this._points[this._points.length - 1];
        if (lastPoint.barId !== point.barId) {
          const lastIndex = this._lastPointIndex(indexOf);
          if (index <= lastIndex) {
            fail('OUT_OF_ORDER', op, 'update may only replace the last point or add a later one', {
              field: 'barId'
            });
          }
        }
      }
      return { operation, points: [point], metadata: this._metadata, metadataChanged: false };
    }

    if (operation === 'correct') {
      assertPlainObject(data, op, 'point');
      const point = normalizePoint(this.type, data, op, 0);
      if (!this._byId.has(point.barId)) {
        fail('UNKNOWN_POINT', op, 'correction target does not exist in the series', {
          field: 'barId',
          barId: point.barId
        });
      }
      return { operation, points: [point], metadata: this._metadata, metadataChanged: false };
    }

    fail('INVALID_ARGUMENT', 'series', 'unsupported series mutation');
  }

  _applyPrepared(prepared) {
    if (prepared.noop) return;
    if (prepared.operation === 'setData') {
      this._points = prepared.points;
      this._byId = new Map(prepared.points.map((point) => [point.barId, point]));
      if (prepared.metadataChanged) this._metadata = prepared.metadata;
    } else if (prepared.operation === 'prepend') {
      this._points = prepared.points.concat(this._points);
      for (const point of prepared.points) this._byId.set(point.barId, point);
    } else if (prepared.operation === 'append') {
      this._points = this._points.concat(prepared.points);
      for (const point of prepared.points) this._byId.set(point.barId, point);
    } else if (prepared.operation === 'update') {
      const point = prepared.points[0];
      if (this._points.length === 0) {
        this._points = [point];
      } else if (this._points[this._points.length - 1].barId === point.barId) {
        this._points[this._points.length - 1] = point;
      } else {
        this._points.push(point);
      }
      this._byId.set(point.barId, point);
    } else if (prepared.operation === 'correct') {
      const point = prepared.points[0];
      const index = this._points.findIndex((candidate) => candidate.barId === point.barId);
      if (index !== -1) this._points[index] = point;
      this._byId.set(point.barId, point);
    }
    this._revision += 1;
  }

  _commit(operation, data, metadata) {
    this._owner?._assertAlive?.(`series.${operation}`);
    const prepared = this._prepare(operation, data, metadata);
    const contributions = this._owner?._beforeSeriesCommit?.(this, prepared, operation) ?? [];
    this._applyPrepared(prepared);
    this._owner?._applyContributions?.(contributions);
    this._owner?._afterSeriesCommit?.(this, operation, {
      barIds: prepared.points.map((point) => point.barId),
      derivedCandidates: contributions.derivedCandidates
    });
    return this;
  }

  /** Atomically replaces all points. Empty array is a valid empty series. */
  setData(data, metadata) {
    return this._commit('setData', data, metadata);
  }

  /** Replaces the last point or adds a point on a later existing slot. */
  update(point) {
    return this._commit('update', point);
  }

  /** Adds a non-overlapping batch strictly before the first existing point. */
  prepend(data) {
    return this._commit('prepend', data);
  }

  /** Replaces an existing point by barId. Never creates one. */
  correct(point) {
    return this._commit('correct', point);
  }

  _dispose() {
    this._points = [];
    this._indexedPoints = null;
    this._byId.clear();
    this._metadata = null;
    this._options = null;
    this._pane = null;
    this._timeline = null;
  }

  /** Internal: clear all points without owner notification. */
  _clear() {
    this._points = [];
    this._indexedPoints = null;
    this._byId = new Map();
    this._revision += 1;
  }

  /** Internal: drop points whose slots were removed. */
  _removeBarIds(removed) {
    if (removed.size === 0 || this._points.length === 0) return 0;
    const kept = this._points.filter((point) => !removed.has(point.barId));
    if (kept.length === this._points.length) return 0;
    this._points = kept;
    for (const barId of removed) this._byId.delete(barId);
    this._revision += 1;
    return this._points.length;
  }

  /** Internal: points whose timeline index is within the inclusive range. */
  _pointsInRange(fromIndex, toIndex) {
    if (this._points.length === 0 || toIndex < fromIndex) return [];
    let low = 0;
    let high = this._points.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this._timeline.indexOf(this._points[mid].barId) < fromIndex) low = mid + 1;
      else high = mid;
    }
    // Points follow the timeline order, so the in-range points are one contiguous run:
    // one more binary search keeps `slice` the only allocation of this hot path.
    let end = low;
    let limit = this._points.length;
    while (end < limit) {
      const mid = (end + limit) >> 1;
      if (this._timeline.indexOf(this._points[mid].barId) <= toIndex) end = mid + 1;
      else limit = mid;
    }
    return this._points.slice(low, end);
  }

  /** Internal render snapshot; rebuilt only when series data or timeline order changes. */
  _indexedPointsInRange(fromIndex, toIndex) {
    if (toIndex < fromIndex || this._points.length === 0) return [];
    if (!this._indexedPoints || this._indexedSeriesRevision !== this._revision ||
        this._indexedTimelineRevision !== this._timeline._revision) {
      const indexed = [];
      for (const point of this._points) {
        const index = this._timeline.indexOf(point.barId);
        if (index !== null) indexed.push({ ...point, index });
      }
      this._indexedPoints = indexed;
      this._indexedSeriesRevision = this._revision;
      this._indexedTimelineRevision = this._timeline._revision;
    }
    const points = this._indexedPoints;
    let low = 0;
    let high = points.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid].index < fromIndex) low = mid + 1;
      else high = mid;
    }
    let end = low;
    let limit = points.length;
    while (end < limit) {
      const mid = (end + limit) >> 1;
      if (points[mid].index <= toIndex) end = mid + 1;
      else limit = mid;
    }
    return points.slice(low, end);
  }
}
