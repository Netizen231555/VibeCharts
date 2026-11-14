import { DRAWING_TOOLS } from './tools.js';
import { DrawingError, equal, isNumber, normalizeZero } from './values.js';
import { computeRegression, computeVwap, measureAnchors } from './analytics.js';

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
    case 'ray':
    case 'line':
    case 'parallelChannel':
      if (samePoint(a, b)) throwGeometry('degenerate-direction', `${type} anchors must define a direction`);
      break;
    case 'arrow':
      if (samePoint(a, b)) throwGeometry('degenerate-arrow', 'Arrow endpoints must not coincide');
      break;
    case 'angle':
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

function clipLine(x0, y0, x1, y1, rect, mode) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  let tmin = mode === 'ray' ? 0 : -Infinity;
  let tmax = Infinity;
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

function shapePoints(points) {
  return points.map(point => ({ x: point.x, y: point.y }));
}

function polygon(role, points) {
  return { kind: 'polygon', role, points: shapePoints(points) };
}

function lineBetween(role, x1, y1, x2, y2) {
  return { kind: 'segment', role, x1, y1, x2, y2 };
}

function horizontalSpan(a, b, rect) {
  let x1 = Math.min(a.x, b.x);
  let x2 = Math.max(a.x, b.x);
  if (x1 === x2) x2 = Math.max(x2, rect.x + rect.width);
  return { x1, x2 };
}

function formatPriceLabel(adapter, price, binding) {
  if (typeof adapter.formatPrice === 'function') {
    const text = adapter.formatPrice(price, binding);
    if (typeof text === 'string') return text;
  }
  return String(Number(price.toPrecision(12)));
}

// Float noise (4.670005912000022) never reaches a label: round to 12 significant digits, then to the requested decimals.
function signed(value, text = String(Number(value.toPrecision(12)))) {
  return value >= 0 ? `+${text}` : text;
}

// A price difference uses the price step's decimals when the host can supply them; otherwise a bounded precision.
function formatPriceDelta(adapter, delta, binding) {
  if (typeof adapter.formatPriceDelta === 'function') {
    const text = adapter.formatPriceDelta(delta, binding);
    if (typeof text === 'string') return signed(delta, text);
  }
  return signed(delta);
}

// Bar counts may be fractional when an anchor has an offset; two decimals are the most a reader can use.
function formatIntervals(delta) {
  return signed(delta, String(Number(delta.toFixed(2))));
}

function labelText(level) {
  return level.label === undefined ? String(level.coefficient) : level.label;
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

const BUILDERS = {
  segment({ a, b }) {
    return { primitives: [{ kind: 'segment', x1: a.x, y1: a.y, x2: b.x, y2: b.y }] };
  },
  ray({ a, b, rect }) {
    const clipped = clipLine(a.x, a.y, b.x, b.y, rect, 'ray');
    return { primitives: clipped ? [{ kind: 'ray', ...clipped }] : [] };
  },
  line({ a, b, rect }) {
    const clipped = clipLine(a.x, a.y, b.x, b.y, rect, 'line');
    return { primitives: clipped ? [{ kind: 'line', ...clipped }] : [] };
  },
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
  parallelChannel({ a, b, c, rect }) {
    const base = clipLine(a.x, a.y, b.x, b.y, rect, 'line');
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const second = a.x === b.x && a.y === b.y ? null : clipLine(c.x, c.y, c.x + dx, c.y + dy, rect, 'line');
    const primitives = [];
    if (base) primitives.push({ kind: 'line', role: 'channel-base', ...base });
    if (second) primitives.push({ kind: 'line', role: 'channel-parallel', ...second });
    if (a.resolved && b.resolved) primitives.push({ kind: 'segment', role: 'channel-anchor-line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    return { primitives };
  },
  rectangle({ a, b }) {
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return {
      primitives: [polygon('rectangle', [{ x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 }])],
    };
  },
  ellipse({ a, b }) {
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    return { primitives: [{ kind: 'ellipse', cx, cy, rx: Math.abs(b.x - a.x) / 2, ry: Math.abs(b.y - a.y) / 2 }] };
  },
  fibRetracement({ a, b, drawing, adapter, binding }) {
    const primitives = [];
    const labels = [];
    const span = horizontalSpan(a, b, adapter.getVisibleRect(binding));
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const price = a.price + level.coefficient * (b.price - a.price);
      const y = adapter.priceToY(price, binding);
      if (!isNumber(y)) continue;
      const text = labelText(level);
      primitives.push({ kind: 'segment', role: 'fib-level', coefficient: level.coefficient, price, x1: span.x1, y1: y, x2: span.x2, y2: y });
      labels.push({ x: span.x2 + 4, y: y - 2, text, coefficient: level.coefficient });
    }
    return { primitives, labels };
  },
  text({ a, drawing }) {
    return { primitives: [{ kind: 'text', x: a.x, y: a.y, text: drawing.props.text }] };
  },
  measure({ a, b, adapter, binding }) {
    const measure = measureAnchors([a, b], adapter, binding);
    const labels = [{ x: (a.x + b.x) / 2 + 6, y: (a.y + b.y) / 2 - 6, text: `price ${formatPriceDelta(adapter, measure.priceDelta, binding)}` }];
    if (measure.relativeChange !== null) {
      labels.push({ x: (a.x + b.x) / 2 + 6, y: (a.y + b.y) / 2 + 8, text: `change ${(measure.relativeChange * 100).toFixed(2)}%` });
    }
    if (measure.indexDelta !== null) {
      labels.push({ x: (a.x + b.x) / 2 + 6, y: (a.y + b.y) / 2 + 22, text: `intervals ${formatIntervals(measure.indexDelta)}` });
    }
    return { primitives: [{ kind: 'segment', role: 'measure', x1: a.x, y1: a.y, x2: b.x, y2: b.y }], labels, measure };
  },
  arrow({ a, b }) {
    return {
      primitives: [
        { kind: 'segment', x1: a.x, y1: a.y, x2: b.x, y2: b.y },
        { kind: 'polygon', role: 'arrowhead', points: arrowHead(b, a), closed: true },
      ],
    };
  },
  angle({ a, b, c }) {
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
    return {
      primitives: [
        lineBetween('angle-ray', b.x, b.y, a.x, a.y),
        lineBetween('angle-ray', b.x, b.y, c.x, c.y),
        arcPrimitive(b, radius, startAngle, endAngle),
      ],
      angleDegrees,
    };
  },
  triangle({ a, b, c }) {
    return { primitives: [polygon('triangle', [a, b, c])] };
  },
  polyline({ anchors }) {
    return { primitives: [{ kind: 'polyline', points: shapePoints(anchors) }] };
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
    return { primitives: [{ kind: 'bezier', p0, p1, p2, p3, points }] };
  },
  brush({ anchors }) {
    return { primitives: [{ kind: 'polyline', role: 'brush', points: shapePoints(anchors) }] };
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
  fibExtension({ a, b, c, drawing, adapter, binding }) {
    const primitives = [];
    const labels = [];
    const span = horizontalSpan(a, c, adapter.getVisibleRect(binding));
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const price = c.price + level.coefficient * (b.price - a.price);
      const y = adapter.priceToY(price, binding);
      if (!isNumber(y)) continue;
      primitives.push({ kind: 'segment', role: 'fib-extension-level', coefficient: level.coefficient, price, x1: span.x1, y1: y, x2: span.x2, y2: y });
      labels.push({ x: span.x2 + 4, y: y - 2, text: labelText(level), coefficient: level.coefficient });
    }
    return { primitives, labels };
  },
  fibFan({ a, b, drawing, adapter, binding, rect }) {
    const primitives = [];
    const labels = [];
    if (a.x === b.x) return { primitives: [] };
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const price = a.price + level.coefficient * (b.price - a.price);
      const y = adapter.priceToY(price, binding);
      if (!isNumber(y)) continue;
      const clipped = clipLine(a.x, a.y, b.x, y, rect, 'ray');
      if (!clipped) continue;
      primitives.push({ kind: 'ray', role: 'fib-fan-ray', coefficient: level.coefficient, ...clipped });
      labels.push({ x: clipped.x2 + 4, y: clipped.y2, text: labelText(level), coefficient: level.coefficient });
    }
    return { primitives, labels };
  },
  fibArcs({ a, b, drawing, rect }) {
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance <= EPS) return { primitives: [] };
    const primitives = [];
    const labels = [];
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const radius = Math.abs(level.coefficient) * distance;
      const bounds = { x: a.x - radius, y: a.y - radius, width: radius * 2, height: radius * 2 };
      const visible = bounds.x <= rect.x + rect.width && bounds.x + bounds.width >= rect.x
        && bounds.y <= rect.y + rect.height && bounds.y + bounds.height >= rect.y;
      if (!visible) continue;
      primitives.push({ kind: 'circle', role: 'fib-arc', cx: a.x, cy: a.y, r: radius, coefficient: level.coefficient });
      labels.push({ x: a.x + radius * Math.SQRT1_2 + 2, y: a.y - radius * Math.SQRT1_2, text: labelText(level), coefficient: level.coefficient });
    }
    return { primitives, labels };
  },
  fibTimeZones({ a, b, drawing, adapter, rect, binding }) {
    const primitives = [];
    const labels = [];
    for (const level of drawing.props.levels) {
      if (!level.visible) continue;
      const logical = a.logical + level.coefficient * (b.logical - a.logical);
      const x = adapter.logicalToX(logical, binding);
      if (!isNumber(x)) continue;
      primitives.push({ kind: 'line', role: 'time-zone', coefficient: level.coefficient, logical, x1: x, y1: rect.y, x2: x, y2: rect.y + rect.height });
      labels.push({ x: x + 2, y: rect.y + 12, text: labelText(level), coefficient: level.coefficient });
    }
    return { primitives, labels };
  },
  pitchfork({ a, b, c, drawing, rect }) {
    const { origin, direction } = pitchforkFrame([a, b, c], drawing.props.variant);
    const length = Math.hypot(direction.x, direction.y);
    if (length <= EPS) return { primitives: [], available: false, reason: 'degenerate-direction' };
    const primitives = [];
    const median = clipLine(origin.x, origin.y, origin.x + direction.x, origin.y + direction.y, rect, 'ray');
    if (median) primitives.push({ kind: 'ray', role: 'pitchfork-median', ...median });
    for (const side of [b, c]) {
      const clipped = clipLine(side.x, side.y, side.x + direction.x, side.y + direction.y, rect, 'ray');
      if (clipped) primitives.push({ kind: 'ray', role: 'pitchfork-side', ...clipped });
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
  anchoredVwap({ a, drawing, adapter, binding }) {
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
    return {
      primitives: segments.map(points => ({ kind: 'polyline', role: 'vwap', points })),
      vwap,
      available: true,
    };
  },
};

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
  for (const key of ['measure', 'regression', 'vwap', 'angleDegrees', 'available', 'reason', 'waiting', 'error', 'origin', 'direction', 'variant']) {
    if (result[key] !== undefined) layout[key] = result[key];
  }
  layout.bounds = computeBounds(layout.primitives, layout.labels);
  return layout;
}

function computeBounds(primitives, labels) {
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
        add(primitive.cx - primitive.r, primitive.cy - primitive.r);
        add(primitive.cx + primitive.r, primitive.cy + primitive.r);
        break;
      case 'text':
        add(primitive.x, primitive.y - 12);
        add(primitive.x + Math.max(4, String(primitive.text).length * 7), primitive.y + 4);
        break;
      default:
        break;
    }
  }
  for (const label of labels) {
    add(label.x, label.y - 12);
    add(label.x + Math.max(4, String(label.text).length * 7), label.y + 4);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function buildLayout(drawing, adapter) {
  return materialize(drawing.type, drawing, adapter);
}

export const HIT_KINDS = Object.freeze(['segment', 'line', 'ray', 'polyline', 'marker', 'polygon', 'ellipse', 'circle', 'arc', 'text', 'bezier']);
