/**
 * Pure geometry helpers used by hit-testing, gestures and the pane layout.
 * Coordinates are CSS pixels relative to the chart container.
 */
import { InteractionError } from './errors.js';

export const EPSILON = 1e-9;

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function requireFinite(value, field) {
  if (!isFiniteNumber(value)) {
    throw new InteractionError(`Expected a finite number in ${field}`, { code: 'INVALID_NUMBER', field });
  }
  return value;
}

export function requirePositive(value, field) {
  requireFinite(value, field);
  if (!(value > 0)) throw new InteractionError(`${field} must be positive`, { code: 'INVALID_NUMBER', field });
  return value;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function point(x, y) {
  return { x, y };
}

export function rect(x, y, width, height) {
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) {
    throw new InteractionError('Invalid rectangle', { code: 'INVALID_RECT', field: 'rect' });
  }
  return { x, y, width, height, right: x + width, bottom: y + height };
}

export function normalizeRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return rect(x, y, Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function rectFromBounds({ left, top, right, bottom }) {
  return rect(left, top, right - left, bottom - top);
}

export function pointInRect(p, r, tolerance = 0) {
  return p.x >= r.x - tolerance && p.x <= r.x + r.width + tolerance && p.y >= r.y - tolerance && p.y <= r.y + r.height + tolerance;
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export function expandRect(r, amount) {
  return rect(r.x - amount, r.y - amount, r.width + amount * 2, r.height + amount * 2);
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scalePoint(p, factor) {
  return { x: p.x * factor, y: p.y * factor };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function length(v) {
  return Math.hypot(v.x, v.y);
}

/**
 * Closest point on the segment a-b to p, with the clamped parameter t.
 * Returns the distance as well so hit-testing can compare it against a radius.
 */
export function projectOnSegment(p, a, b) {
  const ab = subtract(b, a);
  const lengthSquared = dot(ab, ab);
  let t = 0;
  if (lengthSquared > EPSILON) {
    t = clamp(dot(subtract(p, a), ab) / lengthSquared, 0, 1);
  }
  const closest = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { point: closest, t, distance: distance(p, closest) };
}

export function distanceToSegment(p, a, b) {
  return projectOnSegment(p, a, b).distance;
}

export function distanceToPolyline(p, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const d = distanceToSegment(p, points[i - 1], points[i]);
    if (d < best) best = d;
  }
  return best;
}

/** Liang-Barsky clipping of the segment a-b to the rectangle r. */
export function clipSegment(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const checks = [
    [-dx, a.x - r.x],
    [dx, r.x + r.width - a.x],
    [-dy, a.y - r.y],
    [dy, r.y + r.height - a.y],
  ];
  for (const [p, q] of checks) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  if (t1 - t0 < EPSILON) {
    const onEdge = { x: a.x + dx * t0, y: a.y + dy * t0 };
    return [onEdge, onEdge];
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

export function segmentIntersectsRect(a, b, r) {
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  return clipSegment(a, b, r) !== null;
}

export function rectIntersectsRect(a, b) {
  return rectsOverlap(a, b);
}

/** Rectangle border as four segments; used for rectangle and ellipse bodies. */
export function rectSegments(r) {
  const nw = { x: r.x, y: r.y };
  const ne = { x: r.x + r.width, y: r.y };
  const se = { x: r.x + r.width, y: r.y + r.height };
  const sw = { x: r.x, y: r.y + r.height };
  return [
    [nw, ne],
    [ne, se],
    [se, sw],
    [sw, nw],
  ];
}

export function distanceToRectBorder(p, r) {
  let best = Infinity;
  for (const [a, b] of rectSegments(r)) {
    const d = distanceToSegment(p, a, b);
    if (d < best) best = d;
  }
  return best;
}

/** Distance from p to an axis-aligned ellipse border, approximated by polyline. */
export function distanceToEllipse(p, r, steps = 64) {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = r.width / 2;
  const ry = r.height / 2;
  let previous = null;
  let best = Infinity;
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const current = { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    if (previous) best = Math.min(best, distanceToSegment(p, previous, current));
    previous = current;
  }
  return best;
}

/** Infinite line through a and b, clipped to the pane plot rectangle. */
export function clipInfiniteLine(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < EPSILON) return null;
  const far = (r.width + r.height) * 4 + Math.abs(a.x) + Math.abs(a.y);
  const norm = Math.hypot(dx, dy);
  const ux = (dx / norm) * far;
  const uy = (dy / norm) * far;
  return clipSegment({ x: a.x - ux, y: a.y - uy }, { x: a.x + ux, y: a.y + uy }, r);
}

/** Half-line starting at a through b, clipped to the rectangle. */
export function clipRay(a, b, r) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const norm = Math.hypot(dx, dy);
  if (norm < EPSILON) return null;
  const far = (r.width + r.height) * 4 + Math.abs(a.x) + Math.abs(a.y);
  return clipSegment(a, { x: a.x + (dx / norm) * far, y: a.y + (dy / norm) * far }, r);
}

/** Unsigned angle at the vertex between the rays vertex->a and vertex->b. */
export function angleDegrees(vertex, a, b) {
  const va = subtract(a, vertex);
  const vb = subtract(b, vertex);
  const denominator = length(va) * length(vb);
  if (denominator < EPSILON) return null;
  const cosine = clamp(dot(va, vb) / denominator, -1, 1);
  return (Math.acos(cosine) * 180) / Math.PI;
}
