import { fail } from '../errors.js';
import {
  assertBoolean,
  assertFiniteNumber,
  assertNonNegativeNumber,
  assertPlainObject,
  assertPositiveNumber,
  assertString
} from './validate.js';
import { normalizeMargins } from './options.js';

/**
 * Horizontal index scale. Integer coordinates are current slot indices;
 * fractional coordinates are free logical positions in step units.
 * The camera is independent of data and may extend past both edges.
 */
export class IndexScale {
  constructor({ provider, width = 0, barSpacing = 8, rightOffset = 2, onChange = null, assertAlive = null, name = 'index' }) {
    this._name = name;
    this._provider = provider;
    this._width = 0;
    this._lastNonzeroWidth = 0;
    this._barSpacing = barSpacing;
    this._rightOffset = rightOffset;
    this._from = -0.5;
    this._follow = true;
    this._initialized = false;
    this._onChange = onChange;
    this._assertAlive = assertAlive;
    this.setWidth(width);
  }
  get name() {
    this._assertAlive?.('indexScale.name');
    return this._name;
  }


  get length() {
    this._assertAlive?.('indexScale.length');
    return this._provider.length();
  }

  get barSpacing() {
    this._assertAlive?.('indexScale.barSpacing');
    return this._barSpacing;
  }

  get rightOffset() {
    this._assertAlive?.('indexScale.rightOffset');
    return this._rightOffset;
  }

  get follow() {
    this._assertAlive?.('indexScale.follow');
    return this._follow;
  }

  isFollowingRealTime() {
    this._assertAlive?.('indexScale.isFollowingRealTime');
    return this._follow;
  }

  setFollowRealTime(enabled) {
    this._assertAlive?.('indexScale.setFollowRealTime');
    assertBoolean(enabled, 'indexScale.setFollowRealTime', 'enabled');
    this._follow = enabled;
    if (enabled) this.scrollToRealTime();
  }

  /** Slot snapshots backing this scale (element descriptors for derived scales). */
  slots() {
    this._assertAlive?.('indexScale.slots');
    const out = [];
    for (let i = 0; i < this._provider.length(); i += 1) {
      const slot = this._provider.slotAt?.(i);
      if (slot) out.push(slot);
      else out.push({ barId: this._provider.barIdAt(i) });
    }
    return out;
  }

  get width() {
    this._assertAlive?.('indexScale.width');
    return this._width;
  }

  _mappingDefined() {
    return this._width > 0 && this._barSpacing > 0 && this._provider.length() > 0;
  }

  _ensureInitialized() {
    if (!this._initialized && this._provider.length() > 0 && this._width > 0) {
      this._fitInternal();
      this._initialized = true;
    }
  }

  _fitInternal() {
    const length = this._provider.length();
    const denominator = Math.max(length + this._rightOffset, 1);
    this._barSpacing = this._width / denominator;
    this._from = -0.5;
  }

  _emit() {
    this._onChange?.();
  }

  setWidth(width) {
    this._assertAlive?.('indexScale.setWidth');
    assertNonNegativeNumber(width, 'indexScale.setWidth', 'width');
    if (width === this._width) return;
    if (this._initialized && width > 0 && this._lastNonzeroWidth > 0) {
      this._barSpacing *= width / this._lastNonzeroWidth;
    }
    if (width > 0) this._lastNonzeroWidth = width;
    this._width = width;
    if (!this._initialized) this._ensureInitialized();
    this._emit();
  }

  /** Called after slots are appended. Follow mode reveals them. */
  handleAppend(count) {
    this._assertAlive?.('indexScale.handleAppend');
    if (!Number.isInteger(count) || count <= 0) return;
    if (!this._initialized) {
      this._ensureInitialized();
      this._emit();
      return;
    }
    if (this._follow) this._from += count;
    this._emit();
  }

  /** Called after slots are prepended: the same bars keep screen positions. */
  handlePrepend(count) {
    this._assertAlive?.('indexScale.handlePrepend');
    if (!Number.isInteger(count) || count <= 0) return;
    if (!this._initialized) {
      this._ensureInitialized();
    } else {
      this._from += count;
    }
    this._emit();
  }

  /** Called after a prefix of slots is removed: remaining bars keep positions. */
  handleRemovePrefix(count) {
    this._assertAlive?.('indexScale.handleRemovePrefix');
    if (!Number.isInteger(count) || count <= 0) return;
    this._from -= count;
    this._emit();
  }

  /** Called after setTimeline. Keeps the camera when it was already defined. */
  handleReplace() {
    this._assertAlive?.('indexScale.handleReplace');
    if (!this._initialized) {
      this._ensureInitialized();
    }
    this._emit();
  }

  /** Internal: rebase the camera without emitting (caller emits once). */
  _rebaseFrom(from) {
    this._from = from;
    this._initialized = true;
  }

  _emitChange() {
    this._emit();
  }

  indexToCoordinate(index) {
    this._assertAlive?.('indexScale.indexToCoordinate');
    if (!Number.isInteger(index) || index < 0 || index >= this._provider.length()) return null;
    if (!this._mappingDefined()) {
      this._ensureInitialized();
      if (!this._mappingDefined()) return null;
    }
    return (index - this._from) * this._barSpacing;
  }

  coordinateToIndex(x) {
    this._assertAlive?.('indexScale.coordinateToIndex');
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    if (!this._mappingDefined()) {
      this._ensureInitialized();
      if (!this._mappingDefined()) return null;
    }
    const logical = this._from + x / this._barSpacing;
    const max = this._provider.length() - 1;
    if (logical < 0 || logical > max) return null;
    let index = Math.floor(logical + 0.5);
    if (index - logical === 0.5) index -= 1;
    return Math.min(max, Math.max(0, index));
  }

  barIdToIndex(barId) {
    this._assertAlive?.('indexScale.barIdToIndex');
    return this._provider.indexOf(barId);
  }

  indexToBarId(index) {
    this._assertAlive?.('indexScale.indexToBarId');
    if (!Number.isInteger(index) || index < 0 || index >= this._provider.length()) return null;
    return this._provider.barIdAt(index);
  }

  barIdToCoordinate(barId) {
    this._assertAlive?.('indexScale.barIdToCoordinate');
    const index = this.barIdToIndex(barId);
    return index === null ? null : this.indexToCoordinate(index);
  }

  coordinateToLogical(x) {
    this._assertAlive?.('indexScale.coordinateToLogical');
    if (typeof x !== 'number' || !Number.isFinite(x)) return null;
    if (!this._mappingDefined()) {
      this._ensureInitialized();
      if (!this._mappingDefined()) return null;
    }
    return this._from + x / this._barSpacing;
  }

  logicalToCoordinate(logical) {
    this._assertAlive?.('indexScale.logicalToCoordinate');
    if (typeof logical !== 'number' || !Number.isFinite(logical)) return null;
    if (!this._mappingDefined()) {
      this._ensureInitialized();
      if (!this._mappingDefined()) return null;
    }
    return (logical - this._from) * this._barSpacing;
  }

  getVisibleRange() {
    this._assertAlive?.('indexScale.getVisibleRange');
    if (!this._mappingDefined()) {
      this._ensureInitialized();
      if (!this._mappingDefined()) return null;
    }
    return { from: this._from, to: this._from + this._width / this._barSpacing };
  }

  setVisibleRange(range) {
    this._assertAlive?.('indexScale.setVisibleRange');
    assertPlainObject(range, 'indexScale.setVisibleRange', 'range');
    const { from, to } = range;
    assertFiniteNumber(from, 'indexScale.setVisibleRange', 'from');
    assertFiniteNumber(to, 'indexScale.setVisibleRange', 'to');
    if (!(from < to)) {
      fail('INVALID_RANGE', 'indexScale.setVisibleRange', 'range requires "from" < "to"', {
        field: 'range'
      });
    }
    if (this._width <= 0) {
      fail('INVALID_RANGE', 'indexScale.setVisibleRange', 'cannot define a range with zero width', {
        field: 'width'
      });
    }
    this._from = from;
    this._barSpacing = this._width / (to - from);
    this._initialized = true;
    this._follow = false;
    this._emit();
  }

  fitContent() {
    this._assertAlive?.('indexScale.fitContent');
    if (this._provider.length() === 0 || this._width <= 0) return;
    this._fitInternal();
    this._initialized = true;
    this._follow = false;
    this._emit();
  }

  scrollToRealTime() {
    this._assertAlive?.('indexScale.scrollToRealTime');
    if (this._provider.length() === 0 || this._width <= 0) return;
    if (!(this._barSpacing > 0)) this._barSpacing = 8;
    const last = this._provider.length() - 1;
    this._from = last + this._rightOffset - this._width / this._barSpacing;
    this._initialized = true;
    this._follow = true;
    this._emit();
  }

  /**
   * Changes bar spacing while keeping the logical position under anchorX fixed.
   */
  setBarSpacing(barSpacing, anchorX) {
    this._assertAlive?.('indexScale.setBarSpacing');
    assertPositiveNumber(barSpacing, 'indexScale.setBarSpacing', 'barSpacing');
    if (!this._mappingDefined()) {
      this._barSpacing = barSpacing;
      this._emit();
      return;
    }
    const x = typeof anchorX === 'number' && Number.isFinite(anchorX) ? anchorX : this._width / 2;
    const anchorLogical = this._from + x / this._barSpacing;
    this._barSpacing = barSpacing;
    this._from = anchorLogical - x / barSpacing;
    this._follow = false;
    this._emit();
  }

  setRightOffset(rightOffset) {
    this._assertAlive?.('indexScale.setRightOffset');
    assertNonNegativeNumber(rightOffset, 'indexScale.setRightOffset', 'rightOffset');
    this._rightOffset = rightOffset;
    this._emit();
  }

  /**
   * Finds the unique slot index with exactly this provided time.
   * Returns null when no slot has it; throws on ambiguity.
   */
  timeToIndex(time) {
    this._assertAlive?.('indexScale.timeToIndex');
    assertFiniteNumber(time, 'indexScale.timeToIndex', 'time');
    let found = null;
    for (let i = 0; i < this._provider.length(); i += 1) {
      const slot = this._provider.slotAt?.(i);
      if (slot && slot.time === time) {
        if (found !== null) {
          fail('INVALID_ARGUMENT', 'indexScale.timeToIndex', 'time matches more than one slot', {
            field: 'time'
          });
        }
        found = i;
      }
    }
    return found;
  }
}

/**
 * Vertical price scale. Ranges are kept in price units; mode changes only
 * the projection. Manual ranges disable auto scaling until reset.
 */
export class PriceScale {
  constructor({
    name = 'right',
    side = 'right',
    height = 0,
    inverted = false,
    visible = true,
    mode = 'linear',
    base = null,
    autoScale = true,
    onChange = null,
    assertAlive = null,
    defaultMargins = null
  } = {}) {
    this._name = name;
    this._side = side;
    this._height = 0;
    this._inverted = inverted;
    this._visible = visible;
    this._mode = 'linear';
    this._base = null;
    this._autoScale = autoScale;
    this._manualRange = null;
    this._autoRange = null;
    this._raw = null;
    this._margins = null;
    this._defaultMargins = defaultMargins;
    this._overlay = false;
    this._onChange = onChange;
    this._assertAlive = assertAlive;
    this.setHeight(height);
    this._validateMode(mode, { base });
    this._mode = mode;
    if (mode === 'percent') this._base = base;
  }
  get name() {
    this._assertAlive?.('priceScale.name');
    return this._name;
  }


  get side() {
    this._assertAlive?.('priceScale.side');
    return this._side;
  }

  get visible() {
    this._assertAlive?.('priceScale.visible');
    return this._visible;
  }

  get inverted() {
    this._assertAlive?.('priceScale.inverted');
    return this._inverted;
  }

  get mode() {
    this._assertAlive?.('priceScale.mode');
    return this._mode;
  }

  get base() {
    this._assertAlive?.('priceScale.base');
    return this._base;
  }

  get autoScale() {
    this._assertAlive?.('priceScale.autoScale');
    return this._autoScale;
  }

  get height() {
    this._assertAlive?.('priceScale.height');
    return this._height;
  }

  get id() {
    this._assertAlive?.('priceScale.id');
    return this.name;
  }

  isAutoScale() {
    this._assertAlive?.('priceScale.isAutoScale');
    return this._autoScale;
  }

  setOnChange(callback) {
    this._assertAlive?.('priceScale.setOnChange');
    this._onChange = callback;
  }

  _emit(layoutChanged = false) {
    this._onChange?.(layoutChanged);
  }

  setHeight(height) {
    this._assertAlive?.('priceScale.setHeight');
    assertNonNegativeNumber(height, 'priceScale.setHeight', 'height');
    if (height === this._height) return;
    this._height = height;
  }

  setSide(side) {
    this._assertAlive?.('priceScale.setSide');
    if (side !== 'left' && side !== 'right') {
      fail('INVALID_ARGUMENT', 'priceScale.setSide', '"side" must be "left" or "right"', {
        field: 'side'
      });
    }
    this._side = side;
    this._emit(true);
  }

  setInverted(inverted) {
    this._assertAlive?.('priceScale.setInverted');
    assertBoolean(inverted, 'priceScale.setInverted', 'inverted');
    this._inverted = inverted;
    this._emit();
  }

  setVisible(visible) {
    this._assertAlive?.('priceScale.setVisible');
    assertBoolean(visible, 'priceScale.setVisible', 'visible');
    this._visible = visible;
    this._emit(true);
  }

  /** An overlay scale draws its series inside the pane with no axis column, grid, labels or last-value labels. */
  get overlay() {
    this._assertAlive?.('priceScale.overlay');
    return this._overlay;
  }

  setOverlay(enabled) {
    this._assertAlive?.('priceScale.setOverlay');
    assertBoolean(enabled, 'priceScale.setOverlay', 'enabled');
    this._overlay = enabled;
    this._emit(true);
  }

  setAutoScale(enabled) {
    this._assertAlive?.('priceScale.setAutoScale');
    assertBoolean(enabled, 'priceScale.setAutoScale', 'enabled');
    this._autoScale = enabled;
    if (enabled) this._manualRange = null;
    this._emit();
  }

  setVisibleRange(range) {
    this._assertAlive?.('priceScale.setVisibleRange');
    assertPlainObject(range, 'priceScale.setVisibleRange', 'range');
    const { min, max } = range;
    assertFiniteNumber(min, 'priceScale.setVisibleRange', 'min');
    assertFiniteNumber(max, 'priceScale.setVisibleRange', 'max');
    if (!(min < max)) {
      fail('INVALID_RANGE', 'priceScale.setVisibleRange', 'range requires "min" < "max"', {
        field: 'range'
      });
    }
    if (this._mode === 'log' && !(min > 0)) {
      fail('LOG_RANGE', 'priceScale.setVisibleRange', 'log mode requires strictly positive bounds', {
        field: 'min'
      });
    }
    if (this._mode === 'percent' && !this._base) {
      fail('INVALID_BASE', 'priceScale.setVisibleRange', 'percent mode requires a base', {
        field: 'base'
      });
    }
    this._manualRange = { min, max };
    this._autoScale = false;
    this._emit();
  }

  getVisibleRange() {
    this._assertAlive?.('priceScale.getVisibleRange');
    const range = this._manualRange ?? this._autoRange;
    return range ? { min: range.min, max: range.max } : null;
  }

  _validateMode(mode, { base } = {}) {
    if (mode !== 'linear' && mode !== 'log' && mode !== 'percent') {
      fail('INVALID_MODE', 'priceScale.setMode', '"mode" must be "linear", "log" or "percent"', {
        field: 'mode'
      });
    }
    if (mode === 'log') {
      const range = this._manualRange ?? this._autoRange;
      if (range && !(range.min > 0)) {
        fail('LOG_RANGE', 'priceScale.setMode', 'log mode requires a strictly positive range', {
          field: 'range'
        });
      }
    }
    if (mode === 'percent') {
      const candidate = base ?? (this._mode === 'percent' ? this._base : null);
      if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate === 0) {
        fail('INVALID_BASE', 'priceScale.setMode', 'percent mode requires a finite non-zero "base"', {
          field: 'base'
        });
      }
    }
  }

  setMode(mode, options = {}) {
    this._assertAlive?.('priceScale.setMode');
    assertPlainObject(options, 'priceScale.setMode', 'options');
    this._validateMode(mode, options);
    this._mode = mode;
    if (mode === 'percent') this._base = options.base ?? this._base;
    this._emit();
  }

  /**
   * Internal: feeds an auto range computed from visible data. Padding keeps a
   * flat series visible without inventing values in the data.
   */
  updateAutoRange(rawMin, rawMax) {
    this._assertAlive?.('priceScale.updateAutoRange');
    assertFiniteNumber(rawMin, 'priceScale.updateAutoRange', 'min');
    assertFiniteNumber(rawMax, 'priceScale.updateAutoRange', 'max');
    if (!(rawMin <= rawMax)) {
      fail('INVALID_RANGE', 'priceScale.updateAutoRange', '"min" must not exceed "max"', {
        field: 'range'
      });
    }
    if (this._mode === 'log' && !(rawMin > 0)) {
      fail('LOG_RANGE', 'priceScale.updateAutoRange', 'log mode requires strictly positive data', {
        field: 'data'
      });
    }
    this._raw = { min: rawMin, max: rawMax };
    this._applyMargins();
  }

  clearAutoRange() {
    this._assertAlive?.('priceScale.clearAutoRange');
    this._autoRange = null;
    this._raw = null;
  }

  /** Autoscale margins of this scale; `null` means the chart default (10% of the span on each side when that is unset too). */
  get margins() {
    return this._margins ? { ...this._margins } : null;
  }

  setMargins(margins) {
    this._assertAlive?.('priceScale.setMargins');
    this._margins = normalizeMargins(margins, 'priceScale.setMargins', 'margins');
    this._applyMargins();
    this._emit();
  }

  _applyMargins() {
    if (!this._raw) return;
    const { min: rawMin, max: rawMax } = this._raw;
    const margins = this._margins ?? this._defaultMargins?.() ?? null;
    const log = this._mode === 'log';
    if (log && !(rawMin > 0)) return;
    const low = log ? Math.log(rawMin) : rawMin;
    const high = log ? Math.log(rawMax) : rawMax;
    let range;
    if (margins === null) {
      // Earlier behaviour, kept exact: 10% of the span on each side.
      const span = high - low;
      const pad = span === 0 ? (log ? 0.01 : Math.abs(rawMax) * 0.01 || 0.5) : span * 0.1;
      range = { low: low - pad, high: high + pad };
    } else {
      // Margins are fractions of the pane height, so the padded span is the data span over the free fraction.
      let from = low;
      let to = high;
      if (to - from === 0) {
        const half = log ? 0.01 : Math.abs(rawMax) * 0.01 || 0.5;
        from -= half;
        to += half;
      }
      const total = (to - from) / (1 - margins.top - margins.bottom);
      range = { low: from - margins.bottom * total, high: to + margins.top * total };
    }
    this._autoRange = log ? { min: Math.exp(range.low), max: Math.exp(range.high) } : { min: range.low, max: range.high };
  }

  _percent(price) {
    return (100 * (price - this._base)) / Math.abs(this._base);
  }

  _fromPercent(percent) {
    return this._base + (percent * Math.abs(this._base)) / 100;
  }

  _normalized(price) {
    const range = this._manualRange ?? this._autoRange;
    if (!range) return null;
    if (this._mode === 'log') {
      if (!(price > 0)) {
        fail('LOG_RANGE', 'priceScale', 'log mode cannot project a non-positive price', {
          field: 'price'
        });
      }
      const logMin = Math.log(range.min);
      const logMax = Math.log(range.max);
      return (Math.log(price) - logMin) / (logMax - logMin);
    }
    if (this._mode === 'percent') {
      const pMin = this._percent(range.min);
      const pMax = this._percent(range.max);
      return (this._percent(price) - pMin) / (pMax - pMin);
    }
    return (price - range.min) / (range.max - range.min);
  }

  priceToCoordinate(price) {
    this._assertAlive?.('priceScale.priceToCoordinate');
    assertFiniteNumber(price, 'priceScale.priceToCoordinate', 'price');
    const range = this._manualRange ?? this._autoRange;
    if (!range || this._height <= 0) return null;
    const t = this._normalized(price);
    if (t === null || !Number.isFinite(t)) return null;
    return this._inverted ? t * this._height : (1 - t) * this._height;
  }

  coordinateToPrice(y) {
    this._assertAlive?.('priceScale.coordinateToPrice');
    assertFiniteNumber(y, 'priceScale.coordinateToPrice', 'y');
    const range = this._manualRange ?? this._autoRange;
    if (!range || this._height <= 0) return null;
    const t = this._inverted ? y / this._height : 1 - y / this._height;
    if (this._mode === 'log') {
      const logMin = Math.log(range.min);
      const logMax = Math.log(range.max);
      return Math.exp(logMin + t * (logMax - logMin));
    }
    if (this._mode === 'percent') {
      const pMin = this._percent(range.min);
      const pMax = this._percent(range.max);
      return this._fromPercent(pMin + t * (pMax - pMin));
    }
    return range.min + t * (range.max - range.min);
  }
}
