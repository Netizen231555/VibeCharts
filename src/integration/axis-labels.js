// The drawing axis-label pass: price plates in the price-axis column of the drawing's own scale and time
// plates on the time axis (or the ordinal strip of a derived pane). Painted after the plot pass, above the
// tick labels, below the crosshair plates; values and reasons come from `layout.axisLabels`, text is made
// here only for plates that survive culling.
import { axisColumns } from '../render/layout.js';
import { axisTimeText } from '../render/axis-time.js';

function intersects(a, b) {
  return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
}

/**
 * `entries` are `{ layout, selected }` pairs (the drawing layouts, in paint order — selected drawings last)
 * whose `layout.axisLabels` exist. `axisPlates` are the frame's placed last-price plate rectangles
 * (`chart._axisPlates`); `timeFormatter` is the host `crosshair.timeFormatter`; `reportError` receives a
 * formatter failure, called once per frame per distinct error.
 */
export function drawAxisLabels(ctx, {
  entries, frameLayout, width, theme, options, adapter, axisPlates = [], timeFormatter = null,
  presentation = {}, reportError = () => {},
}) {
  const fontSize = options.fontSize ?? 12;
  const half = Math.max(18, fontSize + 6) / 2;
  const paneRects = new Map(frameLayout.panes.map(rect => [rect.pane.id, rect]));
  const seen = new Set();
  const reported = new Set();
  ctx.save();
  try {
    ctx.font = `${fontSize}px ${options.fontFamily ?? 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (const entry of entries) {
      const layout = entry.layout;
      const binding = { paneId: layout.paneId, scaleId: layout.scaleId };
      const paneRect = paneRects.get(layout.paneId);
      if (!paneRect) continue;
      for (const label of layout.axisLabels) {
        if (label.axis === 'price') drawPricePlate(ctx, { label, layout, binding, paneRect, frameLayout, width, theme, adapter, axisPlates, entry, fontSize, half, seen });
        else if (label.axis === 'time') drawTimePlate(ctx, { label, layout, binding, paneRect, frameLayout, theme, adapter, timeFormatter, presentation, reportError, reported, entry, fontSize, half, seen });
      }
    }
  } finally {
    ctx.restore();
  }
}

function drawPricePlate(ctx, { label, layout, binding, paneRect, frameLayout, width, theme, adapter, axisPlates, entry, fontSize, half, seen }) {
  const pane = paneRect.pane;
  const scale = pane.priceScales.get(layout.scaleId);
  // A scale with no visible non-overlay column paints no plate; the anchor stays listed in the layout.
  if (!scale || !scale.visible || scale.overlay) return;
  const column = axisColumns(pane, scale.side, frameLayout, width).find(candidate => candidate.scale === scale);
  if (!column) return;
  const y = adapter.priceToY(label.price, binding);
  if (y === null || y - half < paneRect.y || y + half > paneRect.y + paneRect.height) return;
  const text = adapter.formatPrice(label.price, binding);
  const textWidth = ctx.measureText(text).width + 10;
  if (textWidth > column.width) return;
  const left = scale.side === 'right' ? column.x : column.x + column.width - textWidth;
  const top = y - half;
  const rect = { left, top, width: textWidth, height: 2 * half };
  // The live price is the more important number; a selected drawing is what the user edits, so it wins.
  if (!entry.selected && axisPlates.some(plate => plate.paneId === layout.paneId && plate.side === scale.side && intersects(rect, plate))) return;
  const key = `price:${scale.side}:${column.x}:${Math.round(top)}:${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  paintPlate(ctx, { rect, text, theme, color: layout.style.color, fontSize });
}

function drawTimePlate(ctx, { label, layout, binding, paneRect, frameLayout, theme, adapter, timeFormatter, presentation, reportError, reported, entry, fontSize, half, seen }) {
  void entry;
  // A derived pane reads ordinals in its own strip, exactly like its index strip.
  const derived = paneRect.axisStrip !== null && paneRect.axisStrip !== undefined;
  const axis = derived ? paneRect.axisStrip : frameLayout.timeAxis;
  if (!axis || axis.height <= 0) return;
  if (label.unavailable !== undefined) return;
  const x = adapter.logicalToX(label.logical, binding);
  if (x === null || x < 0 || x > frameLayout.plotWidth) return;
  const text = derived
    ? String(label.logical + 1)
    : timePlateText(label, binding, adapter, { timeFormatter, presentation, reportError, reported });
  if (text === null) return;
  const textWidth = ctx.measureText(text).width + 10;
  if (textWidth > axis.width) return;
  const left = Math.max(axis.x, Math.min(axis.x + x - textWidth / 2, axis.x + axis.width - textWidth));
  const rect = { left, top: axis.y, width: textWidth, height: 2 * half };
  const key = `time:${axis.y}:${Math.round(left)}:${text}`;
  if (seen.has(key)) return;
  seen.add(key);
  paintPlate(ctx, { rect, text, theme, color: layout.style.color, fontSize });
}

// A host formatter failure is reported once per frame and omits only that plate.
function timePlateText(label, binding, adapter, { timeFormatter, presentation, reportError, reported }) {
  const slot = adapter.getSlot(label.logical, binding);
  const time = slot && typeof slot.time === 'number' ? slot.time : null;
  if (time === null) return null;
  try {
    return axisTimeText(time, presentation, timeFormatter, slot);
  } catch (error) {
    if (!reported.has(error.message)) {
      reported.add(error.message);
      reportError(error);
    }
    return null;
  }
}

function paintPlate(ctx, { rect, text, theme, color, fontSize }) {
  ctx.fillStyle = theme.lastValueBackground;
  ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
  if (color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(rect.left + 0.5, rect.top + 0.5, rect.width - 1, rect.height - 1);
  }
  ctx.fillStyle = theme.lastValueText;
  ctx.fillText(text, rect.left + 5, rect.top + rect.height / 2);
  void fontSize;
}
