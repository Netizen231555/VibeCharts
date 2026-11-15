import { indexTicks, niceTicks } from './geometry.js';
import { computeTimeTicks, formatTickLabel, isEmphasized } from './time-ticks.js';

/**
 * Calendar-aligned ticks for the current frame, or null when the chart uses
 * index ticks (default mode, or a visible slot without time).
 */
export function resolveTimeTicks({ timeline, indexScale, timeOptions, timeZone }) {
  if (timeOptions?.tickMode !== 'time') return null;
  const visible = indexScale.getVisibleRange();
  if (!visible) return null;
  return computeTimeTicks({ timeline, from: visible.from, to: visible.to, barSpacing: indexScale.barSpacing, minPixels: 84, timeZone });
}

const formatterCache = new Map();

function timeFormatter(locale, timeZone) {
  const key = `${locale}|${timeZone}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatTime(time, locale, timeZone) {
  try {
    return timeFormatter(locale, timeZone).format(new Date(time));
  } catch {
    return '';
  }
}

export function priceDecimals(priceStep) {
  if (typeof priceStep !== 'number' || !(priceStep > 0)) return null;
  const text = String(priceStep);
  if (text.includes('e-')) {
    const [mantissa, exponent] = text.split('e-');
    return Number(exponent) + (mantissa.split('.')[1]?.length ?? 0);
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

// Number formatters are cached: labelled axis plates and badges format many values per frame, and locales
// with fixed decimals are few. Bounded, so a host flipping locales forever cannot grow it.
const NUMBER_FORMATTER_LIMIT = 64;
const numberFormatterCache = new Map();

export function numberFormatter(locale, decimals) {
  const key = `${locale}|${decimals}`;
  let formatter = numberFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (numberFormatterCache.size >= NUMBER_FORMATTER_LIMIT) numberFormatterCache.delete(numberFormatterCache.keys().next().value);
    numberFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatPrice(value, { priceScale, metadata, locale = 'en-US' } = {}) {
  let display = value;
  let suffix = '';
  if (priceScale?.mode === 'percent') {
    display = priceScale._percent(value);
    suffix = '%';
  }
  const decimals = priceScale?.mode === 'percent' ? null : priceDecimals(metadata?.priceStep);
  let text;
  if (decimals === null) {
    text = String(display);
  } else {
    try {
      text = numberFormatter(locale, decimals).format(display);
    } catch {
      text = String(display);
    }
  }
  if (suffix) text += suffix;
  else if (metadata?.priceUnit === 'percent') text += '%';
  else {
    if (metadata?.priceUnit) text += ` ${metadata.priceUnit}`;
    if (metadata?.currency && metadata.currency !== metadata.priceUnit) text += ` ${metadata.currency}`;
  }
  return text;
}

/** One place decides the price label count, so the horizontal grid and the axis ticks agree. */
export function priceTickTarget(height, priceOptions) {
  const spacing = priceOptions?.tickSpacing ?? null;
  if (spacing === null) return 5;
  return Math.max(2, Math.min(20, Math.round(height / spacing)));
}

export function drawGrid(ctx, { layout, paneRect, priceScale, indexScale, theme, grid, priceOptions = null, timeTicks = null }) {
  if (!grid.visible) return;
  const range = priceScale.getVisibleRange();
  ctx.save();
  ctx.strokeStyle = grid.color ?? theme.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (range) {
    for (const tick of niceTicks(range.min, range.max, priceTickTarget(paneRect.height, priceOptions))) {
      const y = priceScale.priceToCoordinate(tick);
      if (y === null || y < 0 || y > paneRect.height) continue;
      ctx.moveTo(layout.plotX, paneRect.y + y + 0.5);
      ctx.lineTo(layout.plotX + layout.plotWidth, paneRect.y + y + 0.5);
    }
  }
  const visible = indexScale.getVisibleRange();
  if (visible) {
    const ticks = timeTicks
      ? timeTicks.ticks.map((tick) => tick.index)
      : indexTicks(Math.max(visible.from, -1), Math.min(visible.to, indexScale.length), indexScale.barSpacing);
    for (const index of ticks) {
      const x = indexScale.indexToCoordinate(index);
      if (x === null) continue;
      ctx.moveTo(layout.plotX + x + 0.5, paneRect.y);
      ctx.lineTo(layout.plotX + x + 0.5, paneRect.y + paneRect.height);
    }
  }
  ctx.stroke();
  ctx.restore();
}

export function drawPriceAxis(ctx, { paneRect, column, theme, priceOptions, metadata }) {
  const priceScale = column.scale;
  const range = priceScale.getVisibleRange();
  ctx.save();
  ctx.strokeStyle = priceOptions?.borderColor ?? theme.axisBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const borderX = priceScale.side === 'right' ? column.x : column.x + column.width;
  ctx.moveTo(borderX + 0.5, paneRect.y);
  ctx.lineTo(borderX + 0.5, paneRect.y + paneRect.height);
  ctx.stroke();
  ctx.restore();
  if (!range) return [];
  return niceTicks(range.min, range.max, priceTickTarget(paneRect.height, priceOptions)).flatMap((value) => {
    const y = priceScale.priceToCoordinate(value);
    if (y === null || y < 0 || y > paneRect.height) return [];
    return [{
      x: borderX, side: priceScale.side, columnWidth: column.width,
      paneId: paneRect.pane.id, scaleId: priceScale.name, seriesId: 'scale tick',
      y, value, priceScale, metadata, kind: 'tick'
    }];
  });
}

export function drawTimeAxis(ctx, { layout, indexScale, timeline, theme, options, timeOptions, locale, timeZone, slotLabel, chart, ticks: timeTicks, labels = true }) {
  const axis = layout.timeAxis;
  if (axis.height <= 0) return;
  ctx.save();
  ctx.strokeStyle = timeOptions?.borderColor ?? theme.axisBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(layout.plotX, axis.y + 0.5);
  ctx.lineTo(layout.plotX + layout.plotWidth, axis.y + 0.5);
  ctx.stroke();

  const visible = labels ? indexScale.getVisibleRange() : null;
  if (visible) {
    const fontSize = options.fontSize ?? 12;
    const fontFamily = options.fontFamily ?? 'sans-serif';
    const regular = `${fontSize}px ${fontFamily}`;
    ctx.fillStyle = timeOptions?.textColor ?? options.textColor ?? theme.mutedText;
    ctx.font = regular;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // `ticks` is passed by the frame renderer; direct callers get the mode's own selection.
    const aligned = timeTicks !== undefined ? timeTicks : resolveTimeTicks({ timeline, indexScale, timeOptions, timeZone });
    const labelFor = (slot, index, fallback) => {
      if (typeof slotLabel !== 'function') return fallback();
      const custom = slotLabel(slot?.barId ?? null, slot, index);
      if (chart?._destroyed) return null;
      if (typeof custom !== 'string') {
        throw new TypeError('timeScale.slotLabel must return a string');
      }
      return custom;
    };
    const entries = aligned
      ? aligned.ticks.map((tick) => ({ index: tick.index, slot: timeline.slotAt(tick.index), bold: isEmphasized(tick, aligned.step), automatic: () => formatTickLabel(tick, { locale, timeZone }) }))
      : indexTicks(Math.max(visible.from, -1), Math.min(visible.to, indexScale.length), indexScale.barSpacing, 84).map((index) => ({ index, slot: timeline.slotAt(index), bold: false, automatic: null }));
    const hasUtcTimeLabel = timeZone === 'UTC' && typeof slotLabel !== 'function'
      && entries.some(({ slot }) => slot && slot.time !== undefined);
    const leftEdge = layout.plotX;
    const rightEdge = leftEdge + layout.plotWidth;
    const utcEnd = hasUtcTimeLabel ? leftEdge + 4 + ctx.measureText('UTC').width + 6 : leftEdge;
    let previousEnd = utcEnd;
    for (const { index, slot, bold, automatic } of entries) {
      const x = indexScale.indexToCoordinate(index);
      if (x === null) continue;
      let text;
      if (automatic) {
        text = labelFor(slot, index, automatic);
        if (text === null) {
          ctx.restore();
          return;
        }
      } else if (typeof slotLabel === 'function') {
        text = labelFor(slot, index, () => '');
        if (text === null) {
          ctx.restore();
          return;
        }
      } else if (slot && slot.time !== undefined) {
        text = formatTime(slot.time, locale, timeZone);
      } else {
        text = String(index);
      }
      ctx.font = bold ? `bold ${regular}` : regular;
      const center = layout.plotX + x;
      const halfWidth = ctx.measureText(text).width / 2;
      if (center - halfWidth < previousEnd || center + halfWidth > rightEdge) continue;
      ctx.fillText(text, center, axis.y + axis.height / 2);
      previousEnd = center + halfWidth + 6;
    }
    ctx.font = regular;
    if (hasUtcTimeLabel) {
      ctx.textAlign = 'left';
      ctx.fillText('UTC', layout.plotX + 4, axis.y + axis.height / 2);
    }
  }
  ctx.restore();
}

/**
 * Bottom strip of a pane that owns a derived x-axis: element ordinals (1-based),
 * never times or dates.
 */
export function drawIndexStrip(ctx, { layout, strip, indexScale, theme, options, timeOptions }) {
  if (!strip || strip.height <= 0) return;
  ctx.save();
  ctx.strokeStyle = timeOptions?.borderColor ?? theme.axisBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(strip.x, strip.y + 0.5);
  ctx.lineTo(strip.x + strip.width, strip.y + 0.5);
  ctx.stroke();
  const visible = indexScale.getVisibleRange();
  if (visible) {
    const fontSize = options.fontSize ?? 12;
    ctx.fillStyle = theme.mutedText;
    ctx.font = `${fontSize}px ${options.fontFamily ?? 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const leftEdge = strip.x;
    const rightEdge = strip.x + strip.width;
    let previousEnd = leftEdge;
    for (const index of indexTicks(Math.max(visible.from, -1), Math.min(visible.to, indexScale.length), indexScale.barSpacing, 84)) {
      if (index < 0 || index >= indexScale.length) continue;
      const x = indexScale.indexToCoordinate(index);
      if (x === null) continue;
      const text = String(index + 1);
      const center = strip.x + x;
      const halfWidth = ctx.measureText(text).width / 2;
      if (center - halfWidth < previousEnd || center + halfWidth > rightEdge) continue;
      ctx.fillText(text, center, strip.y + strip.height / 2);
      previousEnd = center + halfWidth + 6;
    }
  }
  ctx.restore();
}

export function drawCrosshair(ctx, { layout, paneRects, verticalRects = paneRects, indexScale, crosshair, priceScale, theme, options }) {
  if (!crosshair || options.visible === false) return;
  const index = indexScale.barIdToIndex(crosshair.barId);
  if (index === null) return;
  const x =
    typeof crosshair.logical === 'number'
      ? indexScale.logicalToCoordinate(crosshair.logical)
      : indexScale.indexToCoordinate(index);
  if (x === null || x < 0 || x > layout.plotWidth) return;
  const axisX = layout.plotX + x;
  ctx.save();
  ctx.strokeStyle = options.color ?? theme.crosshair;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  for (const rect of verticalRects) {
    ctx.moveTo(axisX + 0.5, rect.y);
    ctx.lineTo(axisX + 0.5, rect.y + rect.height);
  }
  ctx.stroke();
  if (typeof crosshair.price === 'number' && priceScale) {
    const y = priceScale.priceToCoordinate(crosshair.price);
    if (y !== null) {
      for (const paneRect of paneRects) {
        if (paneRect.pane !== crosshair.pane) continue;
        const axisY = paneRect.y + y;
        ctx.beginPath();
        ctx.moveTo(layout.plotX, axisY + 0.5);
        ctx.lineTo(layout.plotX + layout.plotWidth, axisY + 0.5);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/**
 * Place labels in series priority order, returning those that cannot fit for
 * presentation in the accessible overflow list.
 */
export function drawLastValueLabels(ctx, { labels, paneRect, theme, options, priceOptions, locale, placed = null }) {
  const groups = new Map();
  const overflow = [];
  const half = Math.max(18, (options.fontSize ?? 12) + 6) / 2;
  ctx.save();
  ctx.font = `${options.fontSize ?? 12}px ${options.fontFamily ?? 'sans-serif'}`;
  for (const label of labels) {
    const text = formatPrice(label.value, { priceScale: label.priceScale, metadata: label.metadata, locale });
    const width = ctx.measureText(text).width + 10;
    const key = `${label.side}:${label.x}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = []);
    if (width > label.columnWidth || label.y < half || label.y > paneRect.height - half
        || group.some((entry) => Math.abs(entry.y - label.y) < 2 * half)) {
      if (label.kind !== 'tick') {
        overflow.push({ paneId: label.paneId, scaleId: label.scaleId, seriesId: label.seriesId, text });
      }
    } else {
      group.push({ label, text, width, y: label.y });
    }
  }
  for (const group of groups.values()) {
    for (const { label, text, width, y } of group) {
      const left = label.side === 'right' ? label.x : label.x - width;
      if (label.kind !== 'tick') {
        ctx.fillStyle = label.color ?? theme.lastValueBackground;
        ctx.fillRect(left, paneRect.y + y - half, width, 2 * half);
        placed?.push({ paneId: label.paneId, seriesId: label.seriesId, side: label.side, left, top: paneRect.y + y - half, width, height: 2 * half, fill: label.color ?? theme.lastValueBackground });
      }
      ctx.fillStyle = label.kind === 'tick'
        ? (priceOptions?.textColor ?? options.textColor ?? theme.mutedText)
        : (label.color ? '#ffffff' : theme.lastValueText);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, left + 5, paneRect.y + y);
    }
  }
  ctx.restore();
  return overflow;
}

export function drawPriceLine(ctx, { layout, paneRect, y, line, color, theme }) {
  ctx.save();
  ctx.strokeStyle = line.color ?? color ?? theme.mutedText;
  ctx.lineWidth = line.width ?? 1;
  ctx.setLineDash(line.style === 'dashed' ? [6, 4] : line.style === 'dotted' ? [1, 3] : []);
  ctx.beginPath();
  ctx.moveTo(layout.plotX, paneRect.y + y);
  ctx.lineTo(layout.plotX + layout.plotWidth, paneRect.y + y);
  ctx.stroke();
  ctx.restore();
}

function countdownText(remaining) {
  return remaining > 0
    ? `${Math.floor(remaining / 60000)}:${String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')}`
    : '0:00';
}

/** `anchor` is the placed last-price label rect used by `placement: 'label'`; without one nothing is drawn. */
export function drawCountdown(ctx, { layout, countdown, theme, options, placement = 'corner', anchor = null, now = Date.now() }) {
  if (!countdown || countdown.closeTime === undefined) return;
  const remaining = countdown.closeTime - now;
  ctx.save();
  ctx.font = `${options.fontSize ?? 12}px ${options.fontFamily ?? 'sans-serif'}`;
  if (placement === 'label') {
    if (anchor) {
      ctx.fillStyle = anchor.fill;
      ctx.fillRect(anchor.left, anchor.top + anchor.height, anchor.width, anchor.height);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(countdownText(remaining), anchor.left + 5, anchor.top + anchor.height * 1.5);
    }
  } else {
    const text = remaining > 0 ? `closes in ${countdownText(remaining)}` : 'close time reached';
    ctx.fillStyle = theme.mutedText;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, layout.plotX + layout.plotWidth - 8, 6);
  }
  ctx.restore();
}
