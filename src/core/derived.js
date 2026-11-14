import { fail } from '../errors.js';
import { IndexScale } from './scales.js';
import { provenanceDigest } from './provenance.js';
import { assertFiniteNumber, assertPlainObject, assertPositiveInteger } from './validate.js';


function sequentialResolver(points) {
  const map = new Map();
  for (let i = 0; i < points.length; i += 1) map.set(points[i].barId, i);
  return (barId) => {
    const index = map.get(barId);
    return index === undefined ? null : index;
  };
}

function nextOrdinal(counters, barId) {
  const value = counters.get(barId) ?? 0;
  counters.set(barId, value + 1);
  return value;
}

function assertOhlc(points) {
  for (const point of points) {
    if (!('close' in point)) {
      fail('DERIVED_SOURCE', 'derived', 'derived views require an OHLC source series', {
        field: 'source'
      });
    }
  }
}

/**
 * Heikin Ashi stays one-to-one on the source index scale.
 * @returns {Array<object>}
 */
export function computeHeikinAshi(points, indexOf) {
  assertOhlc(points);
  const resolve = indexOf ?? sequentialResolver(points);
  const elements = [];
  let previous = null;
  let previousIndex = null;
  for (const point of points) {
    const index = resolve(point.barId);
    if (previous && index !== previousIndex + 1) previous = null;
    const closeSum = point.open + point.high + point.low + point.close;
    const openSum = previous ? previous.open + previous.close : point.open + point.close;
    const haClose = Number.isFinite(closeSum)
      ? closeSum / 4
      : point.open / 4 + point.high / 4 + point.low / 4 + point.close / 4;
    const haOpen = Number.isFinite(openSum)
      ? openSum / 2
      : previous ? previous.open / 2 + previous.close / 2 : point.open / 2 + point.close / 2;
    if (!Number.isFinite(haClose) || !Number.isFinite(haOpen)) {
      fail('DERIVED_STATE', 'derived.heikinAshi', 'calculation produced a non-finite value', { field: 'source' });
    }
    const element = {
      id: `${point.barId}#0`,
      type: 'heikinAshi',
      completionBarId: point.barId,
      barIds: [point.barId],
      previousElementId: previous ? previous.id : null,
      open: haOpen,
      high: Math.max(point.high, haOpen, haClose),
      low: Math.min(point.low, haOpen, haClose),
      close: haClose
    };
    elements.push(element);
    previous = element;
    previousIndex = index;
  }
  return elements;
}

/**
 * Renko bricks from close only. `brickSize` must be strictly positive.
 */
export function computeRenko(points, parameters, indexOf) {
  assertPlainObject(parameters, 'derived.renko', 'parameters');
  const brickSize = assertFiniteNumber(parameters.brickSize, 'derived.renko', 'brickSize');
  if (!(brickSize > 0)) {
    fail('INVALID_PARAMETER', 'derived.renko', '"brickSize" must be greater than zero', {
      field: 'brickSize'
    });
  }
  assertOhlc(points);
  const resolve = indexOf ?? sequentialResolver(points);
  const elements = [];
  const counters = new Map();
  let anchor = null;
  let segmentAnchorBarId = null;
  let previousElementId = null;
  let previousIndex = null;
  let firstBrick = true;

  for (const point of points) {
    const index = resolve(point.barId);
    if (anchor === null || index !== previousIndex + 1) {
      anchor = point.close;
      segmentAnchorBarId = point.barId;
      previousElementId = null;
      firstBrick = true;
      previousIndex = index;
      continue;
    }
    let guard = 0;
    while (point.close >= anchor + brickSize) {
      if (anchor + brickSize === anchor) {
        fail('DERIVED_STATE', 'derived.renko', 'brickSize is too small to advance at this price', { field: 'brickSize' });
      }
      const from = anchor;
      anchor += brickSize;
      const ordinal = nextOrdinal(counters, point.barId);
      const id = `${point.barId}#${ordinal}`;
      elements.push({
        id,
        type: 'renko',
        completionBarId: point.barId,
        barIds: firstBrick ? [segmentAnchorBarId, point.barId] : [point.barId],
        previousElementId,
        direction: 'up',
        open: from,
        high: anchor,
        low: from,
        close: anchor
      });
      previousElementId = id;
      firstBrick = false;
      guard += 1;
      if (guard > 1_000_000) {
        fail('DERIVED_STATE', 'derived.renko', 'brick expansion did not terminate', {
          field: 'brickSize'
        });
      }
    }
    while (point.close <= anchor - brickSize) {
      if (anchor - brickSize === anchor) {
        fail('DERIVED_STATE', 'derived.renko', 'brickSize is too small to advance at this price', { field: 'brickSize' });
      }
      const from = anchor;
      anchor -= brickSize;
      const ordinal = nextOrdinal(counters, point.barId);
      const id = `${point.barId}#${ordinal}`;
      elements.push({
        id,
        type: 'renko',
        completionBarId: point.barId,
        barIds: firstBrick ? [segmentAnchorBarId, point.barId] : [point.barId],
        previousElementId,
        direction: 'down',
        open: from,
        high: from,
        low: anchor,
        close: anchor
      });
      previousElementId = id;
      firstBrick = false;
      guard += 1;
      if (guard > 1_000_000) {
        fail('DERIVED_STATE', 'derived.renko', 'brick expansion did not terminate', {
          field: 'brickSize'
        });
      }
    }
    previousIndex = index;
  }
  return elements;
}

/**
 * Kagi segments from close only. `reversal` is an absolute threshold.
 */
export function computeKagi(points, parameters, indexOf) {
  assertPlainObject(parameters, 'derived.kagi', 'parameters');
  const reversal = assertFiniteNumber(parameters.reversal, 'derived.kagi', 'reversal');
  if (!(reversal > 0)) {
    fail('INVALID_PARAMETER', 'derived.kagi', '"reversal" must be greater than zero', {
      field: 'reversal'
    });
  }
  assertOhlc(points);
  const resolve = indexOf ?? sequentialResolver(points);
  const elements = [];
  const counters = new Map();
  let anchorPrice = null;
  let anchorIndex = null;
  let anchorBarId = null;
  let direction = null;
  let extreme = null;
  let extremeIndex = null;
  let previousElementId = null;
  let previousIndex = null;

  const push = (point, fromPrice, fromIndex, toPrice, toIndex, dir, includeAnchor) => {
    const ordinal = nextOrdinal(counters, point.barId);
    const id = `${point.barId}#${ordinal}`;
    elements.push({
      id,
      type: 'kagi',
      completionBarId: point.barId,
      barIds: includeAnchor ? [anchorBarId, point.barId] : [point.barId],
      previousElementId,
      direction: dir,
      fromPrice,
      fromIndex,
      toPrice,
      toIndex
    });
    previousElementId = id;
  };

  for (const point of points) {
    const index = resolve(point.barId);
    if (anchorPrice === null || index !== previousIndex + 1) {
      anchorPrice = point.close;
      anchorIndex = index;
      anchorBarId = point.barId;
      direction = null;
      extreme = null;
      extremeIndex = null;
      previousElementId = null;
      previousIndex = index;
      continue;
    }
    if (direction === null) {
      if (point.close === anchorPrice) {
        previousIndex = index;
        continue;
      }
      direction = point.close > anchorPrice ? 'up' : 'down';
      extreme = point.close;
      extremeIndex = index;
      push(point, anchorPrice, anchorIndex, point.close, index, direction, true);
      previousIndex = index;
      continue;
    }
    if (direction === 'up') {
      if (point.close > extreme) {
        push(point, extreme, extremeIndex, point.close, index, 'up', false);
        extreme = point.close;
        extremeIndex = index;
      } else if (point.close <= extreme - reversal) {
        push(point, extreme, extremeIndex, point.close, index, 'down', false);
        direction = 'down';
        extreme = point.close;
        extremeIndex = index;
      }
    } else if (point.close < extreme) {
      push(point, extreme, extremeIndex, point.close, index, 'down', false);
      extreme = point.close;
      extremeIndex = index;
    } else if (point.close >= extreme + reversal) {
      push(point, extreme, extremeIndex, point.close, index, 'up', false);
      direction = 'up';
      extreme = point.close;
      extremeIndex = index;
    }
    previousIndex = index;
  }
  return elements;
}

/**
 * Point & Figure cells from close only.
 */
export function computePointAndFigure(points, parameters, indexOf) {
  assertPlainObject(parameters, 'derived.pointAndFigure', 'parameters');
  const cellSize = assertFiniteNumber(parameters.cellSize, 'derived.pointAndFigure', 'cellSize');
  if (!(cellSize > 0)) {
    fail('INVALID_PARAMETER', 'derived.pointAndFigure', '"cellSize" must be greater than zero', {
      field: 'cellSize'
    });
  }
  const reversal = assertPositiveInteger(
    parameters.reversal,
    'derived.pointAndFigure',
    'reversal'
  );
  if (!Number.isFinite(reversal * cellSize)) {
    fail('DERIVED_STATE', 'derived.pointAndFigure', 'reversal distance must be finite', { field: 'reversal' });
  }
  assertOhlc(points);
  const resolve = indexOf ?? sequentialResolver(points);
  const elements = [];
  const counters = new Map();
  let anchor = null;
  let direction = null;
  let extreme = null;
  let column = 0;
  let previousElementId = null;
  let previousIndex = null;
  const advance = (value, direction) => {
    const next = value + direction * cellSize;
    if (!Number.isFinite(next) || next === value) {
      fail('DERIVED_STATE', 'derived.pointAndFigure', 'cellSize cannot advance at this price', { field: 'cellSize' });
    }
    return next;
  };


  const add = (point, kind, level) => {
    if (elements.length >= 1_000_000) {
      fail('DERIVED_STATE', 'derived.pointAndFigure', 'cell expansion exceeds the supported limit', { field: 'cellSize' });
    }
    const ordinal = nextOrdinal(counters, point.barId);
    const id = `${point.barId}#${ordinal}`;
    elements.push({
      id,
      type: 'pointAndFigure',
      completionBarId: point.barId,
      barIds: [point.barId],
      previousElementId,
      kind,
      level,
      column
    });
    previousElementId = id;
  };

  for (const point of points) {
    const index = resolve(point.barId);
    if (anchor === null || index !== previousIndex + 1) {
      anchor = point.close;
      direction = null;
      extreme = null;
      column = 0;
      previousElementId = null;
      previousIndex = index;
      continue;
    }
    if (direction === null) {
      if (point.close >= anchor + cellSize) {
        direction = 'up';
        extreme = anchor;
        while (point.close >= extreme + cellSize) {
          extreme = advance(extreme, 1);
          add(point, 'X', extreme);
        }
      } else if (point.close <= anchor - cellSize) {
        direction = 'down';
        extreme = anchor;
        while (point.close <= extreme - cellSize) {
          extreme = advance(extreme, -1);
          add(point, 'O', extreme);
        }
      }
      previousIndex = index;
      continue;
    }
    if (direction === 'up') {
      while (point.close >= extreme + cellSize) {
        extreme = advance(extreme, 1);
        add(point, 'X', extreme);
      }
      if (point.close <= extreme - reversal * cellSize) {
        direction = 'down';
        column += 1;
        let level = advance(extreme, -1);
        while (level >= point.close) {
          add(point, 'O', level);
          extreme = level;
          if (level > point.close) level = advance(level, -1);
          else break;
        }
      }
    } else {
      while (point.close <= extreme - cellSize) {
        extreme = advance(extreme, -1);
        add(point, 'O', extreme);
      }
      if (point.close >= extreme + reversal * cellSize) {
        direction = 'up';
        column += 1;
        let level = advance(extreme, 1);
        while (level <= point.close) {
          add(point, 'X', level);
          extreme = level;
          if (level < point.close) level = advance(level, 1);
          else break;
        }
      }
    }
    previousIndex = index;
  }
  return elements;
}

const COMPUTE = {
  heikinAshi: (points, parameters, indexOf) => computeHeikinAshi(points, indexOf),
  renko: computeRenko,
  kagi: computeKagi,
  pointAndFigure: computePointAndFigure
};

export const DERIVED_TYPES = Object.freeze(['heikinAshi', 'renko', 'kagi', 'pointAndFigure']);

/** Views that own an independent element axis (Heikin Ashi reuses the source axis). */
export const INDEPENDENT_DERIVED_TYPES = Object.freeze(['renko', 'kagi', 'pointAndFigure']);

function normalizeParameters(type, parameters) {
  if (parameters === undefined) {
    fail('INVALID_PARAMETER', `derived.${type}`, '"parameters" is required', {
      field: 'parameters'
    });
  }
  assertPlainObject(parameters, `derived.${type}`, 'parameters');
  if (type === 'heikinAshi') {
    for (const key of Object.keys(parameters)) {
      fail('INVALID_PARAMETER', 'derived.heikinAshi', 'Heikin Ashi has no parameters', {
        field: key
      });
    }
    return Object.freeze({});
  }
  if (type === 'renko') {
    const brickSize = assertFiniteNumber(parameters.brickSize, 'derived.renko', 'brickSize');
    if (!(brickSize > 0)) {
      fail('INVALID_PARAMETER', 'derived.renko', '"brickSize" must be greater than zero', {
        field: 'brickSize'
      });
    }
    return Object.freeze({ brickSize });
  }
  if (type === 'kagi') {
    const reversal = assertFiniteNumber(parameters.reversal, 'derived.kagi', 'reversal');
    if (!(reversal > 0)) {
      fail('INVALID_PARAMETER', 'derived.kagi', '"reversal" must be greater than zero', {
        field: 'reversal'
      });
    }
    return Object.freeze({ reversal });
  }
  const cellSize = assertFiniteNumber(parameters.cellSize, 'derived.pointAndFigure', 'cellSize');
  if (!(cellSize > 0)) {
    fail('INVALID_PARAMETER', 'derived.pointAndFigure', '"cellSize" must be greater than zero', {
      field: 'cellSize'
    });
  }
  const reversal = assertPositiveInteger(
    parameters.reversal,
    'derived.pointAndFigure',
    'reversal'
  );
  return Object.freeze({ cellSize, reversal });
}

function copyElement(element) {
  const out = { ...element };
  out.barIds = element.barIds.slice();
  return out;
}

/**
 * A derived representation of one OHLC series. Renko, Kagi and Point & Figure
 * own an independent index scale; Heikin Ashi stays on the source scale.
 */
export class DerivedView {
  constructor({ id, type, source, parameters, owner = null }) {
    if (!COMPUTE[type]) {
      fail('INVALID_ARGUMENT', 'chart.addDerivedView', 'unknown derived view type', {
        field: 'type'
      });
    }
    if (!source || !source.isOhlc) {
      fail('DERIVED_SOURCE', 'chart.addDerivedView', 'source must be a candlestick or bar series', {
        field: 'source'
      });
    }
    this._id = id;
    this._type = type;
    this._source = source;
    this._owner = owner;
    this._parameters = normalizeParameters(type, parameters);
    this._elements = [];
    this._byId = new Map();
    this._indexById = new Map();
    this._barToElement = new Map();
    this._elementToBar = new Map();
    this._revision = 0;
    this._identityKeys = new Map();
    this._identityDigests = new Map();
    const namespace = new Uint32Array(4);
    globalThis.crypto.getRandomValues(namespace);
    this._identityNamespace = Array.from(namespace, value => value.toString(16).padStart(8, '0')).join('');
    this._visible = true;
    this._selection = null;
    this._indexScale = new IndexScale({
      name: `derived:${id}`,
      assertAlive: operation => this._owner?._assertAlive?.(operation),
      width: 0,
      provider: {
        length: () => this._elements.length,
        barIdAt: (index) => this._elements[index]?.id ?? null,
        indexOf: (elementId) => {
          const index = this._indexById.get(elementId);
          return index === undefined ? null : index;
        },
        slotAt: () => null
      },
      onChange: () => this._owner?._onDerivedScaleChange?.(this)
    });
    this.recompute();
  }
  get id() { this._owner?._assertAlive?.('derived.id'); return this._id; }
  get type() { this._owner?._assertAlive?.('derived.type'); return this._type; }
  get visible() { this._owner?._assertAlive?.('derived.visible'); return this._visible; }
  set visible(value) { this._owner?._assertAlive?.('derived.visible'); this._visible = value; }


  get sourceId() {
    this._owner?._assertAlive?.('derived.sourceId');
    return this._source.id;
  }

  get revision() {
    this._owner?._assertAlive?.('derived.revision');
    return this._revision;
  }

  get length() {
    this._owner?._assertAlive?.('derived.length');
    return this._elements.length;
  }

  parameters() {
    this._owner?._assertAlive?.('derived.parameters');
    return { ...this._parameters };
  }

  setVisible(visible) {
    this._owner?._assertAlive?.('derived.setVisible');
    if (typeof visible !== 'boolean') {
      fail('INVALID_TYPE', 'derived.setVisible', '"visible" must be a boolean', {
        field: 'visible'
      });
    }
    this.visible = visible;
    this._owner?._onDerivedVisibilityChange?.(this);
  }

  /** Selection is stored by element id and may become unresolved. */
  setSelection(elementId) {
    this._owner?._assertAlive?.('derived.setSelection');
    if (elementId !== null && (typeof elementId !== 'string' || elementId.length === 0)) {
      fail('INVALID_ARGUMENT', 'derived.setSelection', '"elementId" must be a non-empty string or null', {
        field: 'elementId'
      });
    }
    this._selection = elementId;
    this._owner?.requestRender?.();
  }

  getSelection() {
    this._owner?._assertAlive?.('derived.getSelection');
    const element = this._selection === null ? null : this._byId.get(this._selection) ?? null;
    return {
      elementId: this._selection,
      resolved: element !== null,
      element: element ? copyElement(element) : null
    };
  }

  indexScale() {
    this._owner?._assertAlive?.('derived.indexScale');
    return this._indexScale;
  }

  _compute(parameters, points = this._source._points, indexOf = (barId) => this._source._timeline.indexOf(barId), metadata = this._source._metadata) {
    const raw = COMPUTE[this.type](points, parameters, indexOf);
    const nextKeys = new Map(), nextDigests = new Map();
    const intern = key => {
      const encoded = JSON.stringify(key);
      let id = nextKeys.get(encoded) ?? this._identityKeys.get(encoded);
      if (id === undefined) id = provenanceDigest(encoded);
      const existing = nextDigests.get(id) ?? this._identityDigests.get(id);
      if (existing !== undefined && existing !== encoded) {
        fail('DERIVED_STATE', 'derived.identity', 'provenance digest collision', { field: 'source' });
      }
      nextKeys.set(encoded, id);
      nextDigests.set(id, encoded);
      return id;
    };
    const scoped = metadata?.instrumentId != null && metadata?.interval != null && metadata?.sourceId != null;
    const root = intern(['context', this.type, parameters, metadata?.instrumentId ?? null, metadata?.interval ?? null, metadata?.sourceId ?? null, scoped ? null : this._identityNamespace]);
    const grouped = new Map();
    for (const element of raw) {
      if (!grouped.has(element.completionBarId)) grouped.set(element.completionBarId, []);
      grouped.get(element.completionBarId).push(element);
    }
    const remapped = [], rawIds = new Map();
    let previousIndex = null, prefix = root, pending = [], inputs = [];
    for (const point of points) {
      const index = indexOf(point.barId);
      if (previousIndex === null || index !== previousIndex + 1) { prefix = root; pending = []; inputs = []; }
      inputs.push(this.type === 'heikinAshi'
        ? [point.barId, point.open, point.high, point.low, point.close]
        : [point.barId, point.close]);
      pending.push(point.barId);
      const elements = grouped.get(point.barId) ?? [];
      for (let ordinal = 0; ordinal < elements.length; ordinal++) {
        const element = elements[ordinal];
        const previous = element.previousElementId ? rawIds.get(element.previousElementId) : null;
        const identity = intern(['element', prefix, inputs, previous, ordinal]);
        const id = `${this.id}:${identity}`;
        remapped.push({ ...element, id, previousElementId: previous, barIds: ordinal === 0 ? pending : [point.barId] });
        rawIds.set(element.id, id);
        pending = [];
        if (ordinal === elements.length - 1) {
          prefix = identity;
          inputs = [];
        }
      }
      previousIndex = index;
    }
    this._identityKeys = nextKeys;
    this._identityDigests = nextDigests;
    return remapped;
  }

  recompute() {
    this._owner?._assertAlive?.('derived.recompute');
    return this._applyComputed(this._compute(this._parameters));
  }

  _applyComputed(elements) {
    this._elements = elements;
    this._byId = new Map();
    this._indexById = new Map();
    this._barToElement = new Map();
    this._elementToBar = new Map();
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      this._byId.set(element.id, element);
      this._indexById.set(element.id, i);
      this._barToElement.set(element.completionBarId, element.id);
      this._elementToBar.set(element.id, element.completionBarId);
    }
    this._revision += 1;
    this._indexScale.handleReplace();
    return this;
  }

  setParameters(parameters) {
    this._owner?._assertAlive?.('derived.setParameters');
    const normalized = normalizeParameters(this.type, parameters);
    const candidate = this._compute(normalized);
    this._parameters = normalized;
    this._elements = candidate;
    this._byId = new Map();
    this._indexById = new Map();
    this._barToElement = new Map();
    this._elementToBar = new Map();
    for (let i = 0; i < candidate.length; i += 1) {
      const element = candidate[i];
      this._byId.set(element.id, element);
      this._indexById.set(element.id, i);
      this._barToElement.set(element.completionBarId, element.id);
      this._elementToBar.set(element.id, element.completionBarId);
    }
    this._revision += 1;
    this._indexScale.handleReplace();
    this._owner?._onDerivedParametersChange?.(this);
    return this;
  }

  elements() {
    this._owner?._assertAlive?.('derived.elements');
    return this._elements.map(copyElement);
  }

  element(elementId) {
    this._owner?._assertAlive?.('derived.element');
    const element = this._byId.get(elementId);
    return element ? copyElement(element) : null;
  }

  /** Last element completed by this source bar, or null. */
  barIdToElement(barId) {
    this._owner?._assertAlive?.('derived.barIdToElement');
    return this._barToElement.get(barId) ?? null;
  }

  /** Id of the last element completed on this source bar or earlier, or null when none exists. */
  elementAtOrBefore(barId) {
    this._owner?._assertAlive?.('derived.elementAtOrBefore');
    const exact = this._barToElement.get(barId);
    if (exact !== undefined) return exact;
    const target = this._source._timeline.indexOf(barId);
    if (target === null) return null;
    let lo = 0;
    let hi = this._elements.length - 1;
    let found = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const at = this._source._timeline.indexOf(this._elements[mid].completionBarId);
      if (at === null) {
        lo = mid + 1;
      } else if (at <= target) {
        found = this._elements[mid].id;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  /** Completion bar of an element, or null. */
  elementToBarId(elementId) {
    this._owner?._assertAlive?.('derived.elementToBarId');
    return this._elementToBar.get(elementId) ?? null;
  }

  hitTest(point, radius = 6) {
    this._owner?._assertAlive?.('derived.hitTest');
    assertPlainObject(point, 'derived.hitTest', 'point');
    const x = assertFiniteNumber(point.x, 'derived.hitTest', 'point.x');
    const y = assertFiniteNumber(point.y, 'derived.hitTest', 'point.y');
    radius = assertFiniteNumber(radius, 'derived.hitTest', 'radius');
    if (radius < 0) fail('INVALID_ARGUMENT', 'derived.hitTest', 'radius must not be negative', { field: 'radius' });
    if (!this.visible || !this._owner) return null;
    const layout = this._owner._layout ?? this._owner._computeLayout();
    const pane = this._owner._paneRect(this._source.pane.id);
    const priceScale = this._source.pane.priceScales.get(this._source.priceScaleId);
    if (!pane || !priceScale?.visible || x < layout.plotX || x > layout.plotX + layout.plotWidth || y < pane.y || y > pane.y + pane.height) return null;
    const scale = this.type === 'heikinAshi' ? this._owner._indexScale : this._indexScale;
    const logical = scale.coordinateToLogical(x - layout.plotX);
    if (logical === null) return null;
    const reach = Math.ceil((radius + Math.max(4, scale.barSpacing * 0.7) / 2) / scale.barSpacing) + 1;
    const start = Math.max(0, Math.floor(logical) - reach);
    const end = Math.min(scale.length - 1, Math.ceil(logical) + reach);
    const yOf = value => {
      const coordinate = priceScale.priceToCoordinate(value);
      return coordinate === null ? null : pane.y + coordinate;
    };
    let best = null, bestDistance = Infinity;
    for (let index = start; index <= end; index++) {
      const id = this.type === 'heikinAshi'
        ? this.barIdToElement(this._owner._timeline.slotAt(index)?.barId)
        : scale.indexToBarId(index);
      const element = id ? this._byId.get(id) : null;
      if (!element) continue;
      const coordinate = scale.indexToCoordinate(index);
      if (coordinate === null) continue;
      const cx = layout.plotX + coordinate;
      let distance;
      if (this.type === 'kagi') {
        const prior = index === 0 ? scale.logicalToCoordinate(-0.5) : scale.indexToCoordinate(index - 1);
        const y1 = yOf(element.fromPrice), y2 = yOf(element.toPrice);
        if (prior === null || y1 === null || y2 === null) continue;
        const x1 = layout.plotX + prior, dx = cx - x1, dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / lengthSquared));
        distance = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      } else {
        const top = yOf(this.type === 'pointAndFigure' ? element.level : element.high);
        const bottom = yOf(this.type === 'pointAndFigure' ? element.level : element.low);
        if (top === null || bottom === null) continue;
        const halfWidth = this.type === 'pointAndFigure'
          ? Math.max(4, Math.min(scale.barSpacing * 0.7, 20)) / 2
          : Math.max(1, Math.floor(scale.barSpacing * 0.7)) / 2;
        const halfHeight = this.type === 'pointAndFigure' ? halfWidth : 0;
        const dx = Math.max(0, Math.abs(x - cx) - halfWidth);
        const dy = Math.max(0, Math.min(top, bottom) - halfHeight - y, y - Math.max(top, bottom) - halfHeight);
        distance = Math.hypot(dx, dy);
      }
      if (distance <= radius && distance < bestDistance) { best = element; bestDistance = distance; }
    }
    if (!best) return null;
    const sourceBarIds = this.sourceBarIds(best.id);
    return { element: copyElement(best), sourceBarIds, sourceValues: sourceBarIds.map(barId => this._source.point(barId)) };
  }

  /**
   * Full chronological source barIds for an element, resolved through the
   * compact previousElementId chain.
   */
  sourceBarIds(elementId) {
    this._owner?._assertAlive?.('derived.sourceBarIds');
    const chain = [];
    let cursor = elementId;
    const guard = new Set();
    while (cursor !== null && cursor !== undefined) {
      if (guard.has(cursor)) {
        fail('DERIVED_STATE', 'derived.sourceBarIds', 'provenance chain contains a cycle', {
          field: 'elementId'
        });
      }
      guard.add(cursor);
      const element = this._byId.get(cursor);
      if (!element) break;
      chain.push(element.barIds);
      cursor = element.previousElementId;
    }
    const out = [];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      for (const barId of chain[i]) {
        if (out[out.length - 1] !== barId) out.push(barId);
      }
    }
    return out;
  }

  _dispose() {
    this._elements = [];
    this._byId.clear();
    this._indexById.clear();
    this._barToElement.clear();
    this._elementToBar.clear();
    this._identityKeys.clear();
    this._identityDigests.clear();
    this._source = null;
    this._parameters = null;
    this._selection = null;
  }

  remove() {
    this._owner?._assertAlive?.('derived.remove');
    this._owner?._removeDerivedView?.(this);
  }
}
