import { buildBaselineSegments, splitByGaps } from './geometry.js';

export function colorForCandle(point, options, theme) {
  const up = options.upColor ?? theme.up;
  const down = options.downColor ?? theme.down;
  if (point.close > point.open) return up;
  if (point.close < point.open) return down;
  return options.equalColor ?? theme.equal;
}

export function drawCandles(ctx, { points, xOf, yOf, barSpacing, options, theme }) {
  const bodyWidth = Math.max(1, Math.min(barSpacing * 0.7, 24));
  const borderVisible = options.borderVisible !== false;
  const wickVisible = options.wickVisible !== false;
  for (const point of points) {
    const x = xOf(point.index);
    const color = colorForCandle(point, options, theme);
    const yOpen = yOf(point.open);
    const yClose = yOf(point.close);
    const yHigh = yOf(point.high);
    const yLow = yOf(point.low);
    if (wickVisible) {
      const wickColor =
        point.close > point.open
          ? options.wickUpColor ?? theme.wickUp
          : point.close < point.open
            ? options.wickDownColor ?? theme.wickDown
            : options.wickEqualColor ?? theme.equal;
      ctx.strokeStyle = wickColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();
    }
    const top = Math.min(yOpen, yClose);
    const height = Math.max(1, Math.abs(yClose - yOpen));
    const left = x - bodyWidth / 2;
    if (borderVisible) {
      const borderColor =
        point.close > point.open
          ? options.borderUpColor ?? theme.borderUp
          : point.close < point.open
            ? options.borderDownColor ?? theme.borderDown
            : options.borderEqualColor ?? theme.equal;
      ctx.fillStyle = color;
      ctx.fillRect(left, top, bodyWidth, height);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(left + 0.5, top + 0.5, Math.max(0, bodyWidth - 1), Math.max(0, height - 1));
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(left, top, bodyWidth, height);
    }
  }
}

export function drawBars(ctx, { points, xOf, yOf, barSpacing, options, theme }) {
  const tick = Math.max(2, Math.min(barSpacing * 0.35, 10));
  for (const point of points) {
    const x = xOf(point.index);
    const color =
      point.close > point.open
        ? options.upColor ?? theme.up
        : point.close < point.open
          ? options.downColor ?? theme.down
          : options.equalColor ?? theme.equal;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    const yHigh = yOf(point.high);
    const yLow = yOf(point.low);
    ctx.beginPath();
    ctx.moveTo(x, yHigh);
    ctx.lineTo(x, yLow);
    ctx.moveTo(x - tick, yOf(point.open));
    ctx.lineTo(x, yOf(point.open));
    ctx.moveTo(x, yOf(point.close));
    ctx.lineTo(x + tick, yOf(point.close));
    ctx.stroke();
  }
}

function strokePath(ctx, points, xOf, yOf) {
  ctx.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const x = xOf(points[i].index);
    const y = yOf(points[i].value);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

export function drawLine(ctx, { points, xOf, yOf, options, theme }) {
  const segments = splitByGaps(points);
  ctx.strokeStyle = options.color ?? theme.areaLine;
  ctx.lineWidth = options.lineWidth ?? 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const segment of segments) {
    if (segment.length < 2) continue;
    strokePath(ctx, segment, xOf, yOf);
    ctx.stroke();
  }
}

export function drawHistogram(ctx, { points, xOf, yOf, barSpacing, options, theme, paneRect }) {
  const width = Math.max(1, Math.min(barSpacing * 0.7, 24));
  const zeroY = Math.min(paneRect.y + paneRect.height, Math.max(paneRect.y, yOf(0)));
  const baseColor = options.color ?? theme.volume;
  const signed = options.upColor !== undefined && options.downColor !== undefined;
  for (const point of points) {
    ctx.fillStyle = signed ? (point.value >= 0 ? options.upColor : options.downColor) : baseColor;
    const x = xOf(point.index);
    const y = Math.min(paneRect.y + paneRect.height, Math.max(paneRect.y, yOf(point.value)));
    const top = Math.min(zeroY, y);
    const height = Math.max(1, Math.abs(zeroY - y));
    ctx.fillRect(x - width / 2, top, width, height);
  }
}

export function drawArea(ctx, { points, xOf, yOf, options, theme, paneRect }) {
  const segments = splitByGaps(points);
  const basePrice = options.basePrice;
  const baseY = Math.min(
    paneRect.y + paneRect.height,
    Math.max(paneRect.y, yOf(basePrice))
  );
  const lineColor = options.lineColor ?? theme.areaLine;
  const fillColor = options.fillColor ?? theme.areaFill;
  for (const segment of segments) {
    if (segment.length < 2) continue;
    strokePath(ctx, segment, xOf, yOf);
    const last = segment[segment.length - 1];
    const first = segment[0];
    ctx.lineTo(xOf(last.index), baseY);
    ctx.lineTo(xOf(first.index), baseY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    strokePath(ctx, segment, xOf, yOf);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = options.lineWidth ?? 2;
    ctx.stroke();
  }
}

export function drawBaseline(ctx, { points, xOf, yOf, options, theme, paneRect }) {
  const basePrice = options.basePrice;
  const baseY = Math.min(
    paneRect.y + paneRect.height,
    Math.max(paneRect.y, yOf(basePrice))
  );
  const segments = buildBaselineSegments(points, basePrice);
  for (const segment of segments) {
    if (segment.points.length < 2) continue;
    const lineColor =
      segment.side === 'above'
        ? options.aboveLineColor ?? theme.baselineAboveLine
        : options.belowLineColor ?? theme.baselineBelowLine;
    const fillColor =
      segment.side === 'above'
        ? options.aboveFillColor ?? theme.baselineAboveFill
        : options.belowFillColor ?? theme.baselineBelowFill;
    strokePath(ctx, segment.points, xOf, yOf);
    const first = segment.points[0];
    const last = segment.points[segment.points.length - 1];
    ctx.lineTo(xOf(last.index), baseY);
    ctx.lineTo(xOf(first.index), baseY);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    strokePath(ctx, segment.points, xOf, yOf);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = options.lineWidth ?? 2;
    ctx.stroke();
  }
}

export function drawSeries(ctx, context) {
  switch (context.series.type) {
    case 'candlestick':
      drawCandles(ctx, context);
      break;
    case 'bar':
      drawBars(ctx, context);
      break;
    case 'line':
      drawLine(ctx, context);
      break;
    case 'histogram':
      drawHistogram(ctx, context);
      break;
    case 'area':
      drawArea(ctx, context);
      break;
    case 'baseline':
      drawBaseline(ctx, context);
      break;
    default:
      break;
  }
}
