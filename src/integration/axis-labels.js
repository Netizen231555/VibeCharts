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
  const seen = new Map();
  const plates = [];
  const enqueue = (key, selected, plate) => {
    const previous = seen.get(key);
    if (previous !== undefined) {
      if (!selected || plates[previous].selected) return;
      plates[previous] = null;
    }
    seen.set(key, plates.length);
    plates.push({ ...plate, selected });
  };
  const reported = new Set();
  const priceTexts = new Map();
  const timeTexts = new Map();
  const textWidths = new Map();
  const textWidth = text => {
    if (!textWidths.has(text)) textWidths.set(text, ctx.measureText(text).width + 10);
    return textWidths.get(text);
  };
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
        if (label.axis === 'price') drawPricePlate(ctx, { label, layout, binding, paneRect, frameLayout, width, theme, adapter, axisPlates, entry, fontSize, half, enqueue, priceTexts, textWidth });
        else if (label.axis === 'time') drawTimePlate(ctx, { label, layout, binding, paneRect, frameLayout, theme, adapter, timeFormatter, presentation, reportError, reported, entry, fontSize, half, enqueue, timeTexts, textWidth });
      }
    }
    for (const plate of plates) {
      if (!plate) continue;
      if (plate.clip) {
        ctx.save();
        try {
          ctx.beginPath();
          ctx.rect(plate.clip.x, plate.clip.y, plate.clip.width, plate.clip.height);
          ctx.clip();
          paintPlate(ctx, plate);
        } finally {
          ctx.restore();
        }
      } else paintPlate(ctx, plate);
    }
  } finally {
    ctx.restore();
  }
}

function drawPricePlate(ctx, { label, layout, binding, paneRect, frameLayout, width, theme, adapter, axisPlates, entry, fontSize, half, enqueue, priceTexts, textWidth }) {
  const pane = paneRect.pane;
  const scale = pane.priceScales.get(layout.scaleId);
  // A scale with no visible non-overlay column paints no plate; the anchor stays listed in the layout.
  if (!scale || !scale.visible || scale.overlay) return;
  const column = axisColumns(pane, scale.side, frameLayout, width).find(candidate => candidate.scale === scale);
  if (!column) return;
  const y = adapter.priceToY(label.price, binding);
  if (y === null || y < paneRect.y || y > paneRect.y + paneRect.height) return;
  let paneTexts = priceTexts.get(layout.paneId);
  if (!paneTexts) priceTexts.set(layout.paneId, paneTexts = new Map());
  let scaleTexts = paneTexts.get(layout.scaleId);
  if (!scaleTexts) paneTexts.set(layout.scaleId, scaleTexts = new Map());
  if (!scaleTexts.has(label.price)) scaleTexts.set(label.price, adapter.formatPrice(label.price, binding));
  const text = scaleTexts.get(label.price);
  const plateWidth = textWidth(text);
  if (plateWidth > column.width) return;
  const left = scale.side === 'right' ? column.x : column.x + column.width - plateWidth;
  const top = y - half;
  const rect = { left, top, width: plateWidth, height: 2 * half };
  // The live price is the more important number; a selected drawing is what the user edits, so it wins.
  if (!entry.selected && axisPlates.some(plate => plate.paneId === layout.paneId && plate.side === scale.side && intersects(rect, plate))) return;
  const key = `price:${scale.side}:${column.x}:${Math.round(top)}:${text}`;
  enqueue(key, entry.selected, { rect, text, theme, color: layout.style.color, fontSize,
    clip: { x: column.x, y: paneRect.y, width: column.width, height: paneRect.height } });
}

function drawTimePlate(ctx, { label, layout, binding, paneRect, frameLayout, theme, adapter, timeFormatter, presentation, reportError, reported, entry, fontSize, half, enqueue, timeTexts, textWidth }) {
  // A derived pane reads ordinals in its own strip, exactly like its index strip.
  const derived = paneRect.axisStrip !== null && paneRect.axisStrip !== undefined;
  const axis = derived ? paneRect.axisStrip : frameLayout.timeAxis;
  if (!axis || axis.height <= 0) return;
  if (label.unavailable !== undefined) return;
  const x = adapter.logicalToX(label.logical, binding);
  if (x === null || x < axis.x || x > axis.x + axis.width) return;
  const text = derived
    ? String(label.logical + 1)
    : timePlateText(label, binding, adapter, { timeFormatter, presentation, reportError, reported, timeTexts });
  if (text === null) return;
  const plateWidth = textWidth(text);
  if (plateWidth > axis.width) return;
  const left = Math.max(axis.x, Math.min(x - plateWidth / 2, axis.x + axis.width - plateWidth));
  const rect = { left, top: axis.y, width: plateWidth, height: 2 * half };
  const key = `time:${axis.y}:${Math.round(left)}:${text}`;
  enqueue(key, entry.selected, { rect, text, theme, color: layout.style.color, fontSize });
}

// A host formatter failure is reported once per frame and omits only that plate.
function timePlateText(label, binding, adapter, { timeFormatter, presentation, reportError, reported, timeTexts }) {
  const slot = adapter.getSlot(label.logical, binding);
  const time = slot && typeof slot.time === 'number' ? slot.time : null;
  if (time === null) return null;
  try {
    if (timeFormatter) return axisTimeText(time, presentation, timeFormatter, slot);
    if (!timeTexts.has(time)) timeTexts.set(time, axisTimeText(time, presentation, null, slot));
    return timeTexts.get(time);
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
