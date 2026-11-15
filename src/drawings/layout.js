import { DRAWING_TOOLS } from './tools.js';
import { layoutText } from './text-layout.js';
import { DrawingError, equal, isNumber, normalizeZero } from './values.js';
import { anchorTime, computeRegression, computeVwap, measureAnchors } from './analytics.js';
import { buildStatsBadge } from './axis-stats.js';

// Font-specific widths persist across frames; bound memory and discard stale metrics on font changes.
const labelWidthCaches = new WeakMap();
const fontSetGenerations = new WeakMap();
function fontGeneration(context) {
  const fonts = context.canvas?.ownerDocument?.fonts ?? globalThis.document?.fonts;
  if (!fonts || typeof fonts.addEventListener !== 'function') return 0;
  let state = fontSetGenerations.get(fonts);
  if (!state) {
    state = { generation: 0 };
    fonts.addEventListener('loadingdone', () => { state.generation++; });
    fontSetGenerations.set(fonts, state);
  }
  return state.generation;
}
function measuredLabelWidth(context, text) {
  let cache = labelWidthCaches.get(context);
  const font = [context.font, context.direction, context.fontKerning, context.fontStretch, context.fontVariantCaps, context.letterSpacing, context.wordSpacing, context.textRendering].join('\0');
  const generation = fontGeneration(context);
  if (!cache || cache.font !== font || cache.generation !== generation) {
    cache = { font, generation, widths: new Map() };
    labelWidthCaches.set(context, cache);
  }
  if (!cache.widths.has(text)) {
    if (cache.widths.size >= 1024) cache.widths.delete(cache.widths.keys().next().value);
    cache.widths.set(text, context.measureText(text).width);
  }
  return cache.widths.get(text);
}

const EPS = 1e-9;

export function resolveAnchor(anchor, adapter, binding) {
  const result = { ...anchor, logical: null, x: null, y: null, resolved: true };
  if (anchor.anchorBarId !== undefined) {
    const logical = adapter.resolveX({ anchorBarId: anchor.anchorBarId, offset: anchor.offset }, binding);
    if (isNumber(logical)) {
      result.logical = normalizeZero(logical);
      const x = adapter.logicalToX(result.logical, binding);
      if (isNumber(x)) result.x = normalizeZero(x);
    }
    if (result.x === null) result.resolved = false;
  }
  if (anchor.price !== undefined) {
    const y = adapter.priceToY(anchor.price, binding);
    if (isNumber(y)) result.y = normalizeZero(y);
    else result.resolved = false;
  }
  return result;
}

function storedAnchor(anchor) {
  const result = {};
  for (const key of ['anchorBarId', 'offset', 'price']) {
    if (anchor[key] !== undefined) result[key] = anchor[key];
  }
  return result;
}

function samePoint(a, b) {
  if (!a || !b) return false;
  if (a.resolved && b.resolved) return Math.hypot(a.x - b.x, a.y - b.y) <= 1e-7;
  return equal(storedAnchor(a), storedAnchor(b));
}

export function validateDrawingGeometry(drawing, adapter) {
  const binding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
  const anchors = drawing.anchors.map(anchor => resolveAnchor(anchor, adapter, binding));
  const [a, b, c] = anchors;
  const type = drawing.type;
  switch (type) {
    case 'segment':
      // A zero-length segment stays valid unless it is extended: extension needs a direction to run along.
      if ((drawing.props.extend.left || drawing.props.extend.right) && samePoint(a, b)) {
        throwGeometry('degenerate-direction', 'An extended segment requires a direction');
      }
      break;
    case 'ray':
    case 'line':
    case 'parallelChannel':
      if (samePoint(a, b)) throwGeometry('degenerate-direction', `${type} anchors must define a direction`);
      break;
    case 'arrow':
      if ((drawing.props.extend.left || drawing.props.extend.right) && samePoint(a, b)) {
        throwGeometry('degenerate-direction', 'An extended arrow requires a direction');
      }
      if (samePoint(a, b)) throwGeometry('degenerate-arrow', 'Arrow endpoints must not coincide');
      break;
    case 'angle':
      if ((drawing.props.extend.left && samePoint(a, b)) || (drawing.props.extend.right && samePoint(c, b))) {
        throwGeometry('degenerate-direction', 'An extended angle ray requires a direction');
      }
      if (samePoint(a, b) || samePoint(c, b)) throwGeometry('degenerate-angle', 'Angle vertex must not coincide with a ray endpoint');
      break;
    case 'triangle': {
      if (anchors.every(anchor => anchor.resolved)) {
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const acx = c.x - a.x;
        const acy = c.y - a.y;
        const cross = Math.abs(abx * acy - aby * acx);
        const scale = Math.max(1, Math.hypot(abx, aby) * Math.hypot(acx, acy));
        if (cross <= 1e-9 * scale) throwGeometry('degenerate-triangle', 'Triangle vertices must not be collinear');
      }
      break;
    }
    case 'fibFan':
      if (a.logical !== null && b.logical !== null && a.logical === b.logical) {
        throwGeometry('degenerate-fan', 'Fibonacci fan anchors must have different x coordinates');
      }
      break;
    case 'fibTimeZones':
      if (a.logical !== null && b.logical !== null && a.logical === b.logical) {
        throwGeometry('degenerate-time-zones', 'Fibonacci time-zone anchors must have different x coordinates');
      }
      break;
    case 'fibArcs':
      if (a.resolved && b.resolved && Math.hypot(b.x - a.x, b.y - a.y) <= 1e-7) {
        throwGeometry('degenerate-arcs', 'Fibonacci arc anchors must not coincide on screen');
      }
      break;
    case 'pitchfork': {
      if (samePoint(b, c)) throwGeometry('degenerate-pitchfork', 'Pitchfork side anchors must not coincide');
      if (anchors.every(anchor => anchor.resolved)) {
        const { direction } = pitchforkFrame(anchors, drawing.props.variant);
        if (Math.hypot(direction.x, direction.y) <= EPS) {
          throwGeometry('degenerate-pitchfork', 'Pitchfork direction must not be zero');
        }
      }
      break;
    }
    default:
      break;
  }
}

function throwGeometry(code, message) {
  throw new DrawingError(code, message);
}

function pitchforkFrame(anchors, variant) {
  const [a, b, c] = anchors;
  const mid = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
  let origin;
  let direction;
  if (variant === 'standard') {
    origin = { x: a.x, y: a.y };
    direction = { x: mid.x - a.x, y: mid.y - a.y };
  } else if (variant === 'schiff') {
    origin = { x: (a.x + b.x) / 2, y: a.y };
    direction = { x: mid.x - origin.x, y: mid.y - origin.y };
  } else if (variant === 'modifiedSchiff') {
    origin = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    direction = { x: mid.x - origin.x, y: mid.y - origin.y };
  } else {
    origin = mid;
    direction = { x: mid.x - a.x, y: mid.y - a.y };
  }
  return { origin, direction, mid };
}

// Extension is a parameter interval, not a mode: the drawn piece of the a -> b line is t in
// [left ? -Infinity : 0, right ? Infinity : 1] clipped against the plot rectangle.
function clipLine(x0, y0, x1, y1, rect, extend) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = extend.left ? -Infinity : 0;
  let tmax = extend.right ? Infinity : 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x0 - rect.x, rect.x + rect.width - x0, y0 - rect.y, rect.y + rect.height - y0];
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > tmax) return null;
        if (r > tmin) tmin = r;
      } else {
        if (r < tmin) return null;
        if (r < tmax) tmax = r;
      }
    }
  }
  if (!Number.isFinite(tmin) || !Number.isFinite(tmax) || tmin > tmax) return null;
  return { x1: x0 + dx * tmin, y1: y0 + dy * tmin, x2: x0 + dx * tmax, y2: y0 + dy * tmax };
}

// The drawn piece of a two-anchor line for its `extend` prop. With neither side extended it is the exact
// a -> b piece without clipping (a finite segment far off screen keeps its bounds, as before the options);
// the primitive kind is the geometry class — segment, ray or line — by the number of extended sides.
function strokeFor(extend, a, b, rect) {
  if (!extend.left && !extend.right) {
    return { kind: 'segment', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  }
  const clipped = clipLine(a.x, a.y, b.x, b.y, rect, extend);
  return clipped ? { kind: extend.left && extend.right ? 'line' : 'ray', ...clipped } : null;
}

function arrowheadPrimitive(tip, from) {
  return { kind: 'polygon', role: 'arrowhead', points: arrowHead(tip, from), closed: true };
}

// Screen-space centre: on a logarithmic scale the visual halfway point is the readable middle, not the
// geometric mean of the prices. The marker is decorative — never a handle, never a pick target.
function midpointPrimitive(p, q) {
  return { kind: 'circle', role: 'midpoint', cx: (p.x + q.x) / 2, cy: (p.y + q.y) / 2, r: 4 };
}

// Heads sit at the ends of the drawn geometry: the anchor when that side is not extended, the clipped
// plot-edge point when it is (a head at the anchor of an extended side would point nowhere).
function decorateLine(primitives, stroke, a, b, arrows, midpoint) {
  const first = { x: stroke.x1, y: stroke.y1 };
  const last = { x: stroke.x2, y: stroke.y2 };
  if (arrows.start) primitives.push(arrowheadPrimitive(first, last));
  if (arrows.end) primitives.push(arrowheadPrimitive(last, first));
  if (midpoint) primitives.push(midpointPrimitive(a, b));
}

function shapePoints(points) {
  return points.map(point => ({ x: point.x, y: point.y }));
}

function polygon(role, points) {
  return { kind: 'polygon', role, points: shapePoints(points), fillable: true };
}

function lineBetween(role, x1, y1, x2, y2) {
  return { kind: 'segment', role, x1, y1, x2, y2 };
}

function horizontalSpan(a, b) {
  return { x1: Math.min(a.x, b.x), x2: Math.max(a.x, b.x) };
}

function formatPriceLabel(adapter, price, binding) {
  if (typeof adapter.formatPrice === 'function') {
    const text = adapter.formatPrice(price, binding);
    if (typeof text === 'string') return text;
  }
  return String(Number(price.toPrecision(12)));
}



function fibText(level, props, adapter, binding, price) {
  const base = level.label !== undefined ? level.label : props.showPercent
    ? `${Number((level.coefficient * 100).toPrecision(12))}%` : String(level.coefficient);
  return props.showPrices && price !== undefined ? `${base} (${formatPriceLabel(adapter, price, binding)})` : base;
}

function fibStyle(level, drawing, fill = false) {
  return { color: level.color ?? drawing.style.color,
    opacity: drawing.style.opacity * level.opacity * (fill ? drawing.props.fillOpacity : 1) };
}

function fibPrice(a, b, base, coefficient, mode) {
  if (mode === 'log') {
    if (a <= 0 || b <= 0 || base <= 0) return null;
    const price = Math.exp(Math.log(base) + coefficient * (Math.log(b) - Math.log(a)));
    return Number.isFinite(price) && price > 0 ? price : null;
  }
  const price = base + coefficient * (b - a);
  return Number.isFinite(price) ? price : null;
}

function fibLabel(level, drawing, adapter, binding, price, x, y, align = 'left') {
  return { x, y, align, text: fibText(level, drawing.props, adapter, binding, price),
    coefficient: level.coefficient, ...fibStyle(level, drawing) };
}

function positionLineLabel(label, position, span, rect) {
  const left = rect.x, right = rect.x + rect.width;
  const width = label.width;
  if (position === 'center') {
    label.align = 'center';
    label.x = width <= rect.width
      ? Math.max(left + width / 2, Math.min(right - width / 2, (span.x1 + span.x2) / 2))
      : (left + right) / 2;
  } else if (position === 'start') {
    if (span.x1 - 4 - width >= left) {
      label.align = 'right';
      label.x = span.x1 - 4;
    } else {
      label.align = 'left';
      label.x = Math.max(left, Math.min(span.x1 + 4, right - width));
    }
  } else if (span.x2 + 4 + width <= right) {
    label.align = 'left';
    label.x = span.x2 + 4;
  } else {
    label.align = 'right';
    label.x = Math.min(right, Math.max(span.x2 - 4, left + width));
  }
}

function lineLabel(level, drawing, adapter, binding, price, span, y) {
  const position = drawing.props.labelPosition;
  const x = position === 'center' ? (span.x1 + span.x2) / 2 : position === 'start' ? span.x1 : span.x2;
  return fibLabel(level, drawing, adapter, binding, price, x, y - 2, position === 'center' ? 'center' : 'left');
}
// Pick the requested point when it is visible; otherwise use the nearest visible arc/rectangle
// intersection. This keeps a clipped arc's label on the visible portion rather than outside the pane.
function visibleArcPoint(center, radius, angle, startAngle, full, rect) {
  const tau = Math.PI * 2;
  const normalize = value => ((value % tau) + tau) % tau;
  const candidates = [angle, startAngle, startAngle + Math.PI];
  for (const x of [rect.x, rect.x + rect.width]) {
    const ratio = (x - center.x) / radius;
    if (ratio >= -1 && ratio <= 1) {
      const a = Math.acos(ratio);
      candidates.push(a, -a);
    }
  }
  for (const y of [rect.y, rect.y + rect.height]) {
    const ratio = (y - center.y) / radius;
    if (ratio >= -1 && ratio <= 1) {
      const a = Math.asin(ratio);
      candidates.push(a, Math.PI - a);
    }
  }
  let best = null, bestDistance = Infinity;
  for (const candidate of candidates) {
    if (!full && normalize(candidate - startAngle) > Math.PI + EPS) continue;
    const x = center.x + radius * Math.cos(candidate);
    const y = center.y + radius * Math.sin(candidate);
    if (x < rect.x - EPS || x > rect.x + rect.width + EPS ||
        y < rect.y - EPS || y > rect.y + rect.height + EPS) continue;
    const delta = normalize(candidate - angle);
    const distance = Math.min(delta, tau - delta);
    if (distance < bestDistance) {
      best = { x, y };
      bestDistance = distance;
    }
  }
  return best;
}


function fibZone(points, level, drawing) {
  return { kind: 'zone', points, stroke: false, ...fibStyle(level, drawing, true) };
}

function fibLines({ a, b, c, drawing, adapter, binding, rect }) {
  const first = drawing.props.reverse ? b : a;
  const second = drawing.props.reverse ? a : b;
  const mode = adapter.getPriceScaleMode(binding);
  const span = horizontalSpan(a, c ?? b);
  if (span.x1 === span.x2 && span.x1 <= rect.x + rect.width) {
    span.x2 = rect.x + rect.width;
  }
  if (drawing.props.extend.left) span.x1 = Math.min(span.x1, rect.x);
  if (drawing.props.extend.right) span.x2 = Math.max(span.x2, rect.x + rect.width);
  if ((drawing.props.extend.left || drawing.props.extend.right) && span.x1 <= rect.x + rect.width && span.x2 >= rect.x) {
    span.x1 = Math.max(span.x1, rect.x);
    span.x2 = Math.min(span.x2, rect.x + rect.width);
  }
  const visibleSpan = span.x1 <= rect.x + rect.width && span.x2 >= rect.x
    ? { x1: Math.max(span.x1, rect.x), x2: Math.min(span.x2, rect.x + rect.width) }
    : null;
  const levels = [];
  for (const level of drawing.props.levels) {
    if (!level.visible) continue;
    const price = fibPrice(first.price, second.price, (c ?? first).price, level.coefficient, mode);
    if (price === null) continue;
    const y = adapter.priceToY(price, binding);
    if (!isNumber(y)) continue;
    levels.push({ level, price, y });
  }
  const primitives = [], labels = [];
  if (drawing.props.fill) {
    const sorted = [...levels].sort((x, y) => x.level.coefficient - y.level.coefficient);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1], next = sorted[i];
      primitives.push(fibZone([{ x: span.x1, y: prev.y }, { x: span.x2, y: prev.y },
        { x: span.x2, y: next.y }, { x: span.x1, y: next.y }], next.level, drawing));
    }
  }
  for (const { level, price, y } of levels) {
    primitives.push({ kind: 'segment', role: c ? 'fib-extension-level' : 'fib-level', coefficient: level.coefficient,
      price, x1: span.x1, y1: y, x2: span.x2, y2: y, ...fibStyle(level, drawing) });
    if (visibleSpan && y - 14 <= rect.y + rect.height && y + 2 >= rect.y) {
      labels.push(lineLabel(level, drawing, adapter, binding, price, visibleSpan, y));
    }
  }
  return { primitives, labels, fibLabelSpan: visibleSpan };
}

function arrowHead(tip, from) {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const size = 10;
  const px = -uy;
  const py = ux;
  return [
    { x: tip.x, y: tip.y },
    { x: tip.x - ux * size + px * size * 0.5, y: tip.y - uy * size + py * size * 0.5 },
    { x: tip.x - ux * size - px * size * 0.5, y: tip.y - uy * size - py * size * 0.5 },
  ];
}

function arcPrimitive(center, radius, startAngle, endAngle) {
  return { kind: 'arc', cx: center.x, cy: center.y, r: radius, startAngle, endAngle };
}

// The four two-point tools share one geometry: only the default of props.extend (and of arrows) tells
// them apart, so a segment can run to infinity and a line can stop at its anchors. The optional statistics
// badge is anchored on the anchors themselves (never on a clipped extension); with `always` false the label
// is flagged `selectedOnly` and any renderer skips it while the drawing is not selected.
function lineFamily({ a, b, drawing, rect, adapter, binding }) {
  const stroke = strokeFor(drawing.props.extend, a, b, rect);
  if (!stroke) return { primitives: [] };
  const primitives = [{ kind: stroke.kind, x1: stroke.x1, y1: stroke.y1, x2: stroke.x2, y2: stroke.y2 }];
  decorateLine(primitives, stroke, a, b, drawing.props.arrows, drawing.props.midpoint);
  const stats = drawing.props.stats;
  let labels;
  if (stats.priceRange || stats.percent || stats.bars || stats.time) {
    const measure = measureAnchors([a, b], adapter, binding);
    const tone = measure.priceDelta >= 0 ? 'up' : 'down';
    const anchorPoint = stats.position === 'start' ? a
      : stats.position === 'end' ? b
        : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const label = buildStatsBadge({ measure, anchorPoint, tone, fields: stats, adapter, binding });
    if (label) {
      if (stats.always !== true) label.selectedOnly = true;
      labels = [label];
    }
  }
  return labels ? { primitives, labels } : { primitives };
}

// Grows one end of a VWAP piece along the direction of its edge segment, up to the plot edge; the appended
// point makes the extension part of the same polyline, so rendering, picking and bounds follow it.
function continueVwapSegment(points, side, rect) {
  if (!points || points.length < 2) return;
  const tip = side === 'right' ? points[points.length - 1] : points[0];
  const before = side === 'right' ? points[points.length - 2] : points[1];
  const grown = clipLine(tip.x, tip.y, tip.x + (tip.x - before.x), tip.y + (tip.y - before.y), rect, { left: false, right: true });
  if (!grown) return;
  const end = { x: grown.x2, y: grown.y2 };
  if (side === 'right') points.push(end); else points.unshift(end);
}

const BUILDERS = {
  // The four two-point tools share one geometry: only the default of props.extend (and of arrows) tells
  // them apart, so a segment can run to infinity and a line can stop at its anchors.
  segment: lineFamily,
  ray: lineFamily,
  line: lineFamily,
  arrow: lineFamily,
  horizontalLevel({ a, rect }) {
    return {
      primitives: [{ kind: 'line', x1: rect.x, y1: a.y, x2: rect.x + rect.width, y2: a.y }],
      handles: [{ x: rect.x + rect.width, y: a.y, anchorIndex: 0 }],
    };
  },
  horizontalRay({ a, rect }) {
    const right = rect.x + rect.width;
    const x1 = Math.max(a.x, rect.x);
    if (x1 >= right) return { primitives: [] };
    return { primitives: [{ kind: 'ray', x1, y1: a.y, x2: right, y2: a.y }] };
  },
  verticalLine({ a, rect }) {
    return {
      primitives: [{ kind: 'line', x1: a.x, y1: rect.y, x2: a.x, y2: rect.y + rect.height }],
      handles: [{ x: a.x, y: rect.y + rect.height, anchorIndex: 0 }],
    };
  },
  parallelChannel({ a, b, c, drawing, rect }) {
    const extend = drawing.props.extend;
    const base = strokeFor(extend, a, b, rect);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const second = a.x === b.x && a.y === b.y ? null : strokeFor(extend, c, { x: c.x + dx, y: c.y + dy }, rect);
    const primitives = [];
    // The fill is the quad between the two drawn lines; it is fill-only so the channel keeps its two-line outline.
    if (base && second) primitives.push({ ...polygon('channel-fill', [
      { x: base.x1, y: base.y1 },
      { x: base.x2, y: base.y2 },
      { x: second.x2, y: second.y2 },
      { x: second.x1, y: second.y1 },
    ]), stroke: false });
    if (base) primitives.push({ kind: base.kind, role: 'channel-base', x1: base.x1, y1: base.y1, x2: base.x2, y2: base.y2 });
    if (second) primitives.push({ kind: second.kind, role: 'channel-parallel', x1: second.x1, y1: second.y1, x2: second.x2, y2: second.y2 });
    if (a.resolved && b.resolved) primitives.push({ kind: 'segment', role: 'channel-anchor-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    return { primitives };
  },
  rectangle({ a, b, drawing, rect }) {
    // Extension is horizontal only, in screen sides (the box has no anchor order after normalization);
    // vertices and handles stay at the anchors, the polygon's x range runs to the plot edge.
    const extend = drawing.props.extend;
    const x1 = extend.left ? rect.x : Math.min(a.x, b.x);
    const x2 = extend.right ? rect.x + rect.width : Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return {
      primitives: [polygon('rectangle', [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }])],
    };
  },
  ellipse({ a, b }) {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    return { primitives: [{ kind: 'ellipse', cx, cy, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2, fillable: true }] };
  },
  fibRetracement: fibLines,
  text({ a, drawing }) {
    return { primitives: [{ kind: 'text', x: a.x, y: a.y, text: drawing.props.text }] };
  },
  // A shaded box between the two anchors with a horizontal (time) and a vertical (price) arrow through it, and a
  // badge with the price change, its percentage, the bar count and the elapsed time. The tone (rise or fall) is
  // carried on the geometry and coloured by the renderer.
  measure({ a, b, drawing, adapter, binding }) {
    const measure = measureAnchors([a, b], adapter, binding);
    const tone = measure.priceDelta >= 0 ? 'up' : 'down';
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const horizontalTip = { x: b.x, y: midY };
    const verticalTip = { x: midX, y: b.y };
    const primitives = [
      { kind: 'polygon', role: 'measure-area', tone, points: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }] },
      { kind: 'segment', role: 'measure', tone, x1: a.x, y1: midY, x2: b.x, y2: midY },
      { kind: 'polygon', role: 'arrowhead', tone, fillTone: true, points: arrowHead(horizontalTip, { x: a.x, y: midY }) },
      { kind: 'segment', role: 'measure', tone, x1: midX, y1: a.y, x2: midX, y2: b.y },
      { kind: 'polygon', role: 'arrowhead', tone, fillTone: true, points: arrowHead(verticalTip, { x: midX, y: a.y }) },
    ];
    // The badge is the shared statistics badge with measure's own props.stats defaults (every figure on);
    // its anchor sits at the horizontal midpoint, 8px above the measured box for a rise and below for a fall.
    const label = buildStatsBadge({
      measure,
      anchorPoint: { x: midX, y: tone === 'up' ? top - 8 : bottom + 8 },
      tone,
      fields: drawing.props.stats,
      adapter,
      binding,
    });
    return { primitives, labels: label ? [label] : [], measure };
  },
  angle({ a, b, c, drawing, rect }) {
    const u = { x: a.x - b.x, y: a.y - b.y };
    const v = { x: c.x - b.x, y: c.y - b.y };
    const dot = u.x * v.x + u.y * v.y;
    const lengths = Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
    const angleDegrees = (Math.acos(Math.min(1, Math.max(-1, dot / (lengths || 1)))) * 180) / Math.PI;
    const radius = Math.max(6, Math.min(Math.hypot(u.x, u.y), Math.hypot(v.x, v.y)) * 0.25);
    const startAngle = Math.atan2(u.y, u.x);
    let endAngle = Math.atan2(v.y, v.x);
    let sweep = endAngle - startAngle;
    while (sweep > Math.PI) sweep -= Math.PI * 2;
    while (sweep < -Math.PI) sweep += Math.PI * 2;
    endAngle = startAngle + sweep;
    // The options act on the two rays: `left` extends vertex -> first anchor beyond it, `right` vertex -> third
    // anchor; heads mark the far ends and the midpoint sits between the vertex and each outer anchor.
    const extend = drawing.props.extend;
    const rays = [
      [strokeFor({ left: false, right: extend.left }, b, a, rect), a, drawing.props.arrows.start],
      [strokeFor({ left: false, right: extend.right }, b, c, rect), c, drawing.props.arrows.end],
    ];
    const primitives = [];
    for (const [stroke, outer, head] of rays) {
      if (!stroke) continue;
      primitives.push({ kind: stroke.kind, role: 'angle-ray', x1: stroke.x1, y1: stroke.y1, x2: stroke.x2, y2: stroke.y2 });
      if (head) primitives.push(arrowheadPrimitive({ x: stroke.x2, y: stroke.y2 }, { x: stroke.x1, y: stroke.y1 }));
      if (drawing.props.midpoint) primitives.push(midpointPrimitive(b, outer));
    }
    primitives.push(arcPrimitive(b, radius, startAngle, endAngle));
    return { primitives, angleDegrees };
  },
  triangle({ a, b, c }) {
    return { primitives: [polygon('triangle', [a, b, c])] };
  },
  polyline({ anchors }) {
    return { primitives: [{ kind: 'polyline', points: shapePoints(anchors), fillable: true }] };
  },
  bezier({ anchors }) {
    const [p0, p1, p2, p3] = anchors.map(anchor => ({ x: anchor.x, y: anchor.y }));
    const points = [];
    for (let step = 0; step <= 32; step += 1) {
      const t = step / 32;
      const mt = 1 - t;
      points.push({
        x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
        y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
      });
    }
    return { primitives: [{ kind: 'bezier', p0, p1, p2, p3, points, fillable: true }] };
  },
  brush({ anchors }) {
    return { primitives: [{ kind: 'polyline', role: 'brush', points: shapePoints(anchors), fillable: true }] };
  },
  marker({ anchors, drawing }) {
    return {
      primitives: [{
        kind: 'marker',
        points: shapePoints(anchors),
        width: drawing.style?.width ?? 12,
      }],
    };
  },
  regressionChannel({ a, b, drawing, adapter, binding }) {
    // Regression runs over source series indexes, which a derived x axis does not share.
    if (adapter.paneKind?.(binding) === 'derived') return { primitives: [], available: false, reason: 'derived-pane' };
    const series = adapter.getSeriesValues(drawing.props.seriesId);
    const regression = computeRegression({ x1: a.logical, x2: b.logical, series, k: drawing.props.k });
    if (!regression.available) return { primitives: [], regression, available: false, reason: regression.reason };
    const { a: intercept, b: slope, sigma, k, range } = regression;
    const xStart = adapter.logicalToX(range.from, binding);
    const xEnd = adapter.logicalToX(range.to, binding);
    const middleStart = intercept + slope * range.from;
    const middleEnd = intercept + slope * range.to;
    const band = k * sigma;
    const upperStart = adapter.priceToY(middleStart + band, binding);
    const upperEnd = adapter.priceToY(middleEnd + band, binding);
    const lowerStart = adapter.priceToY(middleStart - band, binding);
    const lowerEnd = adapter.priceToY(middleEnd - band, binding);
    const startY = adapter.priceToY(middleStart, binding);
    const endY = adapter.priceToY(middleEnd, binding);
    if (![xStart, xEnd, upperStart, upperEnd, lowerStart, lowerEnd, startY, endY].every(isNumber)) {
      return { primitives: [], regression, available: false, reason: 'projection-unavailable' };
    }
    return {
      primitives: [
        { kind: 'segment', role: 'regression-middle', x1: xStart, y1: startY, x2: xEnd, y2: endY },
        polygon('regression-band', [
          { x: xStart, y: upperStart },
          { x: xEnd, y: upperEnd },
          { x: xEnd, y: lowerEnd },
          { x: xStart, y: lowerStart },
        ]),
      ],
      regression,
      available: true,
    };
  },
  fibExtension: fibLines,
  fibFan({ a, b, drawing, adapter, binding, rect }) {
    const first = drawing.props.reverse ? b : a;
    const second = drawing.props.reverse ? a : b;
    const dx = second.x - first.x;
    if (dx === 0) return { primitives: [] };
    const mode = adapter.getPriceScaleMode(binding);
    const extend = drawing.props.extend;
    const minX = Math.max(rect.x, Math.min(extend.left ? (dx > 0 ? rect.x : rect.x + rect.width) : first.x,
      extend.right ? (dx > 0 ? rect.x + rect.width : rect.x) : second.x));
    const maxX = Math.min(rect.x + rect.width, Math.max(extend.left ? (dx > 0 ? rect.x : rect.x + rect.width) : first.x,
      extend.right ? (dx > 0 ? rect.x + rect.width : rect.x) : second.x));
    const levels = [], primitives = [], labels = [];
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const price = fibPrice(first.price, second.price, first.price, level.coefficient, mode);
      if (price === null) continue;
      const y = adapter.priceToY(price, binding);
      if (!isNumber(y)) continue;
      const stroke = strokeFor(extend, first, { x: second.x, y }, rect);
      levels.push({ level, price, y, stroke });
    }
    if (drawing.props.fill && minX <= maxX) {
      const sorted = [...levels].sort((x, y) => x.level.coefficient - y.level.coefficient);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], next = sorted[i];
        const at = (item, x) => first.y + (item.y - first.y) * ((x - first.x) / dx);
        const points = [{ x: minX, y: at(prev, minX) }, { x: maxX, y: at(prev, maxX) },
          { x: maxX, y: at(next, maxX) }, { x: minX, y: at(next, minX) }];
        if (points.every(point => isNumber(point.y))) primitives.push(fibZone(points, next.level, drawing));
      }
    }
    for (const { level, price, y, stroke } of levels) {
      const style = fibStyle(level, drawing);
      if (stroke) {
        primitives.push({ ...stroke, role: 'fib-fan-ray', coefficient: level.coefficient, price, ...style });
        const visible = clipLine(stroke.x1, stroke.y1, stroke.x2, stroke.y2, rect, { left: false, right: false });
        if (visible) {
          const t = drawing.props.labelPosition === 'start' ? 0.15 : drawing.props.labelPosition === 'center' ? 0.5 : 1;
          const x = visible.x1 + (visible.x2 - visible.x1) * t;
          const ly = visible.y1 + (visible.y2 - visible.y1) * t;
          const edge = x >= rect.x + rect.width - 4;
          labels.push(fibLabel(level, drawing, adapter, binding, price,
            Math.max(rect.x + 4, Math.min(rect.x + rect.width - 4, x + (edge ? -4 : 4))),
            Math.max(rect.y + 12, Math.min(rect.y + rect.height - 2, ly - 2)), edge ? 'right' : 'left'));
        }
      }
      if (drawing.props.grid) {
        const x = first.x + level.coefficient * dx;
        if (y >= Math.min(first.y, second.y) && y <= Math.max(first.y, second.y))
          primitives.push({ kind: 'segment', role: 'fib-fan-grid', x1: first.x, y1: y, x2: second.x, y2: y, ...style });
        if (isNumber(x) && x >= Math.min(first.x, second.x) && x <= Math.max(first.x, second.x))
          primitives.push({ kind: 'segment', role: 'fib-fan-grid', x1: x, y1: first.y, x2: x, y2: second.y, ...style });
      }
    }
    return { primitives, labels };
  },
  fibArcs({ a, b, drawing, adapter, binding, rect }) {
    const center = drawing.props.reverse ? b : a;
    const other = drawing.props.reverse ? a : b;
    const distance = Math.hypot(other.x - center.x, other.y - center.y);
    if (distance <= EPS || !Number.isFinite(distance)) return { primitives: [] };
    const direction = Math.atan2(other.y - center.y, other.x - center.x);
    const startAngle = direction - Math.PI / 2;
    const endAngle = direction + Math.PI / 2;
    const levels = [], primitives = [], labels = [];
    for (const level of drawing.props.levels) {
      const r = level.coefficient * distance;
      if (level.visible && Number.isFinite(r) && r > 0) levels.push({ level, r });
    }
    if (drawing.props.fill) {
      const sorted = [...levels].sort((x, y) => x.level.coefficient - y.level.coefficient);
      for (let i = 1; i < sorted.length; i++) {
        primitives.push({ kind: 'ring', cx: center.x, cy: center.y, innerRadius: sorted[i - 1].r,
          r: sorted[i].r, startAngle, endAngle, full: drawing.props.fullCircles, stroke: false,
          ...fibStyle(sorted[i].level, drawing, true) });
      }
    }
    for (const { level, r } of levels) {
      const common = { role: 'fib-arc', cx: center.x, cy: center.y, r, coefficient: level.coefficient, ...fibStyle(level, drawing) };
      primitives.push(drawing.props.fullCircles ? { kind: 'circle', ...common } : { kind: 'arc', ...common, startAngle, endAngle });
      const angle = drawing.props.fullCircles
        ? (drawing.props.labelPosition === 'start' ? -Math.PI / 2 : drawing.props.labelPosition === 'center' ? -3 * Math.PI / 8 : -Math.PI / 4)
        : (drawing.props.labelPosition === 'start' ? startAngle : drawing.props.labelPosition === 'center' ? direction : endAngle);
      const point = visibleArcPoint(center, r, angle, startAngle, drawing.props.fullCircles, rect);
      if (point) {
        const right = point.x > rect.x + rect.width / 2;
        const x = Math.max(rect.x + 4, Math.min(rect.x + rect.width - 4, point.x + (right ? -2 : 2)));
        const y = Math.max(rect.y + 12, Math.min(rect.y + rect.height - 2, point.y - 2));
        labels.push(fibLabel(level, drawing, adapter, binding, undefined, x, y, right ? 'right' : 'left'));
      }
    }
    return { primitives, labels };
  },
  fibTimeZones({ a, b, drawing, adapter, rect, binding }) {
    const first = drawing.props.reverse ? b : a, second = drawing.props.reverse ? a : b;
    const levels = [], primitives = [], labels = [];
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const logical = first.logical + level.coefficient * (second.logical - first.logical);
      if (!Number.isFinite(logical)) continue;
      const x = adapter.logicalToX(logical, binding);
      if (isNumber(x)) levels.push({ level, logical, x });
    }
    if (drawing.props.fill) {
      const sorted = [...levels].sort((x, y) => x.level.coefficient - y.level.coefficient);
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1], next = sorted[i];
        primitives.push(fibZone([{ x: prev.x, y: rect.y }, { x: next.x, y: rect.y },
          { x: next.x, y: rect.y + rect.height }, { x: prev.x, y: rect.y + rect.height }], next.level, drawing));
      }
    }
    for (const { level, logical, x } of levels) {
      primitives.push({ kind: 'line', role: 'time-zone', coefficient: level.coefficient, logical,
        x1: x, y1: rect.y, x2: x, y2: rect.y + rect.height, ...fibStyle(level, drawing) });
      if (x > rect.x + rect.width + 4) continue;
      const y = drawing.props.labelPosition === 'start' ? rect.y + 12 :
        drawing.props.labelPosition === 'center' ? rect.y + rect.height / 2 : rect.y + rect.height - 2;
      const edge = Math.abs(x - rect.x - rect.width) <= 4;
      labels.push(fibLabel(level, drawing, adapter, binding, undefined, edge ? rect.x + rect.width - 4 : x + 2, y, edge ? 'right' : 'left'));
    }
    return { primitives, labels };
  },
  pitchfork({ a, b, c, drawing, rect }) {
    const { origin, direction } = pitchforkFrame([a, b, c], drawing.props.variant);
    const length = Math.hypot(direction.x, direction.y);
    if (length <= EPS) return { primitives: [], available: false, reason: 'degenerate-direction' };
    // All three tines share props.extend, anchor-ordered: `right` continues each past the fork (its former
    // constant 'ray' clip, now the default), `left` backwards before the origin and the side anchors, and with
    // neither set each tine is the finite t in [0, 1] piece — the median from the origin to the side-anchor
    // midpoint and each side as long as the handle.
    const extend = drawing.props.extend;
    const primitives = [];
    const median = strokeFor(extend, origin, { x: origin.x + direction.x, y: origin.y + direction.y }, rect);
    if (median) primitives.push({ kind: median.kind, role: 'pitchfork-median', x1: median.x1, y1: median.y1, x2: median.x2, y2: median.y2 });
    for (const side of [b, c]) {
      const tine = strokeFor(extend, side, { x: side.x + direction.x, y: side.y + direction.y }, rect);
      if (tine) primitives.push({ kind: tine.kind, role: 'pitchfork-side', x1: tine.x1, y1: tine.y1, x2: tine.x2, y2: tine.y2 });
    }
    return { primitives, origin, direction, variant: drawing.props.variant };
  },
  priceLabel({ a, adapter, binding }) {
    return { primitives: [{ kind: 'text', x: a.x, y: a.y, text: formatPriceLabel(adapter, a.price, binding) }] };
  },
  callout({ a, b, drawing }) {
    return {
      primitives: [
        lineBetween('callout-leader', a.x, a.y, b.x, b.y),
        { kind: 'text', x: b.x, y: b.y, text: drawing.props.text },
      ],
    };
  },
  flag({ a, drawing }) {
    const position = { x: a.x + 8, y: a.y - 8 };
    return {
      primitives: [
        lineBetween('flag-pole', a.x, a.y, position.x, position.y),
        { kind: 'text', x: position.x + 4, y: position.y, text: drawing.props.text },
      ],
    };
  },
  anchoredVwap({ a, drawing, adapter, binding, rect }) {
    if (adapter.paneKind?.(binding) === 'derived') return { primitives: [], available: false, reason: 'derived-pane' };
    const priceSeries = adapter.getSeriesValues(drawing.props.priceSeriesId);
    const volumeSeries = adapter.getSeriesValues(drawing.props.volumeSeriesId);
    const vwap = computeVwap({ anchorX: a.logical, priceSeries, volumeSeries, count: adapter.getIndexCount(binding) });
    if (vwap.error) return { primitives: [], vwap, available: false, error: vwap.error };
    if (!vwap.available) return { primitives: [], vwap, available: false, waiting: Boolean(vwap.waiting), reason: vwap.reason };
    const segments = [];
    let current = [];
    for (const point of vwap.points) {
      if (point.value === undefined) {
        if (current.length) segments.push(current);
        current = [];
        continue;
      }
      const x = adapter.logicalToX(point.index, binding);
      const y = adapter.priceToY(point.value, { paneId: drawing.paneId, scaleId: drawing.scaleId });
      if (!isNumber(x) || !isNumber(y)) continue;
      current.push({ x, y, index: point.index, value: point.value });
    }
    if (current.length) segments.push(current);
    // The polyline itself always follows the data; an extension continues its first or last visible segment
    // straight to the plot edge instead of clipping the data away from the anchors.
    const extend = drawing.props.extend;
    if (extend.left) continueVwapSegment(segments[0], 'left', rect);
    if (extend.right) continueVwapSegment(segments[segments.length - 1], 'right', rect);
    return {
      primitives: segments.map(points => ({ kind: 'polyline', role: 'vwap', points })),
      vwap,
      available: true,
    };
  },
};

function captionFor(drawing, primitives, rect) {
  const style = drawing.props.label;
  if (!style) return null;
  let x, y, placement;
  const t = style.align === 'start' ? 0 : style.align === 'end' ? 1 : 0.5;
  if (drawing.type === 'rectangle' || drawing.type === 'triangle' || drawing.type === 'ellipse') {
    const shape = primitives[0];
    if (!shape) return null;
    let left, right, top, bottom;
    if (shape.kind === 'ellipse') {
      left = shape.cx - shape.rx; right = shape.cx + shape.rx;
      top = shape.cy - shape.ry; bottom = shape.cy + shape.ry;
      const nearestX = Math.max(rect.x, Math.min(rect.x + rect.width, shape.cx));
      const nearestY = Math.max(rect.y, Math.min(rect.y + rect.height, shape.cy));
      if (((nearestX - shape.cx) / (shape.rx || 1)) ** 2 + ((nearestY - shape.cy) / (shape.ry || 1)) ** 2 > 1) return null;
    } else {
      // Clip the actual polygon, not just its bounding box, so an offscreen triangle has no caption.
      let points = shape.points;
      for (const [axis, edge, sign] of [['x', rect.x, 1], ['x', rect.x + rect.width, -1], ['y', rect.y, 1], ['y', rect.y + rect.height, -1]]) {
        const clipped = [];
        for (let i = 0; i < points.length; i += 1) {
          const a = points[i], b = points[(i + 1) % points.length];
          const insideA = (a[axis] - edge) * sign >= 0, insideB = (b[axis] - edge) * sign >= 0;
          if (insideA) clipped.push(a);
          if (insideA !== insideB) {
            const f = (edge - a[axis]) / (b[axis] - a[axis]);
            clipped.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
          }
        }
        points = clipped;
        if (!points.length) return null;
      }
      left = Math.min(...points.map(p => p.x)); right = Math.max(...points.map(p => p.x));
      top = Math.min(...points.map(p => p.y)); bottom = Math.max(...points.map(p => p.y));
    }
    left = Math.max(left, rect.x); right = Math.min(right, rect.x + rect.width);
    top = Math.max(top, rect.y); bottom = Math.min(bottom, rect.y + rect.height);
    if (left > right || top > bottom) return null;
    x = left + (right - left) * t; y = top; placement = 'inside';
  } else {
    const stroke = drawing.type === 'parallelChannel' ? primitives.find(p => p.role === 'channel-base')
      : drawing.type === 'regressionChannel' ? primitives.find(p => p.role === 'regression-middle') : primitives[0];
    if (!stroke) return null;
    const visible = clipLine(stroke.x1, stroke.y1, stroke.x2, stroke.y2, rect, { left: false, right: false });
    if (!visible) return null;
    if (drawing.type === 'verticalLine') {
      x = visible.x1; y = Math.min(visible.y1, visible.y2) + Math.abs(visible.y2 - visible.y1) * t;
      placement = 'beside';
    } else {
      x = visible.x1 + (visible.x2 - visible.x1) * t;
      y = visible.y1 + (visible.y2 - visible.y1) * t;
      placement = 'above';
    }
  }
  return { kind: 'text', caption: true, x, y, placement, text: style.text, textStyle: style, color: style.color };
}

function materialize(type, drawing, adapter) {
  const layout = {
    id: drawing.id,
    type,
    paneId: drawing.paneId,
    scaleId: drawing.scaleId,
    resolved: true,
    anchors: [],
    handles: [],
    primitives: [],
    labels: [],
    bounds: null,
  };
  const spec = DRAWING_TOOLS[type];
  if (!spec || !BUILDERS[type]) {
    layout.resolved = false;
    layout.error = { code: 'unknown-type', type };
    return layout;
  }
  const anchorInput = Array.isArray(drawing.anchors) ? drawing.anchors : [];
  const required = spec.anchors.count;
  if (required !== undefined && anchorInput.length !== required) {
    layout.resolved = false;
    layout.incomplete = true;
    layout.reason = 'incomplete-anchors';
    return layout;
  }
  if (spec.anchors.min !== undefined && anchorInput.length < spec.anchors.min) {
    layout.resolved = false;
    layout.incomplete = true;
    layout.reason = 'incomplete-anchors';
    return layout;
  }

  const binding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
  const rect = adapter.getVisibleRect(binding);
  const anchors = anchorInput.map(anchor => resolveAnchor(anchor, adapter, binding));
  layout.anchors = anchors;
  layout.handles = anchors
    .map((anchor, index) => (anchor.x !== null && anchor.y !== null ? { x: anchor.x, y: anchor.y, anchorIndex: index } : null))
    .filter(Boolean);
  if (!anchors.every(anchor => anchor.resolved)) {
    layout.resolved = false;
    layout.reason = 'unresolved-anchor';
    return layout;
  }

  const ctx = { drawing, anchors, a: anchors[0], b: anchors[1], c: anchors[2], d: anchors[3], rect, binding, adapter };
  let result;
  try {
    result = BUILDERS[type](ctx);
  } catch (error) {
    layout.resolved = false;
    layout.error = { code: error.code ?? 'layout-error', message: error.message };
    return layout;
  }
  if (!result) return layout;
  if (result.primitives) layout.primitives = result.primitives;
  if (result.labels) layout.labels = result.labels;
  if (result.handles) layout.handles.push(...result.handles);
  const caption = captionFor(drawing, layout.primitives, rect);
  if (caption) layout.labels.push(caption);
  let textContext;
  for (const primitive of layout.primitives) {
    if (primitive.kind === 'text') {
      textContext ??= adapter.getTextContext?.();
      primitive.textStyle = drawing.props.textStyle;
      primitive.textLayout = layoutText(primitive, rect, textContext);
    }
  }
  if (caption) caption.textLayout = layoutText(caption, rect, textContext ?? adapter.getTextContext?.());
  // A conservative text estimate keeps offscreen layouts free of canvas calls.
  for (const label of layout.labels) {
    if (label.align) label.width = Math.max(4, String(label.text).length * 16);
  }
  if (result.fibLabelSpan) {
    for (const label of result.labels) positionLineLabel(label, drawing.props.labelPosition, result.fibLabelSpan, rect);
  }
  const estimated = computeBounds(layout.primitives, layout.labels, layout.handles);
  const ambiguousTimeLabel = drawing.type === 'fibTimeZones' && layout.labels.some(label => label.x < rect.x && label.align === 'left');
  if (ambiguousTimeLabel || (estimated && rect && estimated.x <= rect.x + rect.width && estimated.x + estimated.width >= rect.x &&
      estimated.y <= rect.y + rect.height && estimated.y + estimated.height >= rect.y)) {
    for (const label of layout.labels) {
      if (label.align) {
        textContext ??= adapter.getTextContext?.();
        if (textContext?.measureText) label.width = measuredLabelWidth(textContext, String(label.text));
      }
    }
  }
  if (result.fibLabelSpan) {
    for (const label of result.labels) {
      if (!textContext?.measureText) label.width = Math.max(4, String(label.text).length * 7);
      positionLineLabel(label, drawing.props.labelPosition, result.fibLabelSpan, rect);
    }
  }
  for (const key of ['measure', 'regression', 'vwap', 'angleDegrees', 'available', 'reason', 'waiting', 'error', 'origin', 'direction', 'variant']) {
    if (result[key] !== undefined) layout[key] = result[key];
  }
  // Axis-label entries carry values and reasons, never text: the paint pass formats only plates that survive
  const axisOptions = drawing.props.axisLabels;
  if (axisOptions && (axisOptions.price || axisOptions.time)) {
    const axisLabels = [];
    const anchorSpec = spec.anchors;
    anchors.forEach((anchor, index) => {
      if (axisOptions.price && anchorSpec.price && anchor.price !== undefined) {
        axisLabels.push({ axis: 'price', anchorIndex: index, price: anchor.price });
      }
      if (axisOptions.time && anchorSpec.x && anchor.anchorBarId !== undefined) {
        const entry = { axis: 'time', anchorIndex: index, logical: anchor.logical };
        const derivedSlot = adapter.paneKind?.(binding) === 'derived'
          && anchor.offset === 0 && Number.isInteger(anchor.logical)
          && adapter.indexOf(anchor.anchorBarId, binding) === anchor.logical
          && adapter.getSlot(anchor.logical, binding);
        if (!derivedSlot && anchorTime(anchor, adapter, binding) === null) entry.unavailable = 'no-time';
        axisLabels.push(entry);
      }
    });
    if (axisLabels.length > 0) layout.axisLabels = axisLabels;
  }
  layout.bounds = computeBounds(layout.primitives, layout.labels, layout.handles);
  return layout;
}

function computeBounds(primitives, labels, handles = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (x, y) => {
    if (!isNumber(x) || !isNumber(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const handle of handles) {
    add(handle.x - 4, handle.y - 4);
    add(handle.x + 4, handle.y + 4);
  }
  for (const primitive of primitives) {
    switch (primitive.kind) {
      case 'segment':
      case 'line':
      case 'ray':
        add(primitive.x1, primitive.y1);
        add(primitive.x2, primitive.y2);
        break;
      case 'polyline':
      case 'marker':
      case 'bezier':
        for (const point of primitive.points) add(point.x, point.y);
        break;
      case 'polygon':
      case 'zone':
        for (const point of primitive.points) add(point.x, point.y);
        break;
      case 'ellipse':
        add(primitive.cx - primitive.rx, primitive.cy - primitive.ry);
        add(primitive.cx + primitive.rx, primitive.cy + primitive.ry);
        break;
      case 'circle':
        add(primitive.cx - primitive.r, primitive.cy - primitive.r);
        add(primitive.cx + primitive.r, primitive.cy + primitive.r);
        break;
      case 'arc':
      case 'ring':
        add(primitive.cx - primitive.r, primitive.cy - primitive.r);
        add(primitive.cx + primitive.r, primitive.cy + primitive.r);
        break;
      case 'text':
        if (primitive.textLayout?.bounds) {
          const b = primitive.textLayout.bounds;
          add(b.x, b.y); add(b.x + b.width, b.y + b.height);
        }
        break;
      default:
        break;
    }
  }
  for (const label of labels) {
    if (label.textLayout) {
      const b = label.textLayout.bounds;
      if (b) { add(b.x, b.y); add(b.x + b.width, b.y + b.height); }
    } else {
      const width = label.width ?? Math.max(4, String(label.text).length * 7);
      const left = label.align === 'right' ? label.x - width : label.align === 'center' ? label.x - width / 2 : label.x;
      add(left, label.y - 12);
      add(left + width, label.y + 4);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function buildLayout(drawing, adapter) {
  return materialize(drawing.type, drawing, adapter);
}

export const HIT_KINDS = Object.freeze(['segment', 'line', 'ray', 'polyline', 'marker', 'polygon', 'ellipse', 'circle', 'arc', 'zone', 'ring', 'text', 'bezier']);
