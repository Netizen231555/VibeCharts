import { DRAWING_TOOLS, normalizeProps } from '../drawings/tools.js';
import { drawLayout } from '../drawings/render.js';
import { STYLE_FAMILIES } from '../drawings/styles.js';
import { translate, resolveLocale } from './messages.js';

// Two-point line-family tools that Shift pins to the first anchor's price.
export const SHIFT_HORIZONTAL_TYPES = Object.freeze(['segment', 'ray', 'line', 'arrow', 'measure']);

export const SNAP_MODIFIERS = Object.freeze(['alt', 'ctrl', 'meta']);

// Pointer-event flags the tool and handle drag read; shiftKey is the horizontal constraint, the rest drive snapping.
export function modifierState(event) {
  return { shiftKey: event?.shiftKey === true, altKey: event?.altKey === true, ctrlKey: event?.ctrlKey === true, metaKey: event?.metaKey === true };
}

// `modifier` is one name, a list of names, or null/absent; any listed modifier counts as held.
export function snapModifierHeld(snap, mods) {
  const names = snap.modifier === undefined || snap.modifier === null ? [] : [].concat(snap.modifier);
  return names.some(name => mods[`${name}Key`] === true);
}

// Single source of truth for snapping. While a configured modifier is held the snap is strong with the
// centre-of-bar magnet, whatever the persistent mode is; otherwise the persistent snap applies unchanged.
// In either case a missing sourceId resolves to the pane's primary price series (first visible candlestick,
// bar, line or area), so a persistent mode set without a source still snaps; if there is none the snap stays
// source-less and snapPrice reports 'snap-unavailable' through the announce path instead of silently doing nothing.
const PRICE_SERIES = ['candlestick', 'bar', 'line', 'area'];

export function effectiveSnap(chart, binding, snap = {}, mods = {}) {
  const effective = snapModifierHeld(snap, mods) ? { ...snap, mode: 'strong', magnet: true } : snap;
  if (effective.sourceId !== undefined || (effective.mode === 'free' && effective.magnet !== true)) return effective;
  const primary = chart.series?.list?.().find(series => series.visible && PRICE_SERIES.includes(series.type) &&
    series.paneId === binding.paneId && (binding.scaleId === undefined || series.priceScaleId === binding.scaleId));
  return primary ? { ...effective, sourceId: primary.id } : effective;
}

// The cursor position under the effective snap, in container pixels: the nearest bar and its nearest price candidate.
// `null` when nothing snaps (free mode, or the pointer is outside the pane's plot). The crosshair is drawn there,
// whether or not a drawing tool is armed, and anchors placed at the pointer resolve to the same spot. Throws like
// `drawingAnchor` when the pane cannot resolve a bar.
export function snapCursor(chart, binding, point, snap = {}, mods = {}, locale) {
  const effective = effectiveSnap(chart, binding, snap, mods);
  if (effective.mode === 'free' && effective.magnet !== true) return null;
  const rect = chart.surface.getVisibleRect(binding);
  if (!rect || point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height) return null;
  const anchor = drawingAnchor(chart, point, binding, { x: true, price: true }, effective, () => {}, locale);
  const x = chart.surface.anchorToX(anchor, { paneId: binding.paneId });
  const y = chart.surface.priceToY(anchor.price, binding);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function drawingAnchor(chart, point, binding, spec, snap = {}, announce = () => {}, locale) {
  const surface = chart.surface;
  const store = chart.drawings;
  // The anchor lives on the x axis of its own pane: a derived pane resolves
  // element ids on its independent scale.
  const xBinding = { paneId: binding.paneId };
  let horizontal = null;
  if (spec.x) {
    const logical = surface.xToLogical(point.x, xBinding);
    if (!Number.isFinite(logical)) throw new Error(translate(locale, 'drawing.coordinateUnavailable'));
    const threshold = snap.magnetThreshold === undefined ? undefined : Math.abs(surface.xToLogical(point.x + snap.magnetThreshold, xBinding) - logical);
    horizontal = store.snapX(logical, { magnet: snap.magnet === true, threshold, paneId: binding.paneId });
    if (!horizontal) throw new Error(translate(locale, 'drawing.needsElement'));
  }
  let price;
  if (spec.price) {
    price = surface.yToPrice(point.y, binding);
    if (!Number.isFinite(price)) throw new Error(translate(locale, 'drawing.priceUnavailable'));
    // Source series values are indexed by source bars; a derived element has none to snap to.
    const sourceAxis = chart._paneXContext(binding.paneId).kind !== 'derived';
    const candidateAnchor = sourceAxis ? horizontal || (snap.sourceId ? surface.xToAnchor(point.x, xBinding) : null) : null;
    const candidates = candidateAnchor && snap.sourceId
      ? chart.getSeriesValues(candidateAnchor.anchorBarId).filter(entry => entry.seriesId === snap.sourceId && entry.values).map(entry => entry.values)
      : [];
    const result = store.snapPrice(price, { ...binding, mode: snap.mode || 'free', threshold: snap.threshold ?? 5,
      rounding: snap.rounding === true, ...(snap.step === undefined ? {} : { step: snap.step }), candidates });
    price = result.price;
    if (result.reason) announce(translate(locale, 'drawing.snapUnavailable', { reason: result.reason }));
  }
  return { ...(horizontal || {}), ...(spec.price ? { price } : {}) };
}

export function createDrawingTool(chart, id, { binding, props = {}, getSnap = () => ({}), getStyle = () => ({}), announce = () => {}, complete = () => {}, locale } = {}) {
  // Resolved per message: `locale` may be a function that tracks the chart locale.
  const t = (key, params) => translate(resolveLocale(locale), key, params);
  const type = id;
  const spec = DRAWING_TOOLS[type];
  if (!spec || !chart.surface || !chart.drawings) throw new Error(t('drawing.toolUnavailable'));
  props = normalizeProps(type, props);
  const doc = chart.container.ownerDocument;
  const preview = doc.createElement('canvas');
  preview.setAttribute('aria-hidden', 'true');
  preview.setAttribute('class', 'chart-drawing-construction-preview');
  Object.assign(preview.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
  let anchors = [];
  let points = [];
  let down = null;
  let cursor = null;
  let lastPreviewError = null;
  // The host's default style applies only to the properties this drawing's family has (a text note has no width);
  // the preview and the committed drawing read it the same way.
  function styleOption() {
    const style = Object.fromEntries(Object.entries(getStyle()).filter(([key]) => STYLE_FAMILIES[spec.family].includes(key)));
    return Object.keys(style).length > 0 ? { style } : {};
  }
  function show(point, mods = {}) {
    const shift = mods.shiftKey === true;
    const snap = effectiveSnap(chart, binding, getSnap(), mods);
    if (!preview.parentNode) chart.container.appendChild(preview);
    const ctx = preview.getContext('2d');
    if (!ctx) throw new Error(t('drawing.previewUnavailable'));
    const bounds = chart.container.getBoundingClientRect();
    const dpr = doc.defaultView?.devicePixelRatio || 1;
    const width = Math.round(bounds.width * dpr);
    const height = Math.round(bounds.height * dpr);
    if (preview.width !== width) preview.width = width;
    if (preview.height !== height) preview.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    if (!point) return;
    try {
      const pending = [...anchors];
      if (!pending.length && down && spec.anchors.count > 1) {
        pending.push(drawingAnchor(chart, down, binding, spec.anchors, snap, () => {}, resolveLocale(locale)));
      }
      if (!spec.anchors.count || pending.length < spec.anchors.count) {
        const next = drawingAnchor(chart, point, binding, spec.anchors, snap, () => {}, resolveLocale(locale));
        if (shift && SHIFT_HORIZONTAL_TYPES.includes(type) && pending.length === 1) next.price = pending[0].price;
        pending.push(next);
      }
      const required = spec.anchors.count ?? spec.anchors.min;
      while (pending.length < required) pending.push(pending[pending.length - 1]);
      const layout = chart.drawings.previewLayout({ type, ...binding, anchors: pending, props, ...styleOption() });
      if (!layout.resolved) throw new Error(layout.error?.message || layout.reason || t('drawing.geometryUnavailable'));
      drawLayout(ctx, layout, chart.surface.getVisibleRect(binding), true);
      lastPreviewError = null;
    } catch (error) {
      if (lastPreviewError !== error.message) announce(t('drawing.previewError', { message: error.message }));
      lastPreviewError = error.message;
    }
  }
  function clear() {
    anchors = []; points = []; down = null; lastPreviewError = null;
    const ctx = preview.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, preview.width, preview.height);
  }
  function finish() {
    if (anchors.length < (spec.anchors.min ?? spec.anchors.count)) throw new Error(t('drawing.minAnchors', { count: spec.anchors.min ?? spec.anchors.count }));
    chart.drawings.add({ type, ...binding, anchors, props, ...styleOption() });
    clear(); announce(t('drawing.added'));
    if (!chart.drawings.getRepeatMode()) { preview.remove(); complete(); }
  }
  function add(point, mods = {}) {
    const shift = mods.shiftKey === true;
    const anchor = drawingAnchor(chart, point, binding, spec.anchors, effectiveSnap(chart, binding, getSnap(), mods), announce, resolveLocale(locale));
    if (shift && SHIFT_HORIZONTAL_TYPES.includes(type) && anchors.length === 1) anchor.price = anchors[0].price;
    anchors.push(anchor); points.push({ ...point });
    if (spec.anchors.count && anchors.length === spec.anchors.count) {
      try { finish(); } catch (error) { anchors.pop(); points.pop(); throw error; }
    }
    else { show(point); announce(`${t('drawing.anchorAdded', { count: anchors.length })}${spec.anchors.min ? t('drawing.finishHint') : ''}`); }
  }
  return {
    id, active: true,
    finish,
    get pending() { return anchors.length > 0 || down !== null; },
    begin(point) {
      const rect = chart.surface.getVisibleRect(binding);
      if (!rect || point.x < rect.x || point.x > rect.x + rect.width || point.y < rect.y || point.y > rect.y + rect.height) return false;
      down = point; cursor = point; show(point); return true;
    },
    move(point, mods = {}) {
      cursor = point;
      if (down && (type === 'brush' || type === 'marker')) {
        if (!anchors.length) add(down, mods);
        const last = points[points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 1) add(point, mods);
      }
      show(point, mods);
    },
    end(point, mods = {}) {
      if (!down) return;
      const start = down; down = null;
      if (type === 'brush' || type === 'marker') {
        if (!anchors.length) add(start, mods);
        if (Math.hypot(point.x - points[points.length - 1].x, point.y - points[points.length - 1].y) >= 1) add(point, mods);
        finish(); return;
      }
      if (!anchors.length && spec.anchors.count > 1 && Math.hypot(point.x-start.x, point.y-start.y) >= 4) add(start, mods);
      add(point, mods);
    },
    handleKey(event) {
      const rect = chart.surface.getVisibleRect(binding);
      if (!rect) throw new Error(t('drawing.areaUnavailable'));
      if (!cursor) cursor = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') cursor.x -= step;
      else if (event.key === 'ArrowRight') cursor.x += step;
      else if (event.key === 'ArrowUp') cursor.y -= step;
      else if (event.key === 'ArrowDown') cursor.y += step;
      else if (event.key === 'Enter' || event.key === ' ') { add(cursor); return true; }
      else if ((event.key === 'f' || event.key === 'F') && spec.anchors.min) { finish(); return true; }
      else return false;
      cursor.x = Math.max(rect.x, Math.min(rect.x + rect.width, cursor.x));
      cursor.y = Math.max(rect.y, Math.min(rect.y + rect.height, cursor.y));
      show(cursor); return true;
    },
    cancel(reason) { clear(); if (reason === 'tool-changed' || reason === 'destroy') preview.remove(); },
  };
}
