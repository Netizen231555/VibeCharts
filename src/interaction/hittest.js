/**
 * Hit-testing for chart drawings and chart chrome.
 *
 * All math happens in CSS pixels relative to the container. Chart space is
 * resolved through the public index/price scales; a drawing anchor whose
 * `barId` is unknown stays unresolved and never intercepts input. Hit order is
 * visible handles of the topmost drawing, then the body of the topmost
 * drawing, then the axis, then the plot background. Drawings are clipped to
 * their pane plot rectangle, so geometry outside the clip region is inert.
 */
import { InteractionError } from './errors.js';
import {
  EPSILON,
  clipInfiniteLine,
  clipRay,
  distance,
  distanceToEllipse,
  distanceToPolyline,
  distanceToRectBorder,
  distanceToSegment,
  isFiniteNumber,
  normalizeRect,
  pointInRect,
  requireFinite,
  segmentIntersectsRect,
  clipSegment,
  rectSegments,
} from './geometry.js';

export const MIN_HIT_RADIUS = 4;

export function normalizeHitRadius(value, field = 'hitRadius') {
  if (value === undefined || value === null) return MIN_HIT_RADIUS;
  if (!isFiniteNumber(value) || value < MIN_HIT_RADIUS) {
    throw new InteractionError(`${field} must be a finite number of at least ${MIN_HIT_RADIUS} CSS pixels`, {
      code: 'INVALID_HIT_RADIUS',
      field,
    });
  }
  return value;
}

const TWO_ANCHOR_STROKE = new Set(['trendLine', 'arrow', 'measure', 'segment', 'fibRetracement', 'fibonacci']);
const THREE_ANCHOR_STROKE = new Set(['triangle', 'angle', 'andrewsPitchfork', 'fibExtension']);
const RECT_TYPES = new Set(['rectangle', 'fibZones']);
const POINT_LISTS = new Set(['polyline', 'brush', 'marker', 'bezier']);
const TEXT_TYPES = new Set(['text', 'callout', 'flag', 'priceLabel', 'anchoredVwap']);

export function drawingTypeFamily(type) {
  if (type === 'ray' || type === 'horizontalRay' || type === 'line' || type === 'horizontalLine' || type === 'verticalLine') return 'line';
  if (TWO_ANCHOR_STROKE.has(type)) return 'twoAnchor';
  if (THREE_ANCHOR_STROKE.has(type)) return 'threeAnchor';
  if (RECT_TYPES.has(type)) return 'rect';
  if (type === 'ellipse') return 'ellipse';
  if (type === 'fibFan' || type === 'fibArcs') return 'fibFan';
  if (POINT_LISTS.has(type)) return 'points';
  if (TEXT_TYPES.has(type)) return 'text';
  return 'twoAnchor';
}

/**
 * Resolve a drawing snapshot into screen geometry. Returns null when any
 * anchor needed for the visible geometry cannot be resolved (unknown barId).
 */
export function resolveDrawing(drawing, ctx) {
  if (!drawing || typeof drawing !== 'object') return null;
  const anchors = Array.isArray(drawing.anchors) ? drawing.anchors : [];
  const family = drawingTypeFamily(drawing.type);
  const resolved = [];
  for (const anchor of anchors) {
    const x = ctx.resolveAnchorX(anchor, drawing);
    const price = anchor.price;
    let y = null;
    if (isFiniteNumber(price)) {
      y = ctx.resolvePriceY(price, drawing);
    }
    if (x === null && y === null) return null;
    resolved.push({ x, y, price: isFiniteNumber(price) ? price : null, anchor });
  }
  if (family === 'line') {
    if (drawing.type === 'horizontalLine') {
      if (!resolved[0] || resolved[0].y === null) return null;
    } else if (drawing.type === 'verticalLine') {
      if (!resolved[0] || resolved[0].x === null) return null;
    } else if (resolved.length < 2 || resolved[0].x === null || resolved[1].x === null || resolved[0].y === null || resolved[1].y === null) {
      return null;
    }
  } else if (family === 'rect' || family === 'ellipse') {
    if (resolved.length < 2 || resolved[0].x === null || resolved[0].y === null || resolved[1].x === null || resolved[1].y === null) return null;
  } else if (family === 'points') {
    if (resolved.some((anchor) => anchor.x === null || anchor.y === null)) return null;
  } else if (family === 'text') {
    if (resolved[0] === undefined || resolved[0].x === null || resolved[0].y === null) return null;
  } else {
    const needed = family === 'threeAnchor' ? 3 : 2;
    for (let i = 0; i < needed; i += 1) {
      if (resolved[i] === undefined || resolved[i].x === null || resolved[i].y === null) return null;
    }
  }
  return { drawing, family, anchors: resolved, paneId: drawing.paneId };
}

function handlePoints(resolved, plot) {
  const { drawing, family, anchors } = resolved;
  const points = [];
  if (family === 'line') {
    const first = anchors[0];
    if (drawing.type === 'horizontalLine') {
      points.push({ x: plot.x + plot.width - 6, y: first.y, anchorIndex: 0, kind: 'price' });
    } else if (drawing.type === 'verticalLine') {
      points.push({ x: first.x, y: plot.y + 6, anchorIndex: 0, kind: 'index' });
    } else {
      points.push({ x: first.x, y: first.y, anchorIndex: 0, kind: 'anchor' });
    }
    return points;
  }
  if (family === 'rect' || family === 'ellipse') {
    const a = anchors[0];
    const b = anchors[1];
    const r = normalizeRect(a, b);
    return [
      { x: r.x, y: r.y, anchorIndex: 0, kind: 'anchor' },
      { x: r.right, y: r.y, anchorIndex: 0, kind: 'corner' },
      { x: r.right, y: r.bottom, anchorIndex: 1, kind: 'anchor' },
      { x: r.x, y: r.bottom, anchorIndex: 1, kind: 'corner' },
    ];
  }
  anchors.forEach((anchor, index) => {
    if (anchor.x !== null && anchor.y !== null) points.push({ x: anchor.x, y: anchor.y, anchorIndex: index, kind: 'anchor' });
  });
  return points;
}

function bodyDistance(resolved, point, plot) {
  const { drawing, family, anchors } = resolved;
  const type = drawing.type;
  if (family === 'line') {
    const first = anchors[0];
    if (type === 'horizontalLine') {
      return Math.abs(point.y - first.y) <= plot.height && point.x >= plot.x && point.x <= plot.x + plot.width ? Math.abs(point.y - first.y) : Infinity;
    }
    if (type === 'verticalLine') {
      return Math.abs(point.x - first.x) <= plot.width && point.y >= plot.y && point.y <= plot.y + plot.height ? Math.abs(point.x - first.x) : Infinity;
    }
    const second = anchors[1];
    if (!second) return Infinity;
    if (type === 'line') {
      const clipped = clipInfiniteLine(first, second, plot);
      return clipped ? distanceToSegment(point, clipped[0], clipped[1]) : Infinity;
    }
    if (type === 'horizontalRay') {
      const a = { x: first.x, y: first.y };
      const b = { x: plot.x + plot.width, y: first.y };
      return first.x <= plot.x + plot.width ? distanceToSegment(point, a, { x: Math.max(a.x, b.x), y: b.y }) : Infinity;
    }
    if (type === 'ray') {
      const clipped = clipRay(first, second, plot);
      return clipped ? distanceToSegment(point, clipped[0], clipped[1]) : Infinity;
    }
    return distanceToSegment(point, first, second);
  }
  if (family === 'rect') {
    const r = normalizeRect(anchors[0], anchors[1]);
    if (type === 'fibZones') {
      return point.x >= r.x && point.x <= r.right && point.y >= plot.y && point.y <= plot.y + plot.height ? 0 : Infinity;
    }
    if (pointInRect(point, r)) return 0;
    return distanceToRectBorder(point, r);
  }
  if (family === 'ellipse') {
    const r = normalizeRect(anchors[0], anchors[1]);
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const inside = ((point.x - cx) ** 2) / Math.max(r.width * r.width / 4, EPSILON) + ((point.y - cy) ** 2) / Math.max(r.height * r.height / 4, EPSILON) <= 1;
    if (inside) return 0;
    return distanceToEllipse(point, r, 48);
  }
  if (family === 'points') {
    const points = anchors.map((anchor) => ({ x: anchor.x, y: anchor.y }));
    if (type === 'bezier' && points.length === 4) {
      const sampled = [];
      for (let i = 0; i <= 24; i += 1) {
        const t = i / 24;
        const mt = 1 - t;
        sampled.push({
          x: mt ** 3 * points[0].x + 3 * mt * mt * t * points[1].x + 3 * mt * t * t * points[2].x + t ** 3 * points[3].x,
          y: mt ** 3 * points[0].y + 3 * mt * mt * t * points[1].y + 3 * mt * t * t * points[2].y + t ** 3 * points[3].y,
        });
      }
      return distanceToPolyline(point, sampled);
    }
    if (type === 'marker') {
      return pointInRect(point, normalizeRect({ x: points[0].x - 6, y: points[0].y - 6 }, { x: points[0].x + 6, y: points[0].y + 6 })) ? 0 : Infinity;
    }
    return distanceToPolyline(point, points);
  }
  if (family === 'fibFan') {
    const first = anchors[0];
    const second = anchors[1];
    if (!second || second.x === null || second.y === null) return Infinity;
    const levels = Array.isArray(drawing.properties?.levels) ? drawing.properties.levels : [0, 0.236, 0.382, 0.5, 0.618, 1];
    let best = Infinity;
    for (const level of levels) {
      if (!isFiniteNumber(level)) continue;
      if (type === 'fibArcs') {
        const radius = Math.abs(level) * distance(first, second);
        const ringDistance = Math.abs(distance(point, first) - radius);
        if (ringDistance < best) best = ringDistance;
      } else {
        const end = { x: second.x, y: first.y + level * (second.y - first.y) };
        const clipped = clipRay(first, end, plot);
        if (clipped) best = Math.min(best, distanceToSegment(point, clipped[0], clipped[1]));
      }
    }
    return best;
  }
  if (family === 'threeAnchor') {
    const points = anchors.map((anchor) => ({ x: anchor.x, y: anchor.y }));
    let best = Infinity;
    for (let i = 1; i < points.length; i += 1) best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
    if (type === 'fibExtension' || type === 'andrewsPitchfork') {
      best = Math.min(best, distanceToSegment(point, points[0], points[2]));
    }
    return best;
  }
  if (family === 'text') {
    const anchor = anchors[0];
    const box = normalizeRect({ x: anchor.x - 24, y: anchor.y - 10 }, { x: anchor.x + 40, y: anchor.y + 10 });
    if (pointInRect(point, box)) return 0;
    return Number.isFinite(anchor.x) ? Math.min(distance(point, anchor), distanceToRectBorder(point, box)) : Infinity;
  }
  return Infinity;
}

function isClipped(resolved, plot) {
  const { family, anchors } = resolved;
  if (family === 'rect' || family === 'ellipse') {
    const r = normalizeRect(anchors[0], anchors[1]);
    return r.width > 0 && r.height > 0 ? rectIntersectsPlot(r, plot) : false;
  }
  if (family === 'points') {
    for (let i = 1; i < anchors.length; i += 1) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (segmentIntersectsRect(a, b, plot)) return true;
    }
    return pointInRect(anchors[0], plot);
  }
  if (family === 'text' || family === 'line') {
    if (family === 'line' && resolved.drawing.type === 'horizontalLine') {
      const y = anchors[0].y;
      return y !== null && y >= plot.y && y <= plot.y + plot.height && plot.width > 0;
    }
    if (family === 'line' && resolved.drawing.type === 'verticalLine') {
      const x = anchors[0].x;
      return x !== null && x >= plot.x && x <= plot.x + plot.width && plot.height > 0;
    }
    return pointInRect(anchors[0], plot);
  }
  return anchors.some((anchor) => pointInRect(anchor, plot));
}

function rectIntersectsPlot(r, plot) {
  return r.x < plot.x + plot.width && r.right > plot.x && r.y < plot.y + plot.height && r.bottom > plot.y;
}

function normalizeSelection(selection) {
  if (!selection) return [];
  if (Array.isArray(selection)) return selection;
  return [selection];
}

/**
 * Hit-test a point against drawings of one pane.
 * Returns the winning target or null.
 */
export function hitTestDrawings(point, ctx, { paneId, radius, handleRadius, selection = [] }) {
  const plot = ctx.plot;
  const list = (ctx.drawings || []).slice();
  list.sort((a, b) => {
    const orderA = isFiniteNumber(a.order) ? a.order : 0;
    const orderB = isFiniteNumber(b.order) ? b.order : 0;
    return orderA - orderB;
  });
  const selected = new Set(normalizeSelection(selection));
  let bestHandle = null;
  let bestBody = null;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const drawing = list[i];
    if (drawing.visible === false) continue;
    if (drawing.paneId !== undefined && paneId !== undefined && drawing.paneId !== paneId) continue;
    const resolved = resolveDrawing(drawing, { ...ctx, plot });
    if (!resolved) continue;
    if (!isClipped(resolved, plot)) continue;
    if (!bestHandle) {
      const handles = handlePoints(resolved, plot);
      for (const handle of handles) {
        if (!pointInRect(handle, plot, 0)) continue;
        if (distance(point, handle) <= handleRadius) {
          bestHandle = {
            kind: 'handle',
            drawingId: drawing.id,
            drawingType: drawing.type,
            paneId: drawing.paneId,
            scaleId: drawing.scaleId,
            anchorIndex: handle.anchorIndex,
            handleKind: handle.kind,
            x: handle.x,
            y: handle.y,
            locked: drawing.locked === true,
            selected: selected.has(drawing.id),
            order: drawing.order,
          };
          break;
        }
      }
    }
    if (!bestBody && !bestHandle) {
      const body = bodyDistance(resolved, point, plot);
      if (body <= radius) {
        bestBody = {
          kind: 'drawing',
          drawingId: drawing.id,
          drawingType: drawing.type,
          paneId: drawing.paneId,
          scaleId: drawing.scaleId,
          distance: body,
          locked: drawing.locked === true,
          selected: selected.has(drawing.id),
          order: drawing.order,
        };
      }
    }
    if (bestHandle) break;
  }
  if (bestHandle) return bestHandle;
  if (bestBody) return bestBody;
  return null;
}

/** Find the pane and axis under the point. Drawings never leak across panes. */
export function hitTestAxes(point, layout) {
  for (const pane of layout.panes) {
    if (!pane.visible) continue;
    for (const scale of pane.priceScales) {
      if (pointInRect(point, scale.rect)) {
        return { kind: 'axis', axis: 'price', paneId: pane.id, scaleId: scale.id, side: scale.side, inverted: scale.inverted === true, rect: scale.rect };
      }
    }
    if (pane.indexAxis && pointInRect(point, pane.indexAxis)) {
      return { kind: 'axis', axis: 'index', paneId: pane.id, rect: pane.indexAxis };
    }
  }
  return null;
}

export function paneAtPoint(point, layout) {
  for (const pane of layout.panes) {
    if (pane.visible && pointInRect(point, pane.plot)) return pane;
  }
  return null;
}

/**
 * Resolve the topmost interactive target at a point: drawing handle, drawing
 * body, axis, plot pane, or nothing.
 */
export function hitTest(point, ctx) {
  const { layout, drawings = [], radius, handleRadius, selection = [], resolveAnchorX, resolvePriceY } = ctx;
  const pane = paneAtPoint(point, layout);
  const axis = hitTestAxes(point, layout);
  if (!pane) return axis ? { ...axis, point } : { kind: 'none', point };
  if (pane.plot.width === 0 || pane.plot.height === 0) return axis ? { ...axis, point } : { kind: 'none', point };
  const drawingCtx = { drawings, resolveAnchorX, resolvePriceY, plot: pane.plot };
  const drawingHit = hitTestDrawings(point, drawingCtx, { paneId: pane.id, radius, handleRadius, selection });
  if (drawingHit) return { ...drawingHit, paneId: pane.id, point };
  if (axis) return { ...axis, point };
  return { kind: 'plot', paneId: pane.id, point, plot: pane.plot };
}

export function segmentVisibleIn(segment, plot) {
  return clipSegment(segment[0], segment[1], plot) !== null;
}

export function rectSegmentsVisibleIn(r, plot) {
  return rectSegments(r).some(([a, b]) => segmentIntersectsRect(a, b, plot));
}

export { requireFinite };
