/**
 * Camera navigation: wheel zoom, free XY panning, axis zoom/reset, follow and
 * price auto-scale bookkeeping.
 *
 * Every mutation goes through the public `setVisibleRange`/`setAutoScale`/
 * `setFollowRealTime` API. Methods return `{ applied }` so the DOM layer only
 * calls `preventDefault()` when the chart actually consumed the gesture; an
 * empty scale, a disabled control or a reached limit leaves the page alone.
 */
import { InteractionError } from './errors.js';
import { clamp, isFiniteNumber } from './geometry.js';

function validateOptions(options = {}) {
  const wheel = options.wheel || {};
  const factor = wheel.factor === undefined ? 1.15 : wheel.factor;
  const minBarSpacing = wheel.minBarSpacing === undefined ? 2 : wheel.minBarSpacing;
  const maxBarSpacing = wheel.maxBarSpacing === undefined ? 80 : wheel.maxBarSpacing;
  if (!isFiniteNumber(factor) || factor <= 1) {
    throw new InteractionError('wheel.factor must be a finite number greater than 1', { code: 'INVALID_OPTION', field: 'wheel.factor' });
  }
  if (!isFiniteNumber(minBarSpacing) || minBarSpacing <= 0 || !isFiniteNumber(maxBarSpacing) || maxBarSpacing <= 0 || minBarSpacing > maxBarSpacing) {
    throw new InteractionError('wheel bar spacing limits must be finite, positive and ordered', {
      code: 'INVALID_OPTION',
      field: 'wheel.minBarSpacing',
    });
  }
  const keyboard = options.keyboard || {};
  const panFraction = keyboard.panFraction === undefined ? 0.1 : keyboard.panFraction;
  const zoomFactor = keyboard.zoomFactor === undefined ? 1.2 : keyboard.zoomFactor;
  const priceZoomFactor = keyboard.priceZoomFactor === undefined ? 1.2 : keyboard.priceZoomFactor;
  for (const [field, value] of [
    ['keyboard.panFraction', panFraction],
    ['keyboard.zoomFactor', zoomFactor],
    ['keyboard.priceZoomFactor', priceZoomFactor],
  ]) {
    if (!isFiniteNumber(value) || value <= 0) {
      throw new InteractionError(`${field} must be a finite positive number`, { code: 'INVALID_OPTION', field });
    }
  }
  return {
    wheel: { enabled: wheel.enabled !== false, invert: wheel.invert === true, factor, minBarSpacing, maxBarSpacing },
    keyboard: { panFraction, zoomFactor, priceZoomFactor },
    altWheelPrice: options.altWheelPrice !== false,
  };
}

function validRange(range) {
  return range && isFiniteNumber(range.from) && isFiniteNumber(range.to) && range.to > range.from ? range : null;
}

function validPriceRange(range) {
  return range && isFiniteNumber(range.min) && isFiniteNumber(range.max) && range.max > range.min ? range : null;
}

export function createNavigation({ adapter, options = {}, getLayout }) {
  const config = validateOptions(options);
  let follow = true;
  const autoState = new Map();

  function layout() {
    return getLayout();
  }

  function paneById(paneId) {
    const panes = layout().panes;
    return panes.find((pane) => pane.id === paneId && pane.visible) || panes.find((pane) => pane.visible) || null;
  }

  function primaryScale(pane) {
    if (!pane || pane.priceScales.length === 0) return null;
    return pane.priceScales[0];
  }

  // Each pane owns its x context: source panes share the main scale, a derived
  // pane has an independent one. Every x operation goes through that scale.
  function scaleOf(pane) {
    return adapter.indexScaleFor(pane.id);
  }

  function isDerived(pane) {
    return adapter.paneKind(pane.id) === 'derived';
  }

  function spanFor(pane) {
    const range = validRange(scaleOf(pane).getVisibleRange());
    if (!range || pane.plot.width <= 0) return null;
    return { range, span: range.to - range.from, step: pane.plot.width / (range.to - range.from) };
  }

  function spanLimits(plot) {
    return { minSpan: plot.width / config.wheel.maxBarSpacing, maxSpan: plot.width / config.wheel.minBarSpacing };
  }

  // Follow-realtime belongs to the source timeline; a manual move of a derived
  // pane never touches it.
  function markManualX(pane) {
    if (isDerived(pane)) return;
    if (follow) {
      follow = false;
      scaleOf(pane).setFollowRealTime(false);
    }
  }

  function markManualPrice(pane, scaleId, scale) {
    autoState.set(`${pane.id}:${scaleId}`, false);
    scale.setAutoScale(false);
  }

  function isAuto(pane, scaleId, scale) {
    const key = `${pane.id}:${scaleId}`;
    if (autoState.has(key)) return autoState.get(key);
    return scale.isAutoScale() === true;
  }

  function zoomIndexAround(pointX, pane, factor) {
    const plot = pane.plot;
    const scale = scaleOf(pane);
    const geometry = spanFor(pane);
    if (!geometry) return { applied: false, reason: 'no-transform' };
    const logical = scale.coordinateToLogical(pointX - plot.x);
    if (!isFiniteNumber(logical)) return { applied: false, reason: 'no-transform' };
    const { span } = geometry;
    const limits = spanLimits(plot);
    const newSpan = clamp(span * factor, Math.min(span, limits.minSpan), Math.max(span, limits.maxSpan));
    if (Math.abs(newSpan - span) < 1e-9) return { applied: false, reason: 'limit' };
    const from = logical - ((pointX - plot.x) / plot.width) * newSpan;
    scale.setVisibleRange({ from, to: from + newSpan });
    markManualX(pane);
    const anchorAfter = plot.x + scale.logicalToCoordinate(logical);
    return { applied: true, span: newSpan, anchorLogical: logical, anchorCoordinate: anchorAfter };
  }

  function zoomPriceAround(pane, scaleId, pointY, factor) {
    const scale = adapter.priceScale(pane.id, scaleId);
    const range = validPriceRange(scale.getVisibleRange());
    if (!range || pane.plot.height <= 0) return { applied: false, reason: 'no-transform' };
    const anchor = pointY - pane.plot.y;
    const first = scale.coordinateToPrice(anchor - anchor * factor);
    const last = scale.coordinateToPrice(anchor + (pane.plot.height - anchor) * factor);
    if (!isFiniteNumber(first) || !isFiniteNumber(last) || first === last) return { applied: false, reason: 'limit' };
    const min = Math.min(first, last);
    const max = Math.max(first, last);
    if (Math.abs(min - range.min) < 1e-12 && Math.abs(max - range.max) < 1e-12) return { applied: false, reason: 'limit' };
    scale.setVisibleRange({ min, max });
    markManualPrice(pane, scaleId, scale);
    return { applied: true, min, max };
  }

  function panHorizontal(dx, pane) {
    const geometry = spanFor(pane);
    if (!geometry) return { applied: false, reason: 'no-transform' };
    const { range, span } = geometry;
    const shift = (dx / pane.plot.width) * span;
    scaleOf(pane).setVisibleRange({ from: range.from - shift, to: range.to - shift });
    markManualX(pane);
    return { applied: true, shift };
  }

  function panPrice(dy, pane, scaleId) {
    const scale = adapter.priceScale(pane.id, scaleId);
    const range = validPriceRange(scale.getVisibleRange());
    if (!range || pane.plot.height <= 0) return { applied: false, reason: 'no-transform' };
    const first = scale.coordinateToPrice(-dy);
    const last = scale.coordinateToPrice(pane.plot.height - dy);
    if (!isFiniteNumber(first) || !isFiniteNumber(last) || first === last) return { applied: false, reason: 'limit' };
    const min = Math.min(first, last);
    const max = Math.max(first, last);
    scale.setVisibleRange({ min, max });
    markManualPrice(pane, scaleId, scale);
    return { applied: true, delta: min - range.min };
  }

  const navigation = {
    get follow() {
      return follow;
    },
    get config() {
      return config;
    },
    paneById,
    isPriceAuto(paneId, scaleId) {
      const pane = paneById(paneId);
      const scale = primaryScale(pane);
      if (!pane || !scale) return false;
      return isAuto(pane, scaleId || scale.id, adapter.priceScale(pane.id, scaleId || scale.id));
    },
    wheel(point, deltaY, { altKey = false, paneId = null } = {}) {
      const pane = layout().panes.find((candidate) => candidate.id === paneId && candidate.visible);
      if (!config.wheel.enabled || (altKey && !config.altWheelPrice)) return { applied: false, reason: 'disabled' };
      if (!pane) return { applied: false, reason: 'no-pane' };
      if (!isFiniteNumber(deltaY) || deltaY === 0) return { applied: false, reason: 'no-delta' };
      const direction = config.wheel.invert ? -1 : 1;
      const factor = config.wheel.factor ** (direction * clamp(deltaY / 100, -1, 1));
      if (altKey && config.altWheelPrice) {
        const scale = primaryScale(pane);
        if (!scale) return { applied: false, reason: 'no-scale' };
        return { ...zoomPriceAround(pane, scale.id, point.y, factor), target: 'price' };
      }
      return { ...zoomIndexAround(point.x, pane, factor), target: 'index' };
    },
    pan(dx, dy, paneId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      const results = [];
      if (dx !== 0) results.push({ axis: 'index', ...panHorizontal(dx, pane) });
      if (dy !== 0) {
        const scale = primaryScale(pane);
        if (scale) results.push({ axis: 'price', ...panPrice(dy, pane, scale.id) });
      }
      return { applied: results.some((result) => result.applied), results, paneId: pane.id };
    },
    zoomIndex(factor, anchorX = null, paneId = null) {
      const pane = paneById(paneId);
      if (!pane || !isFiniteNumber(factor) || factor <= 0) return { applied: false, reason: 'invalid' };
      const geometry = spanFor(pane);
      if (!geometry) return { applied: false, reason: 'no-transform' };
      const limits = spanLimits(pane.plot);
      const newSpan = clamp(geometry.span * factor, Math.min(geometry.span, limits.minSpan), Math.max(geometry.span, limits.maxSpan));
      if (Math.abs(newSpan - geometry.span) < 1e-9) return { applied: false, reason: 'limit' };
      const x = anchorX === null ? pane.plot.x + pane.plot.width / 2 : anchorX;
      const scale = scaleOf(pane);
      const logical = scale.coordinateToLogical(x - pane.plot.x);
      if (!isFiniteNumber(logical)) return { applied: false, reason: 'no-transform' };
      const from = logical - ((x - pane.plot.x) / pane.plot.width) * newSpan;
      scale.setVisibleRange({ from, to: from + newSpan });
      markManualX(pane);
      return { applied: true, span: newSpan };
    },
    /** direction +1 moves the view towards later slots (content moves left). */
    keyboardPan(direction, paneId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      const geometry = spanFor(pane);
      if (!geometry) return { applied: false, reason: 'no-transform' };
      const dx = -direction * config.keyboard.panFraction * pane.plot.width;
      return navigation.pan(dx, 0, pane.id);
    },
    keyboardZoom(direction, paneId = null) {
      const factor = direction > 0 ? 1 / config.keyboard.zoomFactor : config.keyboard.zoomFactor;
      return navigation.zoomIndex(factor, null, paneId);
    },
    keyboardPriceZoom(direction, paneId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      const scale = primaryScale(pane);
      if (!scale) return { applied: false, reason: 'no-scale' };
      const centerY = pane.plot.y + pane.plot.height / 2;
      return zoomPriceAround(pane, scale.id, centerY,
        direction > 0 ? 1 / config.keyboard.priceZoomFactor : config.keyboard.priceZoomFactor);
    },
    zoomPriceAxis(paneId, scaleId, pointY, factor) {
      const pane = paneById(paneId);
      if (!pane || !isFiniteNumber(factor) || factor <= 0) return { applied: false, reason: 'invalid' };
      const scale = primaryScale(pane);
      if (!scale) return { applied: false, reason: 'no-scale' };
      return zoomPriceAround(pane, scaleId || scale.id, pointY, factor);
    },
    /**
     * Axis drag zoom. Every step re-applies the factor to the range captured at
     * drag start around a fixed pane-centre anchor: chaining incremental zooms
     * around the moving pointer made the scale drift away from the cursor.
     */
    beginAxisZoom(kind, paneId, scaleId = null) {
      const pane = paneById(paneId);
      if (!pane) return null;
      if (kind === 'index') {
        const scale = scaleOf(pane);
        const start = scale.getVisibleRange();
        const anchorX = pane.plot.x + pane.plot.width / 2;
        return { zoom(factor) { scale.setVisibleRange({ from: start.from, to: start.to }); return zoomIndexAround(anchorX, pane, factor); } };
      }
      const primary = primaryScale(pane);
      const id = scaleId || primary?.id;
      if (!id) return null;
      const scale = adapter.priceScale(pane.id, id);
      const start = validPriceRange(scale.getVisibleRange());
      if (!start) return null;
      const anchorY = pane.plot.y + pane.plot.height / 2;
      return { zoom(factor) { scale.setVisibleRange({ min: start.min, max: start.max }); return zoomPriceAround(pane, id, anchorY, factor); } };
    },
    resetIndexStep(anchorX = null, paneId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      if (!isFiniteNumber(adapter.initialBarSpacing) || adapter.initialBarSpacing <= 0) {
        return { applied: false, reason: 'no-initial-step' };
      }
      const geometry = spanFor(pane);
      if (!geometry) return { applied: false, reason: 'no-transform' };
      const newSpan = pane.plot.width / adapter.initialBarSpacing;
      const x = anchorX === null ? pane.plot.x + pane.plot.width / 2 : anchorX;
      const scale = scaleOf(pane);
      const logical = scale.coordinateToLogical(x - pane.plot.x);
      if (!isFiniteNumber(logical)) return { applied: false, reason: 'no-transform' };
      const from = logical - ((x - pane.plot.x) / pane.plot.width) * newSpan;
      scale.setVisibleRange({ from, to: from + newSpan });
      return { applied: true, span: newSpan };
    },
    enablePriceAuto(paneId = null, scaleId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      const scale = primaryScale(pane);
      if (!scale) return { applied: false, reason: 'no-scale' };
      const chosen = scaleId || scale.id;
      const priceScale = adapter.priceScale(pane.id, chosen);
      priceScale.setAutoScale(true);
      autoState.set(`${pane.id}:${chosen}`, true);
      return { applied: true, paneId: pane.id, scaleId: chosen };
    },
    /**
     * Linear <-> log on the pane's primary price scale. Percent mode is left
     * alone (its base is owned by the host); a log range error propagates.
     */
    toggleLogScale(paneId = null) {
      const pane = paneById(paneId);
      if (!pane) return { applied: false, reason: 'no-pane' };
      const primary = primaryScale(pane);
      if (!primary) return { applied: false, reason: 'no-scale' };
      const scale = adapter.priceScale(pane.id, primary.id);
      if (typeof scale.setMode !== 'function') {
        throw new InteractionError('Price scale does not support setMode', { code: 'UNSUPPORTED_SCALE', field: 'priceScale.setMode', action: 'toggleLogScale' });
      }
      if (scale.mode === 'percent') return { applied: false, reason: 'percent-mode', paneId: pane.id, scaleId: primary.id };
      const mode = scale.mode === 'log' ? 'linear' : 'log';
      scale.setMode(mode);
      return { applied: true, mode, paneId: pane.id, scaleId: primary.id };
    },
    /** Fit the scale of the pane (the main scale when no pane is given). */
    fitContent(paneId = null) {
      const pane = paneId === null ? null : paneById(paneId);
      (pane ? scaleOf(pane) : adapter.indexScaleFor(null)).fitContent();
      return { applied: true };
    },
    /** A derived pane scrolls to its last element and never follows realtime. */
    scrollToRealTime(paneId = null) {
      const pane = paneId === null ? null : paneById(paneId);
      if (pane && isDerived(pane)) {
        scaleOf(pane).scrollToRealTime();
        return { applied: true };
      }
      const scale = pane ? scaleOf(pane) : adapter.indexScaleFor(null);
      scale.scrollToRealTime();
      follow = true;
      scale.setFollowRealTime(true);
      return { applied: true };
    },
    setFollow(enabled, paneId = null) {
      const pane = paneId === null ? null : paneById(paneId);
      if (pane && isDerived(pane)) return { applied: false, reason: 'derived-pane', follow };
      follow = enabled === true;
      (pane ? scaleOf(pane) : adapter.indexScaleFor(null)).setFollowRealTime(follow);
      return { applied: true, follow };
    },
    /** Incoming data must not move a manually positioned view. */
    handleDataChange(changeKind) {
      if (follow) return { applied: false, reason: 'following' };
      return { applied: false, reason: 'manual-view', changeKind };
    },
  };
  return navigation;
}

export { validRange as readVisibleRange };
