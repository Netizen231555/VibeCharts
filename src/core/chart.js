import { ChartError, fail } from '../errors.js';
import { DerivedView, INDEPENDENT_DERIVED_TYPES } from './derived.js';
import { DEFAULT_OPTIONS, mergeChartOptions, normalizeMargins } from './options.js';
import { IndexScale, PriceScale } from './scales.js';
import { Series } from './series.js';
import { Timeline } from './timeline.js';
import {
  assertArray,
  assertBoolean,
  assertFiniteNumber,
  assertKnownKeys,
  assertNonNegativeNumber,
  assertPlainObject,
  assertPositiveNumber,
  assertSafeInteger,
  assertString,
  isOhlcType,
  normalizeMetadata,
  normalizeSlots,
  scalesCompatible,
  validateTime
} from './validate.js';
import { axisColumns, computeLayout } from '../render/layout.js';
import { drawChart } from '../render/canvas.js';
import { resolveTheme } from '../render/theme.js';
import { translate } from './messages.js';

export const SERIES_TYPES = Object.freeze([
  'candlestick',
  'bar',
  'line',
  'histogram',
  'area',
  'baseline'
]);

export const CHART_EVENTS = Object.freeze([
  'datachange',
  'visibleRangeChange',
  'crosshairMove',
  'resize',
  'destroy',
  'error',
  'render'
]);

const SERIES_COMMON = new Set([
  'id',
  'priceScaleId',
  'metadata',
  'visible',
  'lastValueVisible',
  'title',
  'priceLine',
  'lastValueColorMode'
]);

const PRICE_LINE_STYLES = ['solid', 'dashed', 'dotted'];
const LAST_VALUE_COLOR_MODES = ['neutral', 'direction'];

/** Presentation options shared by every series type; absent keys stay absent. */
function normalizeSeriesPresentation(options, operation) {
  const out = {};
  if (options.priceLine !== undefined) {
    assertPlainObject(options.priceLine, operation, 'options.priceLine');
    assertKnownKeys(options.priceLine, new Set(['visible', 'style', 'color', 'width']), operation, 'options.priceLine');
    const line = {};
    const { visible, style, color, width } = options.priceLine;
    if (visible !== undefined) line.visible = assertBoolean(visible, operation, 'options.priceLine.visible');
    if (style !== undefined) {
      if (!PRICE_LINE_STYLES.includes(style)) {
        fail('INVALID_ARGUMENT', operation, `"options.priceLine.style" must be one of ${PRICE_LINE_STYLES.join(', ')}`, { field: 'options.priceLine.style' });
      }
      line.style = style;
    }
    if (color !== undefined) line.color = color === null ? null : assertString(color, operation, 'options.priceLine.color', { nonEmpty: true });
    if (width !== undefined) line.width = assertPositiveNumber(width, operation, 'options.priceLine.width');
    out.priceLine = Object.freeze(line);
  }
  if (options.lastValueColorMode !== undefined) {
    if (!LAST_VALUE_COLOR_MODES.includes(options.lastValueColorMode)) {
      fail('INVALID_ARGUMENT', operation, `"options.lastValueColorMode" must be one of ${LAST_VALUE_COLOR_MODES.join(', ')}`, { field: 'options.lastValueColorMode' });
    }
    out.lastValueColorMode = options.lastValueColorMode;
  }
  return out;
}

const SERIES_STYLE = {
  candlestick: new Set([
    'upColor',
    'downColor',
    'equalColor',
    'borderUpColor',
    'borderDownColor',
    'borderEqualColor',
    'wickUpColor',
    'wickDownColor',
    'wickEqualColor',
    'borderVisible',
    'wickVisible'
  ]),
  bar: new Set(['upColor', 'downColor', 'equalColor']),
  line: new Set(['color', 'lineWidth']),
  histogram: new Set(['color', 'upColor', 'downColor']),
  area: new Set(['basePrice', 'lineColor', 'fillColor', 'lineWidth']),
  baseline: new Set([
    'basePrice',
    'aboveLineColor',
    'belowLineColor',
    'aboveFillColor',
    'belowFillColor',
    'lineWidth'
  ])
};

const MODULE_HOOKS = new Set([
  'onDataChange',
  'onSeriesRemoved',
  'onBeforeSeriesRemove',
  'onBeforeDataCommit',
  'onReset',
  'onTimelineChange',
  'onHistoryPreview',
  'onBeforeHistoryRemove',
  'onHistoryRemoved',
  'onCrosshairMove',
  'onVisibleRangeChange',
  'onResize',
  'onRender',
  'onDestroy',
  'onError',
  'onExportState',
  'onValidateRestore',
  'onCaptureRestore',
  'onRollbackRestore',
  'onRestoreState'
]);

const RESERVED_MODULE_NAMES = new Set([
  'timeline',
  'surface',
  'integration',
  'series',
  'container',
  'canvas',
  'element',
  'id',
  'destroy'
]);

let chartCounter = 0;

function normalizeSeriesStyle(type, options, operation) {
  const out = {};
  for (const key of SERIES_STYLE[type]) {
    if (options[key] === undefined) continue;
    if (key === 'borderVisible' || key === 'wickVisible') {
      out[key] = assertBoolean(options[key], operation, `options.${key}`);
    } else if (key === 'lineWidth') {
      out[key] = assertPositiveNumber(options[key], operation, `options.${key}`);
    } else if (key === 'basePrice') {
      out[key] = assertFiniteNumber(options[key], operation, `options.${key}`);
    } else {
      out[key] = assertString(options[key], operation, `options.${key}`, { nonEmpty: true });
    }
  }
  return out;
}

function normalizeSeriesOptions(type, options) {
  assertPlainObject(options, 'chart.addSeries', 'options');
  const allowed = new Set([...SERIES_COMMON, ...SERIES_STYLE[type]]);
  assertKnownKeys(options, allowed, 'chart.addSeries', 'options');
  const out = {};
  if (options.id !== undefined) out.id = assertString(options.id, 'chart.addSeries', 'options.id', { nonEmpty: true });
  out.priceScaleId =
    options.priceScaleId === undefined
      ? 'right'
      : assertString(options.priceScaleId, 'chart.addSeries', 'options.priceScaleId', {
          nonEmpty: true
        });
  if (options.metadata !== undefined) out.metadata = normalizeMetadata(options.metadata, 'chart.addSeries');
  if (options.visible !== undefined) {
    out.visible = assertBoolean(options.visible, 'chart.addSeries', 'options.visible');
  }
  if (options.lastValueVisible !== undefined) {
    out.lastValueVisible = assertBoolean(
      options.lastValueVisible,
      'chart.addSeries',
      'options.lastValueVisible'
    );
  }
  if (options.title !== undefined) {
    out.title = assertString(options.title, 'chart.addSeries', 'options.title');
  }
  Object.assign(out, normalizeSeriesStyle(type, options, 'chart.addSeries'));
  Object.assign(out, normalizeSeriesPresentation(options, 'chart.addSeries'));
  if ((type === 'area' || type === 'baseline') && out.basePrice === undefined) {
    fail('INVALID_ARGUMENT', 'chart.addSeries', `"${type}" requires an explicit "basePrice"`, {
      field: 'basePrice'
    });
  }
  return out;
}

const collectionTargets = new WeakMap();

function guardedCollection(owner, name, collection) {
  let proxy;
  const guardedIterator = iterator => ({
    next(...args) {
      owner._assertAlive(`pane.${name}.iterator.next`);
      return iterator.next(...args);
    },
    [Symbol.iterator]() {
      owner._assertAlive(`pane.${name}.iterator`);
      return this;
    }
  });
  proxy = new Proxy(collection, {
    get(target, key) {
      owner._assertAlive(`pane.${name}.${String(key)}`);
      const member = Reflect.get(target, key, target);
      if (typeof member !== 'function') return member;
      return (...args) => {
        owner._assertAlive(`pane.${name}.${String(key)}`);
        if (key === 'forEach') {
          const [callback, thisArg] = args;
          return target.forEach((value, index) => {
            owner._assertAlive(`pane.${name}.forEach`);
            callback.call(thisArg, value, index, proxy);
          });
        }
        const result = Reflect.apply(member, target, args);
        if (result === target) return proxy;
        if (key === Symbol.iterator || key === 'keys' || key === 'values' || key === 'entries') {
          return guardedIterator(result);
        }
        return result;
      };
    }
  });
  collectionTargets.set(proxy, collection);
  return proxy;
}

class Pane {
  constructor(owner, { id, order, height, minHeight, visible }) {
    this._owner = owner;
    this._id = id;
    this._order = order;
    this._height = height;
    this._minHeight = minHeight;
    this._visible = visible;
    this._priceScales = guardedCollection(owner, 'priceScales', new Map());
    this._series = guardedCollection(owner, 'series', new Set());
  }
  get id() { this._owner._assertAlive('pane.id'); return this._id; }
  get order() { this._owner._assertAlive('pane.order'); return this._order; }
  set order(value) { this._owner._assertAlive('pane.order'); this._order = value; }
  get height() { this._owner._assertAlive('pane.height'); return this._height; }
  set height(value) { this._owner._assertAlive('pane.height'); this._height = value; }
  get minHeight() { this._owner._assertAlive('pane.minHeight'); return this._minHeight; }
  set minHeight(value) { this._owner._assertAlive('pane.minHeight'); this._minHeight = value; }
  get visible() { this._owner._assertAlive('pane.visible'); return this._visible; }
  set visible(value) { this._owner._assertAlive('pane.visible'); this._visible = value; }
  get priceScales() { this._owner._assertAlive('pane.priceScales'); return this._priceScales; }
  get series() { this._owner._assertAlive('pane.series'); return this._series; }
}

/**
 * Chart model and lifecycle. Rendering is delegated to the injected host and
 * the pure canvas renderer, so the model runs without a DOM in tests.
 */
export class Chart {
  constructor(host, options = {}) {
    if (!host || typeof host !== 'object') {
      fail('INVALID_ARGUMENT', 'createChart', 'a chart host is required');
    }
    this._id = `chart-${++chartCounter}`;
    this._host = host;
    this._destroyed = false;
    this._ready = false;
    this._suppressCameraEvents = false;
    this._listeners = new Map();
    this._modules = new Map();
    this._seriesById = new Map();
    this._derivedViews = new Map();
    this._seriesCounter = 0;
    this._paneCounter = 0;
    this._derivedCounter = 0;
    this._replaceAnchor = null;
    this._crosshair = null;
    this._countdown = null;
    this._countdownTimer = null;
    this._reporting = false;
    this._renderRevision = 0;
    this._presentedRevision = 0;
    this._renderWaiters = [];
    this._restoring = false;
    this._restoreEvents = null;

    this._options = mergeChartOptions(DEFAULT_OPTIONS, options);
    this._theme = resolveTheme(this._options.theme);

    const size = host.getSize?.() ?? {
      width: Number.isFinite(host.width) ? host.width : 0,
      height: Number.isFinite(host.height) ? host.height : 0
    };
    this._width = Number.isFinite(size.width) ? size.width : 0;
    this._height = Number.isFinite(size.height) ? size.height : 0;
    this._dpr = Number.isFinite(host.dpr) && host.dpr > 0 ? host.dpr : 1;

    this._container = host.container ?? null;
    this._canvas = host.canvas ?? null;
    this._element = host.element ?? null;

    this._timeline = new Timeline({
      assertAlive: operation => this._assertAlive(operation),
      onBeforeReplace: (slots) => this._validateTimelineReplace(slots),
      onAfterReplace: () => this._onTimelineReplaced(),
      onAppend: (slots) => this._applyBatch({ timeline: { op: 'append', slots } }, true),
      onPrepend: (slots) => this._applyBatch({ timeline: { op: 'prepend', slots } }, true),
      onPreview: (plan) => this._enrichHistoryPlan(plan),
      onBeforeRemove: (plan) => this._validateHistoryRemoval(plan),
      onAfterRemove: (result, prepared) => this._onHistoryRemoved(result, prepared)
    });

    this._paneConflicts = new Map();
    this._indexScale = new IndexScale({
      name: 'index',
      assertAlive: operation => this._assertAlive(operation),
      width: 0,
      rightOffset: this._options.timeScale.rightOffset,
      provider: {
        length: () => this._timeline.length,
        barIdAt: (index) => this._timeline.slotAt(index)?.barId ?? null,
        indexOf: (barId) => this._timeline.indexOf(barId),
        slotAt: (index) => this._timeline.slotAt(index)
      },
      onChange: () => this._onIndexScaleChange()
    });

    this._panes = [];
    this._mainPane = this._createPane({ id: 'main' });
    this._panes.push(this._mainPane);

    this._surface = this._createSurface();
    this._seriesFacade = this._createSeriesFacade();

    this._applyLayout();
    this._host.attach?.(this);
    this._ready = true;
  }

  get id() { this._assertAlive('chart.id'); return this._id; }
  get container() { this._assertAlive('chart.container'); return this._container; }
  get canvas() { this._assertAlive('chart.canvas'); return this._canvas; }
  get element() { this._assertAlive('chart.element'); return this._element; }
  get surface() { this._assertAlive('chart.surface'); return this._surface; }
  get integration() { this._assertAlive('chart.integration'); return this._surface; }
  get series() { this._assertAlive('chart.series'); return this._seriesFacade; }

  // -------------------------------------------------------------------------
  // Internal guards and helpers
  // -------------------------------------------------------------------------

  _assertAlive(operation) {
    if (this._destroyed) {
      fail('CHART_DESTROYED', operation, 'chart has been destroyed');
    }
  }

  _resolvePane(ref, operation = 'chart') {
    if (ref === undefined || ref === null) return this._mainPane;
    if (ref instanceof Pane) {
      if (!this._panes.includes(ref)) {
        fail('UNKNOWN_PANE', operation, 'pane does not belong to this chart', { field: 'pane' });
      }
      return ref;
    }
    if (typeof ref === 'string') {
      const pane = this._panes.find((candidate) => candidate.id === ref);
      if (!pane) {
        fail('UNKNOWN_PANE', operation, 'unknown pane id', { field: 'pane' });
      }
      return pane;
    }
    fail('INVALID_TYPE', operation, '"pane" must be a pane object or id', { field: 'pane' });
  }

  _resolveSeries(ref, operation = 'chart') {
    if (ref instanceof Series) {
      if (ref._owner !== this) {
        fail('SERIES_OWNERSHIP', operation, 'series belongs to another chart', { field: 'series' });
      }
      if (!this._seriesById.has(ref.id)) {
        fail('UNKNOWN_SERIES', operation, 'series has been removed', { field: 'series' });
      }
      return ref;
    }
    if (typeof ref === 'string') {
      const series = this._seriesById.get(ref);
      if (!series) {
        fail('UNKNOWN_SERIES', operation, 'unknown series id', { field: 'seriesId' });
      }
      return series;
    }
    fail('INVALID_TYPE', operation, '"series" must be a series object or id', { field: 'series' });
  }

  _createPane(options = {}) {
    const allowed = new Set(['id', 'order', 'height', 'minHeight', 'visible']);
    assertKnownKeys(options, allowed, 'chart.addPane', 'options');
    const id =
      options.id === undefined
        ? `pane-${++this._paneCounter}`
        : assertString(options.id, 'chart.addPane', 'options.id', { nonEmpty: true });
    const existing = this._panes ?? [];
    if (existing.some((pane) => pane.id === id) || (existing.length > 0 && id === 'main')) {
      fail('INVALID_ARGUMENT', 'chart.addPane', 'pane id already exists', { field: 'id' });
    }
    const height =
      options.height === undefined
        ? null
        : assertPositiveNumber(options.height, 'chart.addPane', 'options.height');
    const minHeight =
      options.minHeight === undefined
        ? 24
        : assertPositiveNumber(options.minHeight, 'chart.addPane', 'options.minHeight');
    const visible =
      options.visible === undefined
        ? true
        : assertBoolean(options.visible, 'chart.addPane', 'options.visible');
    const order =
      options.order === undefined
        ? this._panes?.length ?? 0
        : assertFiniteNumber(options.order, 'chart.addPane', 'options.order');
    const pane = new Pane(this, { id, order, height, minHeight, visible });
    pane.priceScales.set(
      'right',
      new PriceScale({
        name: 'right',
        side: 'right',
        assertAlive: operation => this._assertAlive(operation),
        height: 0,
        onChange: layoutChanged => this._onPriceScaleChange(layoutChanged),
        defaultMargins: () => this._options?.priceScale?.margins ?? null
      })
    );
    return pane;
  }

  _ensurePriceScale(pane, scaleId) {
    let scale = pane.priceScales.get(scaleId);
    if (scale) return scale;
    scale = new PriceScale({
      name: scaleId,
      side: scaleId === 'left' ? 'left' : 'right',
      assertAlive: operation => this._assertAlive(operation),
      height: 0,
      onChange: layoutChanged => this._onPriceScaleChange(layoutChanged),
      defaultMargins: () => this._options?.priceScale?.margins ?? null
    });
    pane.priceScales.set(scaleId, scale);
    if (this._ready) this._applyLayout();
    return scale;
  }

  _paneRect(paneId) {
    const layout = this._layout ?? this._computeLayout();
    return layout.panes.find((rect) => rect.pane.id === paneId) ?? null;
  }

  _derivedPaneIds() {
    const ids = new Set();
    for (const pane of this._panes) {
      if (this._paneXContext(pane).kind === 'derived') ids.add(pane.id);
    }
    return ids;
  }

  _computeLayout() {
    const derivedPaneIds = this._derivedPaneIds();
    this._derivedLayoutKey = [...derivedPaneIds].join('\u0000');
    return computeLayout({
      width: this._width,
      height: this._height,
      panes: this._panes,
      timeScaleVisible: this._options.timeScale.visible,
      derivedPaneIds
    });
  }

  /** Re-lays out and refits prices when a pane gained or lost its own derived x-axis. */
  _syncDerivedLayout() {
    if (!this._ready || this._destroyed) return;
    if ([...this._derivedPaneIds()].join('\u0000') === this._derivedLayoutKey) return;
    this._applyLayout();
    this._refreshPriceScales();
  }

  _applyLayout() {
    this._layout = this._computeLayout();
    this._suppressCameraEvents = true;
    try {
      for (const rect of this._layout.panes) {
        for (const scale of rect.pane.priceScales.values()) scale.setHeight(rect.height);
      }
      this._indexScale.setWidth(this._layout.plotWidth);
      for (const view of this._derivedViews.values()) {
        view.indexScale().setWidth(this._layout.plotWidth);
      }
    } finally {
      this._suppressCameraEvents = false;
    }
  }

  // -------------------------------------------------------------------------
  // Timeline wiring
  // -------------------------------------------------------------------------

  _validateTimelineReplace(slots) {
    const next = new Set(slots.map((slot) => slot.barId));
    for (const series of this._seriesById.values()) {
      for (const point of series._points) {
        if (!next.has(point.barId)) {
          fail(
            'UNKNOWN_BAR_ID',
            'timeline.setTimeline',
            'new timeline would drop a slot referenced by series data; call resetData() first',
            { field: 'barId', seriesId: series.id }
          );
        }
      }
    }
    const positions = new Map(slots.map((slot, index) => [slot.barId, index]));
    const resolveIndex = barId => positions.get(barId) ?? null;
    for (const series of this._seriesById.values()) {
      series._validateStrictlyIncreasing(series._points, 'timeline.setTimeline', 0, resolveIndex);
    }
    this._replaceDerived = this._previewDerived({ kind: 'timelineReplace', timelineOp: 'replace', series: [] }, [], resolveIndex);
    const visible = this._indexScale.getVisibleRange();
    if (visible && this._timeline.length > 0) {
      const index = Math.min(
        this._timeline.length - 1,
        Math.max(0, Math.ceil(visible.from))
      );
      const slot = this._timeline.slotAt(index);
      this._replaceAnchor = slot ? { barId: slot.barId, offset: visible.from - index } : null;
    } else {
      this._replaceAnchor = null;
    }
  }

  _onTimelineReplaced() {
    if (this._replaceAnchor) {
      const index = this._timeline.indexOf(this._replaceAnchor.barId);
      if (index !== null) {
        this._indexScale._rebaseFrom(index + this._replaceAnchor.offset);
      }
    }
    this._replaceAnchor = null;
    this._indexScale.handleReplace();
    this._afterTimelineStructure(this._replaceDerived);
    this._replaceDerived = null;
    this._notifyModules('onTimelineChange', { kind: 'replace' });
    this._emit('datachange', { chartId: this._id, kind: 'timelineReplace', range: this._indexScale.getVisibleRange() });
    this._requestRender();
  }

  _afterTimelineStructure(candidates = null) {
    this._clearStaleCountdown();
    if (candidates) {
      for (const [view, elements] of candidates) view._applyComputed(elements);
    } else {
      for (const view of this._derivedViews.values()) view.recompute();
    }
    this._refreshPriceScales();
  }

  _clearStaleCountdown() {
    if (this._countdown && this._timeline.indexOf(this._countdown.barId) !== this._timeline.length - 1) {
      this._countdown = null;
      this._stopCountdown();
    }
  }

  _enrichHistoryPlan(base) {
    const removed = new Set(base.removedBarIds);
    const series = [];
    for (const entry of this._seriesById.values()) {
      let pointCount = 0;
      for (const point of entry._points) if (removed.has(point.barId)) pointCount += 1;
      if (pointCount > 0) series.push({ seriesId: entry.id, pointCount });
    }
    const extra = { series, drawings: [], alerts: [], affectsIndicators: false, affectsDerived: false };
    for (const module of this._modules.values()) {
      if (typeof module.hooks.onHistoryPreview !== 'function') continue;
      const result = module.hooks.onHistoryPreview({ ...base, ...extra });
      if (!result || typeof result !== 'object') continue;
      if (Array.isArray(result.drawings)) extra.drawings = result.drawings;
      if (Array.isArray(result.alerts)) extra.alerts = result.alerts;
      if (result.affectsIndicators === true) extra.affectsIndicators = true;
      if (result.affectsDerived === true) extra.affectsDerived = true;
    }
    if (this._derivedViews.size > 0 && base.removedBarIds.length > 0) extra.affectsDerived = true;
    return { ...base, ...extra, seriesRevisions: [...this._seriesById.values()].map(entry => ({ id: entry.id, revision: entry.revision })) };
  }

  _validateHistoryRemoval(plan) {
    const revisions = [...this._seriesById.values()].map(entry => ({ id: entry.id, revision: entry.revision }));
    if (!Array.isArray(plan.seriesRevisions) || plan.seriesRevisions.length !== revisions.length ||
        plan.seriesRevisions.some((entry, index) => entry?.id !== revisions[index].id || entry.revision !== revisions[index].revision)) {
      fail('STALE_PLAN', 'timeline.removeHistoryBefore', 'series changed since preview; preview again', { field: 'seriesRevisions' });
    }
    const current = this._enrichHistoryPlan({ operation: 'removeHistoryBefore', boundaryBarId: plan.boundaryBarId,
      revision: plan.revision, removedBarIds: this._timeline.listSlots().slice(0, this._timeline.indexOf(plan.boundaryBarId)).map(slot => slot.barId) });
    for (const field of ['drawings', 'alerts']) {
      const ids = value => Array.isArray(value) ? value.map(item => item.id).sort() : null;
      if (JSON.stringify(ids(plan[field])) !== JSON.stringify(ids(current[field]))) {
        fail('STALE_PLAN', 'timeline.removeHistoryBefore', `${field} affected by removal changed; preview again`, { field });
      }
    }
    if (plan.affectsIndicators !== current.affectsIndicators || plan.affectsDerived !== current.affectsDerived) {
      fail('STALE_PLAN', 'timeline.removeHistoryBefore', 'affected calculations changed; preview again', { field: 'plan' });
    }
    for (const module of this._modules.values()) {
      if (typeof module.hooks.onBeforeHistoryRemove === 'function') {
        module.hooks.onBeforeHistoryRemove(plan);
      }
    }
    const boundary = this._timeline.indexOf(plan.boundaryBarId);
    const slots = this._timeline.listSlots().slice(boundary);
    const positions = new Map(slots.map((slot, index) => [slot.barId, index]));
    const resolveIndex = barId => positions.get(barId) ?? null;
    return this._collectPrecommit({ kind: 'historyRemove', timelineOp: 'remove', slots, series: [] }, resolveIndex, new Set());
  }

  _onHistoryRemoved({ removedBarIds, boundaryBarId }, prepared = []) {
    const removed = new Set(removedBarIds);
    for (const series of this._seriesById.values()) series._removeBarIds(removed);
    for (const item of prepared) item.series._applyPrepared(item.prepared);
    if (this._crosshair && removed.has(this._crosshair.barId)) {
      this._crosshair = null;
      this._emit('crosshairMove', { chartId: this._id, barId: null });
    }
    if (removedBarIds.length > 0) this._indexScale.handleRemovePrefix(removedBarIds.length);
    this._afterTimelineStructure(prepared.derivedCandidates);
    const payload = {
      chartId: this._id,
      kind: 'historyRemove',
      removedBarIds,
      boundaryBarId,
      range: this._indexScale.getVisibleRange()
    };
    this._notifyModules('onDataChange', payload);
    this._notifyModules('onHistoryRemoved', { removedBarIds, boundaryBarId, precommitted: true });
    this._emit('datachange', payload);
    this._requestRender();
  }

  // -------------------------------------------------------------------------
  // Camera and price scales
  // -------------------------------------------------------------------------

  _onIndexScaleChange() {
    if (this._destroyed || this._suppressCameraEvents) return;
    this._refreshPriceScales();
    const payload = {
      chartId: this._id,
      range: this._indexScale.getVisibleRange(),
      priceScales: this._priceScaleDescriptors()
    };
    this._notifyModules('onVisibleRangeChange', payload);
    this._emit('visibleRangeChange', payload);
    this._requestRender();
  }

  _onPriceScaleChange(layoutChanged = false) {
    if (this._destroyed || this._suppressCameraEvents) return;
    if (layoutChanged) this._applyLayout();
    this._refreshPriceScales();
    const payload = {
      chartId: this._id,
      range: this._indexScale.getVisibleRange(),
      priceScales: this._priceScaleDescriptors()
    };
    this._notifyModules('onVisibleRangeChange', payload);
    this._emit('visibleRangeChange', payload);
    this._requestRender();
  }

  _priceScaleDescriptors() {
    const out = [];
    for (const pane of this._panes) {
      for (const scale of pane.priceScales.values()) {
        out.push({
          paneId: pane.id,
          scaleId: scale.name,
          range: scale.getVisibleRange(),
          autoScale: scale.autoScale,
          mode: scale.mode,
          base: scale.base,
          side: scale.side,
          inverted: scale.inverted,
          visible: scale.visible,
          overlay: scale.overlay,
          margins: scale.margins
        });
      }
    }
    return out;
  }

  /**
   * X-axis context of a pane. Independent derived views (Renko/Kagi/P&F) own the
   * axis only when they are the sole visible content of their pane; otherwise the
   * pane stays on the source axis and, if an independent view is present, reports
   * a conflict.
   */
  _paneXContext(paneRef) {
    const pane = this._resolvePane(paneRef, 'chart.paneXContext');
    let visibleViews = 0;
    let independent = null;
    let independentCount = 0;
    for (const view of this._derivedViews.values()) {
      if (!view._visible || view._source?.pane !== pane) continue;
      visibleViews += 1;
      if (!INDEPENDENT_DERIVED_TYPES.includes(view.type)) continue;
      independentCount += 1;
      independent ??= view;
    }
    if (!independent) return { kind: 'source', view: null, scale: this._indexScale, conflict: null };
    let hasVisibleSeries = false;
    for (const series of pane.series) {
      if (series._options.visible !== false) {
        hasVisibleSeries = true;
        break;
      }
    }
    if (!hasVisibleSeries && independentCount === 1 && visibleViews === 1) {
      return { kind: 'derived', view: independent, scale: independent.indexScale(), conflict: null };
    }
    return {
      kind: 'conflict',
      view: independent,
      scale: this._indexScale,
      conflict: this._paneConflictMessage(pane, independent)
    };
  }

  _paneIndexScale(paneRef) {
    return this._paneXContext(paneRef).scale;
  }

  _paneDerivedView(paneRef) {
    const context = this._paneXContext(paneRef);
    return context.kind === 'derived' ? context.view : null;
  }

  _paneConflictMessage(pane, view) {
    return translate(this._options.locale, 'pane.viewConflict', { paneId: pane.id, viewId: view.id });
  }

  /** Emits one `error` per newly appeared (pane, view) conflict. */
  _reportPaneConflicts() {
    const next = new Map();
    for (const pane of this._panes) {
      if (this._paneXContext(pane).kind !== 'conflict') continue;
      for (const view of this._derivedViews.values()) {
        if (!view._visible || view._source?.pane !== pane || !INDEPENDENT_DERIVED_TYPES.includes(view.type)) continue;
        next.set(`${pane.id}\u0000${view.id}`, this._paneConflictMessage(pane, view));
      }
    }
    const previous = this._paneConflicts;
    this._paneConflicts = next;
    for (const [key, message] of next) {
      if (!previous.has(key)) this._reportError(new Error(message), 'paneConflict');
      if (this._destroyed) return;
    }
  }

  _refreshPriceScales(onlyPane = null) {
    if (this._destroyed) return false;
    let changed = false;
    for (const pane of this._panes) {
      if (onlyPane && pane !== onlyPane) continue;
      const context = this._paneXContext(pane);
      const indexScale = context.scale;
      const visible = indexScale.getVisibleRange();
      if (!visible || indexScale.length === 0) continue;
      const from = Math.max(0, Math.floor(visible.from));
      const to = Math.min(indexScale.length - 1, Math.ceil(visible.to));
      if (from > to) continue;
      const derived = context.kind === 'derived' ? context.view : null;
      for (const scale of pane.priceScales.values()) {
        if (!scale.autoScale) continue;
        let min = Infinity;
        let max = -Infinity;
        let count = 0;
        if (derived && derived._source.priceScaleId === scale.name) {
          for (let i = from; i <= to; i++) {
            const element = derived._elements[i];
            const low = derived.type === 'pointAndFigure' ? element.level : derived.type === 'kagi' ? Math.min(element.fromPrice, element.toPrice) : element.low;
            const high = derived.type === 'pointAndFigure' ? element.level : derived.type === 'kagi' ? Math.max(element.fromPrice, element.toPrice) : element.high;
            min = Math.min(min, low);
            max = Math.max(max, high);
            count++;
          }
        }
        for (const series of pane.series) {
          if (derived) continue;
          if (series._options.visible === false) continue;
          if (series.priceScaleId !== scale.name) continue;
          const ohlc = isOhlcType(series.type);
          const histogram = series.type === 'histogram' && scale.mode !== 'log';
          for (const point of series._pointsInRange(from, to)) {
            if (ohlc) {
              min = Math.min(min, point.low);
              max = Math.max(max, point.high);
            } else {
              min = Math.min(min, point.value);
              max = Math.max(max, point.value);
              // Histogram bars are anchored at zero, so the range must contain it; log scales cannot.
              if (histogram) {
                min = Math.min(min, 0);
                max = Math.max(max, 0);
              }
            }
            count += 1;
          }
        }
        if (count === 0) continue;
        try {
          scale.updateAutoRange(min, max);
          changed = true;
        } catch (error) {
          if (error?.code !== 'LOG_RANGE') throw error;
        }
      }
    }
    return changed;
  }

  // -------------------------------------------------------------------------
  // Public: data and series
  // -------------------------------------------------------------------------

  get timeline() {
    this._assertAlive('chart.timeline');
    return this._timeline;
  }

  indexScale() {
    this._assertAlive('chart.indexScale');
    return this._indexScale;
  }

  priceScale(paneRef, scaleId = 'right') {
    this._assertAlive('chart.priceScale');
    const pane = this._resolvePane(paneRef, 'chart.priceScale');
    const id = assertString(scaleId, 'chart.priceScale', 'scaleId', { nonEmpty: true });
    return this._ensurePriceScale(pane, id);
  }

  addPane(options = {}) {
    this._assertAlive('chart.addPane');
    const pane = this._createPane(options);
    this._panes.push(pane);
    this._applyLayout();
    this._notifyModules('onTimelineChange', { kind: 'paneAdd', paneId: pane.id });
    this._emit('datachange', { chartId: this._id, kind: 'paneAdd', paneId: pane.id });
    this._requestRender();
    return pane;
  }

  removePane(paneRef) {
    this._assertAlive('chart.removePane');
    const pane = this._resolvePane(paneRef, 'chart.removePane');
    if (this._panes.length === 1) {
      fail('LAST_PANE', 'chart.removePane', 'the last pane cannot be removed');
    }
    if (pane.series.size > 0) {
      fail('PANE_NOT_EMPTY', 'chart.removePane', 'remove every series from the pane first', {
        field: 'pane'
      });
    }
    this._panes = this._panes.filter((candidate) => candidate !== pane);
    this._applyLayout();
    this._emit('datachange', { chartId: this._id, kind: 'paneRemove', paneId: pane.id });
    this._requestRender();
  }

  addSeries(type, options = {}, paneRef) {
    this._assertAlive('chart.addSeries');
    if (!SERIES_TYPES.includes(type)) {
      fail('INVALID_ARGUMENT', 'chart.addSeries', 'unsupported series type', { field: 'type' });
    }
    const pane = this._resolvePane(paneRef, 'chart.addSeries');
    const normalized = normalizeSeriesOptions(type, options);
    let id = normalized.id;
    if (id === undefined) {
      do {
        id = `series-${++this._seriesCounter}`;
      } while (this._seriesById.has(id));
    } else if (this._seriesById.has(id)) {
      fail('INVALID_ARGUMENT', 'chart.addSeries', 'series id already exists', { field: 'id' });
    }
    const scaleId = normalized.priceScaleId;
    const scale = this._ensurePriceScale(pane, scaleId);
    for (const existing of pane.series) {
      if (existing.priceScaleId !== scaleId) continue;
      if (!scalesCompatible(existing._metadata, normalized.metadata ?? null)) {
        fail(
          'INCOMPATIBLE_SCALE',
          'chart.addSeries',
          'series with different declared units or currency cannot share a price scale',
          { field: 'priceScaleId' }
        );
      }
    }
    const seriesOptions = { ...normalized };
    delete seriesOptions.id;
    const series = new Series({
      id,
      type,
      options: seriesOptions,
      timeline: this._timeline,
      owner: this
    });
    series.pane = pane;
    series.priceScaleId = scaleId;
    pane.series.add(series);
    this._seriesById.set(id, series);
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'seriesAdd', seriesId: id });
    this._requestRender();
    return series;
  }

  removeSeries(seriesRef) {
    this._assertAlive('chart.removeSeries');
    const series = this._resolveSeries(seriesRef, 'chart.removeSeries');
    this._validateModules('onBeforeSeriesRemove', series);
    for (const view of [...this._derivedViews.values()]) {
      if (view._source === series) this._removeDerivedView(view);
    }
    this._notifyModules('onSeriesRemoved', series);
    series.pane.series.delete(series);
    this._seriesById.delete(series.id);
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'seriesRemove', seriesId: series.id });
    this._requestRender();
  }

  _beforeSeriesCommit(series, prepared) {
    this._validateLogValues(series, prepared.points);
    const preparedSet = new Set([series.id]);
    return this._collectPrecommit(
      {
        kind: 'series',
        operation: prepared.operation,
        series: [{ series, prepared }]
      },
      (barId) => this._timeline.indexOf(barId),
      preparedSet
    );
  }

  _applyContributions(contributions) {
    for (const item of contributions) item.series._applyPrepared(item.prepared);
  }

  /**
   * Calls module onBeforeDataCommit hooks. A hook may return series operations
   * (or {series:[...]}) that are validated and committed in the same
   * transaction as the triggering change. Throwing vetoes the transaction.
   */
  _collectPrecommit(context, resolveIndex, preparedSet) {
    const contributions = [];
    for (const module of this._modules.values()) {
      const fn = module.hooks.onBeforeDataCommit;
      if (typeof fn !== 'function') continue;
      const result = fn(context);
      if (result === undefined || result === null) continue;
      const entries = Array.isArray(result) ? result : result.series;
      if (entries === undefined) continue;
      assertArray(entries, `${module.name}.onBeforeDataCommit`, 'series');
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        assertPlainObject(entry, `${module.name}.onBeforeDataCommit`, `series[${i}]`);
        assertKnownKeys(
          entry,
          new Set(['series', 'seriesId', 'operation', 'points', 'data', 'metadata']),
          `${module.name}.onBeforeDataCommit`,
          `series[${i}]`
        );
        const series = this._resolveSeries(
          entry.series ?? entry.seriesId,
          `${module.name}.onBeforeDataCommit`
        );
        if (preparedSet.has(series.id)) {
          fail('INVALID_BATCH', `${module.name}.onBeforeDataCommit`, 'series is already in this transaction', {
            field: `series[${i}].seriesId`
          });
        }
        const operation = entry.operation ?? 'setData';
        if (!['append', 'prepend', 'update', 'correct', 'setData'].includes(operation)) {
          fail('INVALID_BATCH', `${module.name}.onBeforeDataCommit`, 'unsupported series operation', {
            field: `series[${i}].operation`
          });
        }
        const data = entry.points ?? entry.data;
        if (data === undefined) {
          fail('INVALID_ARGUMENT', `${module.name}.onBeforeDataCommit`, 'series entry requires points', {
            field: `series[${i}].points`
          });
        }
        const prepared = series._prepare(operation, data, entry.metadata, resolveIndex);
        this._validateLogValues(series, prepared.points);
        contributions.push({ series, prepared });
        preparedSet.add(series.id);
      }
    }
    const projected = new Map([...context.series.map(({ series, prepared }) => [series.id, prepared]),
      ...contributions.map(({ series, prepared }) => [series.id, prepared])]);
    if ([...projected.values()].some(prepared => prepared.metadataChanged)) {
      for (const pane of this._panes) {
        const scales = new Map();
        for (const series of pane.series) {
          const metadata = projected.get(series.id)?.metadata ?? series._metadata;
          if (scales.has(series.priceScaleId) && !scalesCompatible(scales.get(series.priceScaleId), metadata)) {
            fail('INCOMPATIBLE_SCALE', 'chart.data', 'series with different declared units or currency cannot share a price scale', { field: 'metadata' });
          }
          scales.set(series.priceScaleId, metadata);
        }
      }
    }
    contributions.derivedCandidates = this._previewDerived(context, contributions, resolveIndex);
    return contributions;
  }

  _previewDerived(context, contributions, resolveIndex) {
    const prepared = new Map([...context.series, ...contributions].map(item => [item.series.id, item.prepared]));
    const candidates = new Map();
    for (const view of this._derivedViews.values()) {
      const change = prepared.get(view.sourceId);
      if (!change && !context.timelineOp && context.kind !== 'replace') continue;
      let points = view._source._points;
      if (context.kind === 'replace') points = change?.points ?? [];
      else if (context.timelineOp === 'remove') points = points.filter(point => resolveIndex(point.barId) !== null);
      else if (change) {
        if (change.operation === 'setData') points = change.points;
        else if (change.operation === 'prepend') points = [...change.points, ...points];
        else if (change.operation === 'append') points = [...points, ...change.points];
        else if (change.operation === 'update') {
          points = points.slice();
          const point = change.points[0];
          if (points.length && points[points.length - 1].barId === point.barId) points[points.length - 1] = point;
          else points.push(point);
        } else if (change.operation === 'correct') {
          points = points.map(point => point.barId === change.points[0].barId ? change.points[0] : point);
        }
      }
      candidates.set(view, view._compute(view._parameters, points, resolveIndex, change?.metadata ?? view._source._metadata));
    }
    return candidates;
  }

  _afterSeriesCommit(series, operation, meta) {
    for (const [view, elements] of meta.derivedCandidates ?? []) view._applyComputed(elements);
    this._refreshPriceScales();
    const payload = {
      chartId: this._id,
      kind: 'series',
      operation,
      seriesId: series.id,
      barIds: meta.barIds,
      range: this._indexScale.getVisibleRange()
    };
    if (meta.barIds.length === 1) payload.barId = meta.barIds[0];
    this._notifyModules('onDataChange', payload);
    this._emit('datachange', payload);
    this._requestRender();
  }

  _validateLogValues(series, points) {
    const pane = series.pane;
    const scale = pane?.priceScales.get(series.priceScaleId);
    if (!scale || scale.mode !== 'log') return;
    for (let i = 0; i < points.length; i += 1) {
      const point = points[i];
      const values = isOhlcType(series.type) ? [point.low, point.high] : [point.value];
      for (const value of values) {
        if (!(value > 0)) {
          fail('LOG_RANGE', 'series', 'log price scale rejects non-positive values', {
            field: 'value',
            index: i,
            seriesId: series.id
          });
        }
      }
    }
  }

  applyBatch(batch) {
    return this._applyBatch(batch, false);
  }

  _applyBatch(batch, directTimeline) {
    this._assertAlive('chart.applyBatch');
    assertPlainObject(batch, 'chart.applyBatch', 'batch');
    assertKnownKeys(batch, new Set(['timeline', 'series']), 'chart.applyBatch', 'batch');
    if (batch.timeline === undefined && batch.series === undefined) {
      fail('INVALID_BATCH', 'chart.applyBatch', 'batch must contain timeline and/or series changes');
    }

    let timelineOp = null;
    let slots = null;
    if (batch.timeline !== undefined) {
      assertPlainObject(batch.timeline, 'chart.applyBatch', 'timeline');
      assertKnownKeys(batch.timeline, new Set(['op', 'type', 'slots']), 'chart.applyBatch', 'timeline');
      timelineOp = batch.timeline.op ?? batch.timeline.type;
      if (timelineOp !== 'append' && timelineOp !== 'prepend') {
        fail('INVALID_BATCH', 'chart.applyBatch', 'timeline.op must be "append" or "prepend"', {
          field: 'timeline.op'
        });
      }
      slots = normalizeSlots(batch.timeline.slots, 'chart.applyBatch');
      for (const slot of slots) {
        if (this._timeline.indexOf(slot.barId) !== null) {
          fail('DUPLICATE_BAR_ID', 'chart.applyBatch', 'slot already exists in the timeline', {
            field: 'barId'
          });
        }
      }
    }

    const candidate = new Map();
    if (timelineOp === 'prepend') {
      slots.forEach((slot, index) => candidate.set(slot.barId, index));
      for (let i = 0; i < this._timeline.length; i += 1) {
        candidate.set(this._timeline.slotAt(i).barId, i + slots.length);
      }
    } else if (timelineOp === 'append') {
      for (let i = 0; i < this._timeline.length; i += 1) {
        candidate.set(this._timeline.slotAt(i).barId, i);
      }
      slots.forEach((slot, index) => candidate.set(slot.barId, this._timeline.length + index));
    } else {
      for (let i = 0; i < this._timeline.length; i += 1) {
        candidate.set(this._timeline.slotAt(i).barId, i);
      }
    }
    const resolveIndex = (barId) => {
      const index = candidate.get(barId);
      return index === undefined ? null : index;
    };

    const prepared = [];
    if (batch.series !== undefined) {
      assertArray(batch.series, 'chart.applyBatch', 'series');
      for (let i = 0; i < batch.series.length; i += 1) {
        const entry = batch.series[i];
        assertPlainObject(entry, 'chart.applyBatch', `series[${i}]`);
        assertKnownKeys(
          entry,
          new Set(['series', 'seriesId', 'points', 'data', 'operation', 'metadata']),
          'chart.applyBatch',
          `series[${i}]`
        );
        const ref = entry.series ?? entry.seriesId;
        if (ref === undefined) {
          fail('INVALID_BATCH', 'chart.applyBatch', 'series entry requires "series" or "seriesId"', {
            field: `series[${i}].seriesId`
          });
        }
        const series = this._resolveSeries(ref, 'chart.applyBatch');
        const data = entry.points ?? entry.data;
        if (data === undefined) {
          fail('INVALID_BATCH', 'chart.applyBatch', 'series entry requires "points"', {
            field: `series[${i}].points`
          });
        }
        const operation =
          entry.operation ??
          (timelineOp === 'prepend' ? 'prepend' : timelineOp === 'append' ? 'append' : 'update');
        if (!['append', 'prepend', 'update', 'correct', 'setData'].includes(operation)) {
          fail('INVALID_BATCH', 'chart.applyBatch', 'unsupported series operation', {
            field: `series[${i}].operation`
          });
        }
        const result = series._prepare(operation, data, entry.metadata, resolveIndex);
        this._validateLogValues(series, result.points);
        prepared.push({ series, result });
      }
    }

    const preparedSet = new Set(prepared.map((item) => item.series.id));
    const contributions = this._collectPrecommit(
      {
        kind: 'batch',
        timelineOp,
        slots,
        series: prepared.map((item) => ({ series: item.series, prepared: item.result }))
      },
      resolveIndex,
      preparedSet
    );
    prepared.push(...contributions.map((item) => ({ series: item.series, result: item.prepared })));
    if (timelineOp === 'prepend') this._timeline._prependRaw(slots);
    else if (timelineOp === 'append') this._timeline._appendRaw(slots);
    for (const item of prepared) item.series._applyPrepared(item.result);

    if (timelineOp === 'prepend') this._indexScale.handlePrepend(slots.length);
    else if (timelineOp === 'append') this._indexScale.handleAppend(slots.length);
    if (timelineOp !== null) this._clearStaleCountdown();

    for (const [view, elements] of contributions.derivedCandidates) view._applyComputed(elements);
    this._refreshPriceScales();

    const payload = {
      chartId: this._id,
      kind: directTimeline ? (timelineOp === 'append' ? 'timelineAppend' : 'timelinePrepend') : 'batch',
      timelineKind: timelineOp,
      barIds: slots ? slots.map((slot) => slot.barId) : [],
      seriesIds: prepared.map((item) => item.series.id),
      range: this._indexScale.getVisibleRange()
    };
    this._notifyModules('onDataChange', payload);
    if (directTimeline) this._notifyModules('onTimelineChange', { kind: timelineOp, count: slots.length, precommitted: true });
    this._emit('datachange', payload);
    this._requestRender();
    return this;
  }

  resetData() {
    this._assertAlive('chart.resetData');
    this._timeline._clearRaw();
    this._clearStaleCountdown();
    for (const series of this._seriesById.values()) series._clear();
    for (const view of this._derivedViews.values()) view.recompute();
    for (const pane of this._panes) {
      for (const scale of pane.priceScales.values()) scale.clearAutoRange();
    }
    if (this._crosshair) {
      this._crosshair = null;
      this._emit('crosshairMove', { chartId: this._id, barId: null });
    }
    this._notifyModules('onReset');
    this._emit('datachange', { chartId: this._id, kind: 'reset', range: null });
    this._requestRender();
  }

  /**
   * Atomically replaces the entire data state: the timeline and the points of
   * every series. Series objects, panes, drawings and options are preserved.
   * Omitted series are cleared. Nothing changes if any part fails validation.
   *
   * @param {{slots: object[], series?: Array<{series?: object, seriesId?: string, points?: object[], data?: object[]}>}} next
   */
  replaceData(next) {
    this._assertAlive('chart.replaceData');
    assertPlainObject(next, 'chart.replaceData', 'data');
    assertKnownKeys(next, new Set(['slots', 'series']), 'chart.replaceData', 'data');
    if (next.slots === undefined) {
      fail('INVALID_ARGUMENT', 'chart.replaceData', '"slots" is required', { field: 'slots' });
    }
    const normalized = normalizeSlots(next.slots, 'chart.replaceData');
    const candidate = new Map();
    normalized.forEach((slot, index) => candidate.set(slot.barId, index));
    const resolveIndex = (barId) => {
      const index = candidate.get(barId);
      return index === undefined ? null : index;
    };

    const prepared = new Map();
    if (next.series !== undefined) {
      assertArray(next.series, 'chart.replaceData', 'series');
      for (let i = 0; i < next.series.length; i += 1) {
        const entry = next.series[i];
        assertPlainObject(entry, 'chart.replaceData', `series[${i}]`);
        assertKnownKeys(
          entry,
          new Set(['series', 'seriesId', 'points', 'data']),
          'chart.replaceData',
          `series[${i}]`
        );
        const ref = entry.series ?? entry.seriesId;
        if (ref === undefined) {
          fail('INVALID_ARGUMENT', 'chart.replaceData', 'series entry requires an id', {
            field: `series[${i}].seriesId`
          });
        }
        const series = this._resolveSeries(ref, 'chart.replaceData');
        if (prepared.has(series.id)) {
          fail('INVALID_BATCH', 'chart.replaceData', 'series appears more than once', {
            field: `series[${i}].seriesId`
          });
        }
        const points = entry.points ?? entry.data;
        if (points === undefined) {
          fail('INVALID_ARGUMENT', 'chart.replaceData', 'series entry requires "points"', {
            field: `series[${i}].points`
          });
        }
        const result = series._prepare('setData', points, undefined, resolveIndex);
        this._validateLogValues(series, result.points);
        prepared.set(series.id, result);
      }
    }

    const preparedSet = new Set(prepared.keys());
    const contributions = this._collectPrecommit(
      {
        kind: 'replace',
        slots: normalized,
        series: [...prepared.entries()].map(([seriesId, result]) => ({
          series: this._seriesById.get(seriesId),
          prepared: result
        }))
      },
      resolveIndex,
      preparedSet
    );
    for (const item of contributions) prepared.set(item.series.id, item.prepared);

    let anchor = null;
    const visible = this._indexScale.getVisibleRange();
    if (visible && this._timeline.length > 0) {
      const index = Math.min(this._timeline.length - 1, Math.max(0, Math.ceil(visible.from)));
      const slot = this._timeline.slotAt(index);
      if (slot) anchor = { barId: slot.barId, offset: visible.from - index };
    }

    this._timeline._replaceRaw(normalized);
    for (const series of this._seriesById.values()) {
      const result = prepared.get(series.id);
      if (result) series._applyPrepared(result);
      else series._clear();
    }
    if (anchor) {
      const index = this._timeline.indexOf(anchor.barId);
      if (index !== null) this._indexScale._rebaseFrom(index + anchor.offset);
    }
    this._indexScale.handleReplace();

    if (this._crosshair && this._timeline.indexOf(this._crosshair.barId) === null) {
      this._crosshair = null;
      this._emit('crosshairMove', { chartId: this._id, barId: null });
    }
    this._afterTimelineStructure(contributions.derivedCandidates);
    const payload = {
      chartId: this._id,
      kind: 'replace',
      barIds: normalized.map((slot) => slot.barId),
      seriesIds: [...this._seriesById.keys()],
      range: this._indexScale.getVisibleRange()
    };
    this._notifyModules('onDataChange', payload);
    this._emit('datachange', payload);
    this._requestRender();
    return this;
  }

  // -------------------------------------------------------------------------
  // Derived views
  // -------------------------------------------------------------------------

  addDerivedView(type, sourceRef, options = {}) {
    this._assertAlive('chart.addDerivedView');
    assertPlainObject(options, 'chart.addDerivedView', 'options');
    assertKnownKeys(
      options,
      new Set(['parameters', 'id', 'visible']),
      'chart.addDerivedView',
      'options'
    );
    const source = this._resolveSeries(sourceRef, 'chart.addDerivedView');
    let id = options.id;
    if (id === undefined) {
      do {
        id = `derived-${++this._derivedCounter}`;
      } while (this._derivedViews.has(id));
    } else {
      assertString(id, 'chart.addDerivedView', 'options.id', { nonEmpty: true });
      if (this._derivedViews.has(id)) {
        fail('INVALID_ARGUMENT', 'chart.addDerivedView', 'derived view id already exists', {
          field: 'id'
        });
      }
    }
    const view = new DerivedView({
      id,
      type,
      source,
      parameters: options.parameters,
      owner: this
    });
    if (options.visible !== undefined) {
      view.setVisible(assertBoolean(options.visible, 'chart.addDerivedView', 'options.visible'));
    }
    view.indexScale().setWidth(this._layout?.plotWidth ?? 0);
    this._derivedViews.set(id, view);
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'derivedAdd', derivedId: id });
    this._requestRender();
    return view;
  }

  _removeDerivedView(view) {
    if (!this._derivedViews.has(view.id)) return;
    this._derivedViews.delete(view.id);
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'derivedRemove', derivedId: view.id });
    this._requestRender();
  }

  removeDerivedView(viewRef) {
    this._assertAlive('chart.removeDerivedView');
    const view =
      typeof viewRef === 'string'
        ? this._derivedViews.get(viewRef)
        : viewRef && this._derivedViews.get(viewRef.id);
    if (!view) {
      fail('UNKNOWN_SERIES', 'chart.removeDerivedView', 'unknown derived view', {
        field: 'derivedId'
      });
    }
    this._removeDerivedView(view);
  }

  derivedViews() {
    this._assertAlive('chart.derivedViews');
    return [...this._derivedViews.values()];
  }

  _onDerivedScaleChange(view) {
    if (this._destroyed || this._suppressCameraEvents) return;
    this._refreshPriceScales(view._source.pane);
    this._requestRender();
    this._emit('visibleRangeChange', {
      chartId: this._id,
      derivedId: view.id,
      range: view.indexScale().getVisibleRange()
    });
  }

  _onDerivedVisibilityChange(view) {
    if (this._destroyed) return;
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'derivedVisibility', derivedId: view.id });
    this._requestRender();
  }

  _onDerivedParametersChange(view) {
    if (this._destroyed) return;
    this._refreshPriceScales();
    this._emit('datachange', { chartId: this._id, kind: 'derivedParameters', derivedId: view.id });
    this._requestRender();
  }

  // -------------------------------------------------------------------------
  // Options, resize, crosshair, countdown
  // -------------------------------------------------------------------------

  applyOptions(patch) {
    this._assertAlive('chart.applyOptions');
    assertPlainObject(patch, 'chart.applyOptions', 'options');
    const patchCopy = { ...patch };
    let crosshairAction = null;
    if (patchCopy.crosshair === null) {
      crosshairAction = { clear: true };
      delete patchCopy.crosshair;
    } else if (patchCopy.crosshair !== undefined) {
      assertPlainObject(patchCopy.crosshair, 'chart.applyOptions', 'crosshair');
      const hasAnchor =
        'anchorBarId' in patchCopy.crosshair ||
        'offset' in patchCopy.crosshair ||
        'price' in patchCopy.crosshair;
      if (hasAnchor) {
        const anchor = patchCopy.crosshair;
        const anchorBarId = assertString(
          anchor.anchorBarId,
          'chart.applyOptions',
          'crosshair.anchorBarId',
          { nonEmpty: true }
        );
        const offset = assertFiniteNumber(anchor.offset, 'chart.applyOptions', 'crosshair.offset');
        let price = null;
        if (anchor.price !== undefined && anchor.price !== null) {
          price = assertFiniteNumber(anchor.price, 'chart.applyOptions', 'crosshair.price');
        }
        crosshairAction = { anchor: { anchorBarId, offset, price } };
        const style = { ...patchCopy.crosshair };
        delete style.anchorBarId;
        delete style.offset;
        delete style.price;
        patchCopy.crosshair = style;
      }
    }
    const previous = this._options;
    const next = mergeChartOptions(previous, patchCopy);
    this._options = next;
    this._theme = resolveTheme(next.theme);
    this._suppressCameraEvents = true;
    try {
      if (next.timeScale.barSpacing !== previous.timeScale.barSpacing) {
        this._indexScale.setBarSpacing(next.timeScale.barSpacing);
      }
      if (next.timeScale.rightOffset !== previous.timeScale.rightOffset) {
        this._indexScale.setRightOffset(next.timeScale.rightOffset);
      }
    } finally {
      this._suppressCameraEvents = false;
    }
    if (next.countdown.visible !== previous.countdown.visible) {
      if (next.countdown.visible) this._startCountdown();
      else this._stopCountdown();
    }
    this._host.setAutoSize?.(next.autoSize);
    this._applyLayout();
    this._refreshPriceScales();
    if (crosshairAction?.clear) this.setCrosshair(null);
    else if (crosshairAction?.anchor) this.setCrosshairAnchor(crosshairAction.anchor);
    this._emit('visibleRangeChange', {
      chartId: this._id,
      range: this._indexScale.getVisibleRange(),
      priceScales: this._priceScaleDescriptors()
    });
    this._requestRender();
    return this;
  }

  resize(width, height) {
    this._assertAlive('chart.resize');
    assertFiniteNumber(width, 'chart.resize', 'width');
    assertFiniteNumber(height, 'chart.resize', 'height');
    assertNonNegativeNumber(width, 'chart.resize', 'width');
    assertNonNegativeNumber(height, 'chart.resize', 'height');
    let size = { width, height, dpr: this._host.dpr ?? this._dpr };
    if (typeof this._host.setSize === 'function') {
      const result = this._host.setSize(width, height);
      if (result && typeof result === 'object') size = { ...size, ...result };
    }
    this._width = Number.isFinite(size.width) ? size.width : width;
    this._height = Number.isFinite(size.height) ? size.height : height;
    this._dpr = Number.isFinite(size.dpr) && size.dpr > 0 ? size.dpr : this._dpr;
    this._applyLayout();
    const payload = {
      chartId: this._id,
      width: this._width,
      height: this._height,
      devicePixelRatio: this._dpr
    };
    this._notifyModules('onResize', payload);
    this._emit('resize', payload);
    this._requestRender();
    return this;
  }

  _crosshairTarget(pane, requestedId, operation, field, message) {
    const context = this._paneXContext(pane);
    let id = requestedId;
    if (context.kind === 'derived' && context.scale.barIdToIndex(id) === null) {
      id = context.view.elementAtOrBefore(id);
    }
    const index = id === null ? null : context.scale.barIdToIndex(id);
    if (index === null) fail('UNKNOWN_BAR_ID', operation, message, { field });
    return { id, index };
  }

  setCrosshair(barId, price = null, paneRef = null) {
    this._assertAlive('chart.setCrosshair');
    if (barId === null) {
      this._crosshair = null;
      this._emit('crosshairMove', { chartId: this._id, barId: null });
      this._requestRender();
      return;
    }
    const requestedId = assertString(barId, 'chart.setCrosshair', 'barId', { nonEmpty: true });
    let normalizedPrice = null;
    if (price !== null && price !== undefined) {
      normalizedPrice = assertFiniteNumber(price, 'chart.setCrosshair', 'price');
    }
    const pane = this._resolvePane(paneRef, 'chart.setCrosshair');
    const { id, index } = this._crosshairTarget(
      pane, requestedId, 'chart.setCrosshair', 'barId', 'crosshair bar is not on the pane axis'
    );
    this._crosshair = { barId: id, logical: index, offset: 0, price: normalizedPrice, pane };
    const payload = this._crosshairPayload();
    this._notifyModules('onCrosshairMove', payload);
    this._emit('crosshairMove', payload);
    this._requestRender();
  }

  /**
   * Sets a crosshair by exact fractional anchor. The offset is never rounded;
   * it may place the crosshair between bars or outside history.
   */
  setCrosshairAnchor(anchor, paneRef = null) {
    this._assertAlive('chart.setCrosshairAnchor');
    if (anchor === null) {
      this._crosshair = null;
      this._emit('crosshairMove', { chartId: this._id, barId: null });
      this._requestRender();
      return;
    }
    assertPlainObject(anchor, 'chart.setCrosshairAnchor', 'anchor');
    assertKnownKeys(
      anchor,
      new Set(['anchorBarId', 'offset', 'price']),
      'chart.setCrosshairAnchor',
      'anchor'
    );
    const requestedId = assertString(anchor.anchorBarId, 'chart.setCrosshairAnchor', 'anchor.anchorBarId', {
      nonEmpty: true
    });
    const offset = assertFiniteNumber(anchor.offset, 'chart.setCrosshairAnchor', 'anchor.offset');
    let price = null;
    if (anchor.price !== undefined && anchor.price !== null) {
      price = assertFiniteNumber(anchor.price, 'chart.setCrosshairAnchor', 'anchor.price');
    }
    const pane = this._resolvePane(paneRef, 'chart.setCrosshairAnchor');
    const { id: barId, index } = this._crosshairTarget(
      pane, requestedId, 'chart.setCrosshairAnchor', 'anchorBarId', 'anchor bar is not on the pane axis'
    );
    this._crosshair = { barId, logical: index + offset, offset, price, pane };
    const payload = this._crosshairPayload();
    this._notifyModules('onCrosshairMove', payload);
    this._emit('crosshairMove', payload);
    this._requestRender();
  }

  /** Public ids of the stored crosshair: source barId plus the element id on a derived pane. */
  _crosshairIds() {
    const crosshair = this._crosshair;
    const context = this._paneXContext(crosshair.pane);
    const derived = context.kind === 'derived' ? context.view : null;
    return {
      context,
      derived,
      barId: derived ? derived.elementToBarId(crosshair.barId) : crosshair.barId
    };
  }

  _crosshairPayload() {
    if (!this._crosshair) return { chartId: this._id, barId: null };
    const { context, derived, barId } = this._crosshairIds();
    const index = context.scale.barIdToIndex(this._crosshair.barId);
    const slot = index === null || derived ? null : this._timeline.slotAt(index);
    const offset = this._crosshair.offset ?? 0;
    const logical = this._crosshair.logical ?? (index === null ? null : index);
    const last = context.scale.length - 1;
    const payload = {
      chartId: this._id,
      barId,
      ...(derived ? { derivedElementId: this._crosshair.barId } : {}),
      index,
      offset,
      logical,
      insideHistory: logical !== null && logical >= 0 && logical <= last,
      price: this._crosshair.price,
      paneId: this._crosshair.pane?.id ?? null,
      series: index !== null && offset === 0 && barId !== null ? this.getSeriesValues(barId) : []
    };
    if (offset === 0 && slot?.time !== undefined) payload.time = slot.time;
    if (offset === 0 && slot?.sessionDate !== undefined) {
      payload.sessionDate = { ...slot.sessionDate };
    }
    return payload;
  }

  getCrosshair() {
    this._assertAlive('chart.getCrosshair');
    if (!this._crosshair) return null;
    const { derived, barId } = this._crosshairIds();
    return {
      barId,
      ...(derived ? { derivedElementId: this._crosshair.barId } : {}),
      offset: this._crosshair.offset ?? 0,
      logical: this._crosshair.logical ?? null,
      price: this._crosshair.price,
      paneId: this._crosshair.pane?.id ?? null
    };
  }

  setBarCloseTime(barId, closeTime) {
    this._assertAlive('chart.setBarCloseTime');
    if (barId === null) {
      this._countdown = null;
      this._stopCountdown();
      this._requestRender();
      return;
    }
    const id = assertString(barId, 'chart.setBarCloseTime', 'barId', { nonEmpty: true });
    const index = this._timeline.indexOf(id);
    if (index === null) {
      fail('UNKNOWN_BAR_ID', 'chart.setBarCloseTime', 'bar is not in the timeline', {
        field: 'barId'
      });
    }
    if (index !== this._timeline.length - 1) {
      fail('INVALID_ARGUMENT', 'chart.setBarCloseTime', 'bar must be the current timeline bar', {
        field: 'barId'
      });
    }
    if (closeTime === null) {
      this._countdown = null;
      this._stopCountdown();
      this._requestRender();
      return;
    }
    const time = validateTime(closeTime, 'chart.setBarCloseTime', 'closeTime');
    this._countdown = { barId: id, closeTime: time };
    this._startCountdown();
    this._requestRender();
  }

  _startCountdown() {
    if (!this._options.countdown.visible || !this._countdown) return;
    if (this._countdownTimer !== null) return;
    this._countdownTimer = setInterval(() => {
      if (this._destroyed) return;
      this._requestRender();
    }, 1000);
    this._countdownTimer.unref?.();
  }

  _stopCountdown() {
    if (this._countdownTimer !== null) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Integration surface
  // -------------------------------------------------------------------------

  _createSurface() {
    const chart = this;
    const surface = {
      get container() {
        chart._assertAlive('surface.container');
        return chart.container;
      },
      get canvas() {
        chart._assertAlive('surface.canvas');
        return chart.canvas;
      },
      get overlay() {
        chart._assertAlive('surface.overlay');
        return chart._host.overlay ?? null;
      },
      get status() {
        chart._assertAlive('surface.status');
        return chart._host.status ?? null;
      },
      get alert() {
        chart._assertAlive('surface.alert');
        return chart._host.alert ?? null;
      },
      get table() {
        chart._assertAlive('surface.table');
        return chart._host.table ?? null;
      },
      get layout() {
        return chart.getInteractionLayout();
      },
      get panes() {
        return chart.getPanes();
      },
      get locale() {
        chart._assertAlive('surface.locale');
        return chart._options.locale;
      },
      get timeZone() {
        chart._assertAlive('surface.timeZone');
        return chart._options.timeZone;
      },
      requestRender: () => chart.requestRender(),
      subscribe: (event, handler) => chart.subscribe(event, handler),
      emit: (event, payload) => chart._emit(event, payload),
      resolveAnchor: (anchor, options) => chart._resolveAnchor(anchor, options?.paneId),
      anchorToX: (anchor, options) => {
        const logical = chart._resolveAnchor(anchor, options?.paneId);
        return logical === null ? null : chart._surfaceScale(options?.paneId).logicalToCoordinate(logical);
      },
      xToAnchor: (x, options) => chart._xToAnchor(x, options?.paneId),
      logicalToX: (logical, options) => chart._surfaceScale(options?.paneId).logicalToCoordinate(logical),
      xToLogical: (x, options) => chart._surfaceScale(options?.paneId).coordinateToLogical(x),
      priceToY: (price, binding = {}) => chart._priceToY(price, binding),
      yToPrice: (y, binding = {}) => chart._yToPrice(y, binding),
      getVisibleRect: (binding = {}) => chart._getVisibleRect(binding),
      getStateSnapshot: () => chart.getState(),
      getSeriesValues: (barId) => chart.getSeriesValues(barId),
      onPointer: (id, type, handler, options) =>
        chart._addHostListener('pointer', id, type, handler, options),
      onKeyboard: (id, type, handler, options) =>
        chart._addHostListener('keyboard', id, type, handler, options),
      addOverlay: (element) => {
        const release = chart._host.addOverlay?.(element);
        return release && (() => { chart._assertAlive('surface.removeOverlay'); return release(); });
      },
      addControl: (control) => {
        const release = chart._host.addControl?.(control);
        return release && (() => { chart._assertAlive('surface.removeControl'); return release(); });
      },
      removeControl: (id) => chart._host.removeControl?.(id)
    };
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(surface))) {
      if (typeof descriptor.value !== 'function') continue;
      const method = descriptor.value;
      surface[name] = (...args) => {
        chart._assertAlive(`surface.${name}`);
        return method(...args);
      };
    }
    return surface;
  }

  _surfaceScale(paneId) {
    return paneId === undefined || paneId === null ? this._indexScale : this._paneIndexScale(paneId);
  }

  _resolveAnchor(anchor, paneId) {
    assertPlainObject(anchor, 'surface.resolveAnchor', 'anchor');
    const barId = assertString(anchor.anchorBarId, 'surface.resolveAnchor', 'anchor.anchorBarId', {
      nonEmpty: true
    });
    const offset = assertFiniteNumber(anchor.offset, 'surface.resolveAnchor', 'anchor.offset');
    const context = paneId === undefined || paneId === null ? null : this._paneXContext(paneId);
    const index = context?.kind === 'derived'
      ? context.scale.barIdToIndex(barId)
      : this._timeline.indexOf(barId);
    return index === null ? null : index + offset;
  }

  _xToAnchor(x, paneId) {
    const context = paneId === undefined || paneId === null ? null : this._paneXContext(paneId);
    const derivedScale = context?.kind === 'derived' ? context.scale : null;
    const scale = derivedScale ?? this._indexScale;
    const length = derivedScale ? derivedScale.length : this._timeline.length;
    const barIdAt = (index) => (derivedScale ? derivedScale.indexToBarId(index) : this._timeline.slotAt(index).barId);
    const logical = scale.coordinateToLogical(x);
    if (logical === null || length === 0) return null;
    const last = length - 1;
    if (logical < 0) {
      return { anchorBarId: barIdAt(0), offset: logical };
    }
    if (logical > last) {
      return { anchorBarId: barIdAt(last), offset: logical - last };
    }
    const index = Math.floor(logical);
    return {
      anchorBarId: barIdAt(index),
      offset: logical - index
    };
  }

  _priceBinding(binding = {}) {
    const pane = this._resolvePane(binding.paneId ?? null, 'surface.priceBinding');
    const scaleId = binding.scaleId ?? 'right';
    const scale = this._ensurePriceScale(pane, scaleId);
    const rect = this._paneRect(pane.id);
    return { pane, scale, rect };
  }

  _priceToY(price, binding = {}) {
    const { scale, rect } = this._priceBinding(binding);
    const y = scale.priceToCoordinate(price);
    return y === null || !rect ? null : rect.y + y;
  }

  _yToPrice(y, binding = {}) {
    const { scale, rect } = this._priceBinding(binding);
    if (!rect) return null;
    return scale.coordinateToPrice(y - rect.y);
  }

  _getVisibleRect(binding = {}) {
    const pane = this._resolvePane(binding.paneId ?? null, 'surface.getVisibleRect');
    const rect = this._paneRect(pane.id);
    return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
  }

  _addHostListener(kind, id, type, handler, options) {
    this._assertAlive('surface.onPointer');
    const listenerId = assertString(id, 'surface.onPointer', 'id', { nonEmpty: true });
    const eventType = assertString(type, 'surface.onPointer', 'type', { nonEmpty: true });
    if (typeof handler !== 'function') {
      fail('INVALID_TYPE', 'surface.onPointer', '"handler" must be a function', {
        field: 'handler'
      });
    }
    if (typeof this._host.addListener !== 'function') {
      fail('INVALID_ARGUMENT', 'surface.onPointer', 'host does not support event listeners');
    }
    const target = kind === 'pointer' ? this._host.canvas ?? this._host.element : this._host.element;
    return this._host.addListener(listenerId, target, eventType, handler, options);
  }

  // -------------------------------------------------------------------------
  // Layout and readout
  // -------------------------------------------------------------------------

  getPanes() {
    this._assertAlive('chart.getPanes');
    const layout = this._layout ?? this._computeLayout();
    return this._panes.map((pane) => {
      const rect = layout.panes.find((candidate) => candidate.pane === pane);
      const height = pane.height ?? (rect && rect.height > 0 ? rect.height + (rect.axisStrip?.height ?? 0) : undefined);
      const descriptor = {
        id: pane.id,
        order: pane.order,
        minHeight: pane.minHeight,
        visible: pane.visible,
        seriesIds: [...pane.series].map((series) => series.id)
      };
      if (height !== undefined && height !== null) descriptor.height = height;
      return descriptor;
    });
  }

  _preparePaneLayout(panes, operation = 'chart.applyPaneLayout') {
    const op = operation;
    this._assertAlive(op);
    assertArray(panes, op, 'panes');
    if (panes.length === 0) {
      fail('INVALID_ARGUMENT', op, 'pane layout cannot be empty', {
        field: 'panes'
      });
    }
    const seen = new Set();
    const normalized = panes.map((entry, index) => {
      assertPlainObject(entry, op, `panes[${index}]`);
      assertKnownKeys(
        entry,
        new Set(['id', 'order', 'height', 'minHeight', 'visible', 'seriesIds']),
        op,
        `panes[${index}]`
      );
      const id = assertString(entry.id, op, `panes[${index}].id`, {
        nonEmpty: true
      });
      if (seen.has(id)) {
        fail('INVALID_ARGUMENT', op, 'duplicate pane id', { field: 'id' });
      }
      seen.add(id);
      const pane = this._panes.find((candidate) => candidate.id === id);
      if (!pane) {
        fail('UNKNOWN_PANE', op, 'unknown pane id', { field: 'id' });
      }
      const order =
        entry.order === undefined
          ? pane.order
          : assertFiniteNumber(entry.order, op, `panes[${index}].order`);
      const height =
        entry.height === undefined || entry.height === null
          ? pane.height
          : assertPositiveNumber(entry.height, op, `panes[${index}].height`);
      const minHeight =
        entry.minHeight === undefined
          ? pane.minHeight
          : assertPositiveNumber(
              entry.minHeight,
              op,
              `panes[${index}].minHeight`
            );
      const visible =
        entry.visible === undefined
          ? pane.visible
          : assertBoolean(entry.visible, op, `panes[${index}].visible`);
      return { pane, order, height, minHeight, visible };
    });
    if (this._panes.some((pane) => !seen.has(pane.id))) {
      fail('INVALID_ARGUMENT', op, 'layout must describe every pane', {
        field: 'panes'
      });
    }
    if (!normalized.some((entry) => entry.visible)) {
      fail('INVALID_ARGUMENT', op, 'at least one pane must remain visible', {
        field: 'visible'
      });
    }
    return normalized;
  }

  applyPaneLayout(panes) {
    this._assertAlive('chart.applyPaneLayout');
    const normalized = this._preparePaneLayout(panes, 'chart.applyPaneLayout');
    for (const entry of normalized) {
      entry.pane.order = entry.order;
      entry.pane.height = entry.height;
      entry.pane.minHeight = entry.minHeight;
      entry.pane.visible = entry.visible;
    }
    this._applyLayout();
    this._emit('datachange', { chartId: this._id, kind: 'paneLayout' });
    this._requestRender();
  }

  getInteractionLayout() {
    this._assertAlive('chart.getInteractionLayout');
    const layout = this._layout ?? this._computeLayout();
    const panes = layout.panes.map((rect) => {
      const columns = [
        ...axisColumns(rect.pane, 'left', layout, layout.width),
        ...axisColumns(rect.pane, 'right', layout, layout.width)
      ];
      return {
        id: rect.pane.id,
        order: rect.pane.order,
        visible: rect.pane.visible !== false,
        height: rect.height,
        minHeight: rect.pane.minHeight,
        plot: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        priceScales: columns.map((column) => ({
          id: column.scale.name,
          side: column.scale.side,
          rect: { x: column.x, y: rect.y, width: column.width, height: rect.height },
          inverted: column.scale.inverted
        })),
        indexAxis: rect.axisStrip
          ? { x: rect.axisStrip.x, y: rect.axisStrip.y, width: rect.axisStrip.width, height: rect.axisStrip.height }
          : null
      };
    });
    return {
      width: this._width,
      height: this._height,
      devicePixelRatio: this._dpr,
      rect: { x: 0, y: 0, width: this._width, height: this._height },
      panes
    };
  }

  getSeriesValues(barId) {
    this._assertAlive('chart.getSeriesValues');
    if (typeof barId !== 'string') return [];
    const out = [];
    for (const pane of this._panes) {
      for (const series of pane.series) {
        const point = series.point(barId);
        out.push({
          seriesId: series.id,
          paneId: pane.id,
          type: series.type,
          values: point
        });
      }
    }
    return out;
  }

  getState() {
    this._assertAlive('chart.getState');
    const contexts = [];
    for (const series of this._seriesById.values()) {
      const metadata = series._metadata;
      if (!metadata) continue;
      const key = `${metadata.instrumentId}|${metadata.interval}|${metadata.sourceId}`;
      if (!contexts.some((entry) => entry.key === key)) {
        contexts.push({
          key,
          instrumentId: metadata.instrumentId,
          interval: metadata.interval,
          sourceId: metadata.sourceId
        });
      }
    }
    const state = {
      id: this._id,
      context: contexts.length === 1
        ? {
            instrumentId: contexts[0].instrumentId,
            interval: contexts[0].interval,
            sourceId: contexts[0].sourceId
          }
        : null,
      contexts: contexts.map(({ key, ...context }) => context),
      panes: this.getPanes(),
      series: [...this._seriesById.values()].map((series) => ({
        id: series.id,
        type: series.type,
        paneId: series.pane.id,
        priceScaleId: series.priceScaleId,
        visible: series._options.visible !== false,
        lastValueVisible: series._options.lastValueVisible !== false,
        title: series._options.title ?? null,
        metadata: series.metadata()
      })),
      derived: [...this._derivedViews.values()].map((view) => ({
        id: view.id,
        type: view.type,
        sourceId: view.sourceId,
        parameters: view.parameters(),
        visible: view.visible
      })),
      visibleRange: this._indexScale.getVisibleRange(),
      crosshair: this.getCrosshair(),
      priceScales: this._priceScaleDescriptors(),
      options: {
        ...this._options,
        layout: { ...this._options.layout },
        grid: { ...this._options.grid },
        sessions: { ...this._options.sessions, starts: [...this._options.sessions.starts] },
        watermark: { ...this._options.watermark },
        crosshair: { ...this._options.crosshair },
        timeScale: { ...this._options.timeScale },
        priceScale: { ...this._options.priceScale },
        countdown: { ...this._options.countdown }
      }
    };
    const modules = {};
    for (const module of this._modules.values()) {
      if (typeof module.hooks.onExportState !== 'function') continue;
      modules[module.name] = module.hooks.onExportState(state);
    }
    state.modules = modules;
    return state;
  }

  /**
   * Restores core presentation state atomically. All core fields are validated
   * before any mutation; attached modules validate through onValidateRestore
   * and apply their own state through onRestoreState.
   *
   * Supported keys: options, panes, visibleRange, series, derived, modules,
   * context. Data (timeline/points) is restored through replaceData instead.
   */
  restoreState(snapshot) {
    this._assertAlive('chart.restoreState');
    if (this._restoreEvents && !this._restoring) {
      fail('RESTORE_IN_PROGRESS', 'chart.restoreState', 'a chart restore is already in progress');
    }
    assertPlainObject(snapshot, 'chart.restoreState', 'snapshot');
    assertKnownKeys(
      snapshot,
      new Set([
        'id',
        'context',
        'contexts',
        'options',
        'panes',
        'visibleRange',
        'crosshair',
        'series',
        'derived',
        'priceScales',
        'modules'
      ]),
      'chart.restoreState',
      'snapshot'
    );

    // snapshot.id is informational: a workspace may restore into a newly
    // staged chart with a different core instance id.
    if (snapshot.contexts !== undefined) {
      assertArray(snapshot.contexts, 'chart.restoreState', 'contexts');
    }
    const nextOptions =
      snapshot.options === undefined
        ? this._options
        : mergeChartOptions(this._options, snapshot.options);
    const nextPanes =
      snapshot.panes === undefined
        ? null
        : this._preparePaneLayout(snapshot.panes, 'chart.restoreState');

    let nextRange = null;
    if (snapshot.visibleRange !== undefined && snapshot.visibleRange !== null) {
      assertPlainObject(snapshot.visibleRange, 'chart.restoreState', 'visibleRange');
      const { from, to } = snapshot.visibleRange;
      assertFiniteNumber(from, 'chart.restoreState', 'visibleRange.from');
      assertFiniteNumber(to, 'chart.restoreState', 'visibleRange.to');
      if (!(from < to)) {
        fail('INVALID_RANGE', 'chart.restoreState', 'visibleRange requires "from" < "to"', {
          field: 'visibleRange'
        });
      }
      if ((this._layout?.plotWidth ?? 0) <= 0) {
        fail('INVALID_RANGE', 'chart.restoreState', 'cannot restore a range with zero width', {
          field: 'visibleRange'
        });
      }
      nextRange = { from, to };
    }

    const seriesUpdates = [];
    if (snapshot.series !== undefined) {
      assertArray(snapshot.series, 'chart.restoreState', 'series');
      const seen = new Set();
      for (let i = 0; i < snapshot.series.length; i += 1) {
        const entry = snapshot.series[i];
        assertPlainObject(entry, 'chart.restoreState', `series[${i}]`);
        assertKnownKeys(
          entry,
          new Set([
            'id',
            'seriesId',
            'type',
            'paneId',
            'priceScaleId',
            'metadata',
            'visible',
            'lastValueVisible',
            'title'
          ]),
          'chart.restoreState',
          `series[${i}]`
        );
        const series = this._resolveSeries(entry.id ?? entry.seriesId, 'chart.restoreState');
        if (entry.type !== undefined && entry.type !== series.type) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'series type does not match', {
            field: `series[${i}].type`
          });
        }
        if (entry.paneId !== undefined && entry.paneId !== series.pane.id) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'series pane does not match', {
            field: `series[${i}].paneId`
          });
        }
        if (entry.priceScaleId !== undefined && entry.priceScaleId !== series.priceScaleId) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'series price scale does not match', {
            field: `series[${i}].priceScaleId`
          });
        }
        if (entry.metadata !== undefined && entry.metadata !== null) {
          const metadata = normalizeMetadata(entry.metadata, 'chart.restoreState');
          const current = series._metadata;
          if (!current || !scalesCompatible(metadata, current)) {
            fail('INVALID_ARGUMENT', 'chart.restoreState', 'series metadata does not match', {
              field: `series[${i}].metadata`
            });
          }
        }
        if (seen.has(series.id)) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'series appears more than once', {
            field: `series[${i}].id`
          });
        }
        seen.add(series.id);
        const patch = {};
        if (entry.visible !== undefined) {
          patch.visible = assertBoolean(entry.visible, 'chart.restoreState', `series[${i}].visible`);
        }
        if (entry.lastValueVisible !== undefined) {
          const lastValueVisible = assertBoolean(
            entry.lastValueVisible,
            'chart.restoreState',
            `series[${i}].lastValueVisible`
          );
          // Snapshots record the effective value, but `series.options()` reports explicit
          // overrides only, so restoring the default must not turn it into one.
          if (lastValueVisible !== (series._options.lastValueVisible !== false)) patch.lastValueVisible = lastValueVisible;
        }
        if (entry.title !== undefined) {
          patch.title =
            entry.title === null
              ? null
              : assertString(entry.title, 'chart.restoreState', `series[${i}].title`);
        }
        seriesUpdates.push({ series, patch });
      }
    }

    const derivedUpdates = [];
    if (snapshot.derived !== undefined) {
      assertArray(snapshot.derived, 'chart.restoreState', 'derived');
      for (let i = 0; i < snapshot.derived.length; i += 1) {
        const entry = snapshot.derived[i];
        assertPlainObject(entry, 'chart.restoreState', `derived[${i}]`);
        assertKnownKeys(
          entry,
          new Set(['id', 'type', 'sourceId', 'parameters', 'visible']),
          'chart.restoreState',
          `derived[${i}]`
        );
        const view = this._derivedViews.get(entry.id);
        if (!view) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'unknown derived view', {
            field: `derived[${i}].id`
          });
        }
        if (entry.type !== undefined && entry.type !== view.type) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'derived type does not match', {
            field: `derived[${i}].type`
          });
        }
        if (entry.sourceId !== undefined && entry.sourceId !== view.sourceId) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'derived source does not match', {
            field: `derived[${i}].sourceId`
          });
        }
        if (entry.parameters !== undefined) {
          assertPlainObject(entry.parameters, 'chart.restoreState', `derived[${i}].parameters`);
        }
        derivedUpdates.push({
          view,
          visible:
            entry.visible === undefined
              ? view.visible
              : assertBoolean(entry.visible, 'chart.restoreState', `derived[${i}].visible`)
        });
      }
    }

    let nextCrosshair = undefined;
    if (snapshot.crosshair !== undefined) {
      if (snapshot.crosshair === null) {
        nextCrosshair = null;
      } else {
        assertPlainObject(snapshot.crosshair, 'chart.restoreState', 'crosshair');
        assertKnownKeys(
          snapshot.crosshair,
          new Set(['anchorBarId', 'barId', 'offset', 'logical', 'price', 'paneId']),
          'chart.restoreState',
          'crosshair'
        );
        const barId = assertString(
          snapshot.crosshair.anchorBarId ?? snapshot.crosshair.barId,
          'chart.restoreState',
          'crosshair.anchorBarId',
          { nonEmpty: true }
        );
        if (this._timeline.indexOf(barId) === null) {
          fail('UNKNOWN_BAR_ID', 'chart.restoreState', 'crosshair anchor is not in the timeline', {
            field: 'crosshair.anchorBarId'
          });
        }
        nextCrosshair = {
          anchorBarId: barId,
          offset: assertFiniteNumber(
            snapshot.crosshair.offset,
            'chart.restoreState',
            'crosshair.offset'
          ),
          price:
            snapshot.crosshair.price === undefined || snapshot.crosshair.price === null
              ? null
              : assertFiniteNumber(
                  snapshot.crosshair.price,
                  'chart.restoreState',
                  'crosshair.price'
                )
        };
      }
    }

    const scaleUpdates = [];
    if (snapshot.priceScales !== undefined) {
      assertArray(snapshot.priceScales, 'chart.restoreState', 'priceScales');
      for (let i = 0; i < snapshot.priceScales.length; i += 1) {
        const entry = snapshot.priceScales[i];
        assertPlainObject(entry, 'chart.restoreState', `priceScales[${i}]`);
        assertKnownKeys(
          entry,
          new Set([
            'paneId',
            'scaleId',
            'range',
            'autoScale',
            'mode',
            'base',
            'side',
            'inverted',
            'visible',
            'overlay',
            'margins'
          ]),
          'chart.restoreState',
          `priceScales[${i}]`
        );
        const pane = this._resolvePane(entry.paneId, 'chart.restoreState');
        const scaleId = assertString(
          entry.scaleId,
          'chart.restoreState',
          `priceScales[${i}].scaleId`,
          { nonEmpty: true }
        );
        const scale = pane.priceScales.get(scaleId);
        if (!scale) {
          fail('INVALID_ARGUMENT', 'chart.restoreState', 'unknown price scale', {
            field: `priceScales[${i}].scaleId`
          });
        }
        const update = { scale };
        if (entry.mode !== undefined) {
          if (!['linear', 'log', 'percent'].includes(entry.mode)) {
            fail('INVALID_MODE', 'chart.restoreState', 'unsupported price scale mode', {
              field: `priceScales[${i}].mode`
            });
          }
          update.mode = entry.mode;
        }
        if (entry.base !== undefined && entry.base !== null) {
          update.base = assertFiniteNumber(entry.base, 'chart.restoreState', `priceScales[${i}].base`);
          if (update.base === 0) {
            fail('INVALID_BASE', 'chart.restoreState', 'percent base must be non-zero', {
              field: `priceScales[${i}].base`
            });
          }
        }
        if (entry.range !== undefined && entry.range !== null) {
          assertPlainObject(entry.range, 'chart.restoreState', `priceScales[${i}].range`);
          const min = assertFiniteNumber(entry.range.min, 'chart.restoreState', `priceScales[${i}].range.min`);
          const max = assertFiniteNumber(entry.range.max, 'chart.restoreState', `priceScales[${i}].range.max`);
          if (!(min < max)) {
            fail('INVALID_RANGE', 'chart.restoreState', 'price range requires min < max', {
              field: `priceScales[${i}].range`
            });
          }
          if ((entry.mode ?? scale.mode) === 'log' && !(min > 0)) {
            fail('LOG_RANGE', 'chart.restoreState', 'log range requires positive bounds', {
              field: `priceScales[${i}].range`
            });
          }
          update.range = { min, max };
        }
        if (entry.autoScale !== undefined) {
          update.autoScale = assertBoolean(
            entry.autoScale,
            'chart.restoreState',
            `priceScales[${i}].autoScale`
          );
        }
        if (entry.side !== undefined) {
          if (entry.side !== 'left' && entry.side !== 'right') {
            fail('INVALID_ARGUMENT', 'chart.restoreState', 'scale side must be left or right', {
              field: `priceScales[${i}].side`
            });
          }
          update.side = entry.side;
        }
        if (entry.inverted !== undefined) {
          update.inverted = assertBoolean(
            entry.inverted,
            'chart.restoreState',
            `priceScales[${i}].inverted`
          );
        }
        if (entry.visible !== undefined) {
          update.visible = assertBoolean(
            entry.visible,
            'chart.restoreState',
            `priceScales[${i}].visible`
          );
        }
        if (entry.overlay !== undefined) {
          update.overlay = assertBoolean(
            entry.overlay,
            'chart.restoreState',
            `priceScales[${i}].overlay`
          );
        }
        if (entry.margins !== undefined) {
          update.margins = normalizeMargins(entry.margins, 'chart.restoreState', `priceScales[${i}].margins`);
        }
        scaleUpdates.push(update);
      }
    }

    if (!this._restoring) this._validateModules('onValidateRestore', snapshot);
    const previous = this.getState();
    const checkpoints = new Map();
    if (!this._restoring) {
      for (const module of this._modules.values()) {
        if (module.hooks.onCaptureRestore) checkpoints.set(module, module.hooks.onCaptureRestore(snapshot));
      }
    }
    const restoringModules = [];
    const ownsTransaction = !this._restoring;
    if (ownsTransaction) this._restoreEvents = [];
    try {
      this._options = nextOptions;
      this._theme = resolveTheme(nextOptions.theme);
      this._suppressCameraEvents = true;
      try {
        if (nextOptions.timeScale.barSpacing !== this._indexScale.barSpacing) {
          this._indexScale.setBarSpacing(nextOptions.timeScale.barSpacing);
        }
        if (nextOptions.timeScale.rightOffset !== this._indexScale.rightOffset) {
          this._indexScale.setRightOffset(nextOptions.timeScale.rightOffset);
        }
      } finally {
        this._suppressCameraEvents = false;
      }
      this._host.setAutoSize?.(nextOptions.autoSize);
      if (nextPanes) {
        for (const entry of nextPanes) {
          entry.pane.order = entry.order;
          entry.pane.height = entry.height;
          entry.pane.minHeight = entry.minHeight;
          entry.pane.visible = entry.visible;
        }
      }
      for (const update of seriesUpdates) {
        update.series._options = Object.freeze({ ...update.series._options, ...update.patch });
      }
      for (const update of derivedUpdates) update.view.visible = update.visible;
      this._applyLayout();
      for (const update of scaleUpdates) {
        if (update.mode !== undefined) {
          update.scale.setMode(
            update.mode,
            update.base === undefined ? {} : { base: update.base }
          );
        }
        if (update.side !== undefined) update.scale.setSide(update.side);
        if (update.inverted !== undefined) update.scale.setInverted(update.inverted);
        if (update.visible !== undefined) update.scale.setVisible(update.visible);
        if (update.overlay !== undefined) update.scale.setOverlay(update.overlay);
        if (update.margins !== undefined) update.scale.setMargins(update.margins);
        if (update.autoScale === true) update.scale.setAutoScale(true);
        else if (update.range !== undefined) update.scale.setVisibleRange(update.range);
        else if (update.autoScale === false) update.scale.setAutoScale(false);
      }
      if (nextRange) this._indexScale.setVisibleRange(nextRange);
      if (nextCrosshair === null) this.setCrosshair(null);
      else if (nextCrosshair !== undefined) this.setCrosshairAnchor(nextCrosshair);
      this._refreshPriceScales();
      if (ownsTransaction) {
        for (const module of this._modules.values()) {
          const fn = module.hooks.onRestoreState;
          if (typeof fn === 'function') {
            restoringModules.push(module);
            fn(snapshot);
          }
        }
      }
    } catch (error) {
      if (!ownsTransaction) throw error;
      const errors = [error];
      this._restoring = true;
      try {
        try { this.restoreState(previous); } catch (rollbackError) { errors.push(rollbackError); }
        for (let i = restoringModules.length - 1; i >= 0; i -= 1) {
          try {
            const module = restoringModules[i];
            if (checkpoints.has(module)) module.hooks.onRollbackRestore(checkpoints.get(module), previous);
            else module.hooks.onRestoreState(previous);
          } catch (rollbackError) { errors.push(rollbackError); }
        }
      } finally {
        this._restoring = false;
        this._restoreEvents = null;
      }
      if (errors.length > 1) throw new AggregateError(errors, 'restoreState failed and rollback failed');
      throw error;
    }
    if (ownsTransaction) {
      const events = this._restoreEvents;
      this._restoreEvents = null;
      for (const entry of events) {
        if (entry.kind === 'hook') this._notifyModules(entry.name, entry.payload);
        else if (entry.kind === 'callback') {
          try { entry.callback(); } catch (error) { this._reportError(error, 'restoreNotification'); }
        } else this._emit(entry.name, entry.payload);
      }
    }
    this._emit('datachange', { chartId: this._id, kind: 'restore' });
    this._requestRender();
    return this;
  }

  // -------------------------------------------------------------------------
  // Series facade (function + properties used by datafeed/workspaces)
  // -------------------------------------------------------------------------

  /**
   * Applies a style patch to one series. An explicit `undefined` restores the
   * renderer default for that key. The patch is validated in full before any
   * field changes, so a rejected patch leaves the series untouched.
   */
  _setSeriesStyle(seriesRef, patch) {
    this._assertAlive('chart.series.setOptions');
    const series = this._resolveSeries(seriesRef, 'chart.series.setOptions');
    assertPlainObject(patch, 'chart.series.setOptions', 'options');
    assertKnownKeys(patch, new Set([...SERIES_STYLE[series.type], 'lastValueVisible', 'priceLine', 'lastValueColorMode']), 'chart.series.setOptions', 'options');
    if ((series.type === 'area' || series.type === 'baseline') && patch.basePrice === undefined && 'basePrice' in patch) {
      fail('INVALID_ARGUMENT', 'chart.series.setOptions', `"${series.type}" requires an explicit "basePrice"`, {
        field: 'basePrice'
      });
    }
    const style = { ...normalizeSeriesStyle(series.type, patch, 'chart.series.setOptions'), ...normalizeSeriesPresentation(patch, 'chart.series.setOptions') };
    if (patch.lastValueVisible !== undefined) {
      style.lastValueVisible = assertBoolean(patch.lastValueVisible, 'chart.series.setOptions', 'options.lastValueVisible');
    }
    const next = { ...series._options };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete next[key];
    }
    series._options = Object.freeze(Object.assign(next, style));
    this._requestRender();
  }

  /** Explicitly set style values as a copy; absent keys use renderer defaults. */
  _seriesStyle(seriesRef) {
    this._assertAlive('chart.series.options');
    const series = this._resolveSeries(seriesRef, 'chart.series.options');
    const out = {};
    for (const key of SERIES_STYLE[series.type]) {
      if (series._options[key] !== undefined) out[key] = series._options[key];
    }
    if (series._options.lastValueVisible !== undefined) out.lastValueVisible = series._options.lastValueVisible;
    if (series._options.priceLine !== undefined) out.priceLine = { ...series._options.priceLine };
    if (series._options.lastValueColorMode !== undefined) out.lastValueColorMode = series._options.lastValueColorMode;
    return out;
  }

  _createSeriesFacade() {
    const chart = this;
    const facade = (seriesId) => {
      chart._assertAlive('chart.series');
      const series = chart._resolveSeries(seriesId, 'chart.series');
      return {
        id: series.id,
        type: series.type,
        setData: (data, metadata) => series.setData(data, metadata),
        update: (point) => series.update(point),
        prepend: (data) => series.prepend(data),
        correct: (point) => series.correct(point),
        data: () => series.data(),
        metadata: () => series.metadata(),
        setOptions: (patch) => chart._setSeriesStyle(series, patch),
        options: () => chart._seriesStyle(series)
      };
    };
    facade.list = () => {
      chart._assertAlive('chart.series.list');
      return [...chart._seriesById.values()].map((series) => ({
        id: series.id,
        type: series.type,
        paneId: series.pane.id,
        priceScaleId: series.priceScaleId,
        visible: series._options.visible !== false
      }));
    };
    facade.remove = (seriesId) => {
      chart._assertAlive('chart.series.remove');
      return chart.removeSeries(chart._resolveSeries(seriesId, 'chart.series.remove'));
    };
    facade.add = (spec) => {
      chart._assertAlive('chart.series.add');
      assertPlainObject(spec, 'chart.series.add', 'spec');
      return chart.addSeries(spec.type, spec.options ?? {}, spec.pane ?? spec.paneId);
    };
    facade.setVisible = (seriesId, visible) => {
      chart._assertAlive('chart.series.setVisible');
      const series = chart._resolveSeries(seriesId, 'chart.series.setVisible');
      const next = assertBoolean(visible, 'chart.series.setVisible', 'visible');
      if ((series._options.visible !== false) === next) return;
      series._options = Object.freeze({ ...series._options, visible: next });
      chart._refreshPriceScales();
      chart._emit('datachange', { chartId: chart._id, kind: 'seriesVisibility', seriesId });
      chart.requestRender();
    };
    return facade;
  }

  // -------------------------------------------------------------------------
  // Module attachment
  // -------------------------------------------------------------------------

  attach({ name, api, hooks = {} } = {}) {
    this._assertAlive('chart.attach');
    const moduleName = assertString(name, 'chart.attach', 'name', { nonEmpty: true });
    if (RESERVED_MODULE_NAMES.has(moduleName) || this[moduleName] !== undefined) {
      fail('INVALID_ARGUMENT', 'chart.attach', 'module name is reserved or already attached', {
        field: 'name'
      });
    }
    assertPlainObject(hooks, 'chart.attach', 'hooks');
    for (const key of Object.keys(hooks)) {
      if (!MODULE_HOOKS.has(key)) {
        fail('INVALID_ARGUMENT', 'chart.attach', 'unknown module hook', { field: key });
      }
      if (typeof hooks[key] !== 'function') {
        fail('INVALID_TYPE', 'chart.attach', 'module hook must be a function', { field: key });
      }
    }
    if (Boolean(hooks.onCaptureRestore) !== Boolean(hooks.onRollbackRestore) ||
        (hooks.onCaptureRestore && !hooks.onRestoreState)) {
      fail('INVALID_ARGUMENT', 'chart.attach', 'restore checkpoint hooks must be paired with onRestoreState', { field: 'hooks' });
    }
    if (this._modules.has(moduleName)) {
      fail('INVALID_ARGUMENT', 'chart.attach', 'module is already attached', { field: 'name' });
    }
    this._modules.set(moduleName, { name: moduleName, api, hooks });
    Object.defineProperty(this, moduleName, {
      value: api,
      configurable: true,
      enumerable: true,
      writable: true
    });
    return () => this.detach(moduleName);
  }

  detach(name) {
    this._assertAlive('chart.detach');
    const entry = this._modules.get(name);
    if (!entry) return;
    try {
      entry.hooks.onDestroy?.();
    } finally {
      this._modules.delete(name);
      delete this[name];
    }
  }

  _validateModules(hook, payload) {
    for (const module of this._modules.values()) {
      const fn = module.hooks[hook];
      if (typeof fn === 'function') fn(payload);
    }
  }

  _notifyModules(hook, payload) {
    if (this._restoreEvents && hook !== 'onDestroy') {
      this._restoreEvents.push({ kind: 'hook', name: hook, payload });
      return;
    }
    for (const module of this._modules.values()) {
      const fn = module.hooks[hook];
      if (typeof fn !== 'function') continue;
      try {
        fn(payload);
      } catch (error) {
        this._reportError(error, `${module.name}.${hook}`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Events, rendering, lifecycle
  // -------------------------------------------------------------------------

  subscribe(event, handler) {
    this._assertAlive('chart.subscribe');
    if (!CHART_EVENTS.includes(event)) {
      fail('INVALID_EVENT', 'chart.subscribe', 'unsupported event name', { field: 'event' });
    }
    if (typeof handler !== 'function') {
      fail('INVALID_TYPE', 'chart.subscribe', '"handler" must be a function', { field: 'handler' });
    }
    let set = this._listeners.get(event);
    if (!set) {
      set = new Set();
      this._listeners.set(event, set);
    }
    const subscription = { handler, active: true };
    set.add(subscription);
    return () => {
      if (!subscription.active) return;
      subscription.active = false;
      subscription.handler = null;
      set.delete(subscription);
    };
  }

  _emit(event, payload) {
    if (this._destroyed && event !== 'destroy') return;
    if (this._restoreEvents && event !== 'error' && event !== 'destroy') {
      this._restoreEvents.push({ kind: 'event', name: event, payload });
      return;
    }
    const set = this._listeners.get(event);
    if (!set) return;
    for (const subscription of [...set]) {
      if (!subscription.active || (this._destroyed && event !== 'destroy')) continue;
      try {
        subscription.handler(payload);
      } catch (error) {
        if (event === 'error') {
          this._host.announce?.(`listener error: ${error?.message ?? 'unknown'}`, {
            assertive: true
          });
        } else {
          this._reportError(error, `subscribe:${event}`);
        }
      }
    }
  }

  _reportError(error, operation) {
    if (this._destroyed && this._cleanupErrors) {
      this._cleanupErrors.push(new Error(`${operation}: ${error?.message ?? String(error)}`, { cause: error }));
    }
    const message = error instanceof Error ? error.message : String(error);
    this._host.announce?.(`${operation}: ${message}`, { assertive: true });
    if (this._reporting) return;
    this._reporting = true;
    try {
      this._emit('error', { chartId: this._id, operation, error });
    } finally {
      this._reporting = false;
    }
  }

  get renderRevision() {
    this._assertAlive('chart.renderRevision');
    return this._renderRevision;
  }

  get presentedRevision() {
    this._assertAlive('chart.presentedRevision');
    return this._presentedRevision;
  }

  requestRender() {
    this._assertAlive('chart.requestRender');
    this._requestRender();
  }

  _requestRender() {
    if (this._destroyed) return;
    this._syncDerivedLayout();
    this._renderRevision += 1;
    this._host.scheduleDraw?.();
  }

  /**
   * Resolves after a frame containing at least `revision` has been drawn and
   * every module onRender hook has completed. Defaults to the current revision.
   */
  whenRendered(revision = this._renderRevision) {
    this._assertAlive('chart.whenRendered');
    assertSafeInteger(revision, 'chart.whenRendered', 'revision');
    if (revision < 0) {
      fail('INVALID_ARGUMENT', 'chart.whenRendered', '"revision" must not be negative', {
        field: 'revision'
      });
    }
    if (this._presentedRevision >= revision) return Promise.resolve(this._presentedRevision);
    return new Promise((resolve, reject) => {
      this._renderWaiters.push({ revision, resolve, reject });
    });
  }

  /** Capture the currently displayed canvas without changing the chart. */
  async exportPng() {
    this._assertAlive('chart.exportPng');
    const canvas = this._canvas;
    if (!canvas || typeof canvas.toBlob !== 'function') {
      fail('PNG_UNAVAILABLE', 'chart.exportPng', 'a readable canvas is required');
    }
    let blob;
    try {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    } catch (error) {
      fail('PNG_UNAVAILABLE', 'chart.exportPng', `canvas could not be read: ${error.message}`);
    }
    this._assertAlive('chart.exportPng');
    if (!blob || blob.size === 0 || blob.type !== 'image/png') {
      fail('PNG_UNAVAILABLE', 'chart.exportPng', 'canvas did not produce a nonempty PNG');
    }
    return blob;
  }

  _draw() {
    if (this._destroyed || this._width <= 0 || this._height <= 0) return;
    const revision = this._renderRevision;
    let failure = null;
    try {
      const ctx = this._host.getContext?.();
      if (!ctx) throw new Error('chart.render: canvas context is unavailable');
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._reportPaneConflicts();
      if (this._destroyed) return;
      const overflowLabels = drawChart(ctx, this, { width: this._width, height: this._height });
      if (this._destroyed) return;
      this._host.setLabelOverflow?.(overflowLabels ?? []);
      for (const module of this._modules.values()) {
        const render = module.hooks.onRender;
        if (typeof render !== 'function') continue;
        try {
          render({ ctx, chart: this, layout: this._layout });
          if (this._destroyed) return;
        } catch (error) {
          if (this._destroyed) return;
          failure ??= error instanceof Error ? error : new Error('chart.render: a module failed');
          this._reportError(error, `${module.name}.onRender`);
        }
      }
    } catch (error) {
      if (this._destroyed) return;
      failure = error instanceof Error ? error : new Error('chart.render: rendering failed');
      this._reportError(error, 'render');
    }
    if (failure) {
      const pending = [];
      for (const waiter of this._renderWaiters) {
        if (waiter.revision <= revision) waiter.reject(failure);
        else pending.push(waiter);
      }
      this._renderWaiters = pending;
      return;
    }
    this._presentedRevision = revision;
    const payload = { chartId: this._id, revision };
    this._emit('render', payload);
    const pending = [];
    for (const waiter of this._renderWaiters) {
      if (revision >= waiter.revision) waiter.resolve(revision);
      else pending.push(waiter);
    }
    this._renderWaiters = pending;
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._cleanupErrors = [];
    for (const name of this._modules.keys()) {
      try {
        Object.defineProperty(this, name, {
          configurable: true,
          enumerable: true,
          get: () => this._assertAlive(`chart.${name}`),
          set: () => this._assertAlive(`chart.${name}`)
        });
      } catch (error) {
        this._cleanupErrors.push(new Error(`chart.${name}: unable to close registration`, { cause: error }));
      }
    }
    this._stopCountdown();
    this._notifyModules('onDestroy');
    this._emit('destroy', { chartId: this._id });
    for (const subscriptions of this._listeners.values()) {
      for (const subscription of subscriptions) {
        subscription.active = false;
        subscription.handler = null;
      }
      subscriptions.clear();
    }
    this._listeners.clear();
    this._modules.clear();
    this._crosshair = null;
    for (const waiter of this._renderWaiters) {
      waiter.reject(new ChartError('CHART_DESTROYED', 'chart.whenRendered: chart has been destroyed'));
    }
    this._renderWaiters = [];
    for (const view of this._derivedViews.values()) view._dispose();
    for (const series of this._seriesById.values()) series._dispose();
    for (const pane of this._panes) {
      collectionTargets.get(pane._series).clear();
      collectionTargets.get(pane._priceScales).clear();
    }
    this._derivedViews.clear();
    this._seriesById.clear();
    this._timeline._clearRaw();
    this._panes = [];
    this._mainPane = null;
    this._layout = null;
    this._options = null;
    this._theme = null;
    try { this._host.destroy?.(); }
    catch (error) { this._cleanupErrors.push(new Error('chart host cleanup failed', { cause: error })); }
    this._host = null;
    this._canvas = null;
    this._element = null;
    this._container = null;
    this._surface = null;
    this._seriesFacade = null;
    const errors = this._cleanupErrors;
    this._cleanupErrors = null;
    if (errors.length) throw new AggregateError(errors, 'chart.destroy: resource cleanup failed');
  }
}
