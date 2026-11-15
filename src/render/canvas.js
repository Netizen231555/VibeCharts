import { commonPriceStep, drawCountdown, drawCrosshair, drawGrid, drawIndexStrip, drawLastValueLabels, drawPriceAxis, drawPriceLine, drawTimeAxis, resolveTimeTicks } from './axes.js';
import { axisColumns, computeLayout } from './layout.js';
import { drawDerivedViews } from './derived-renderers.js';
import { colorForCandle, drawSeries } from './series-renderers.js';

export function computeBufferSize(width, height, dpr) {
  return {
    width: Math.max(0, Math.round(width * dpr)),
    height: Math.max(0, Math.round(height * dpr))
  };
}

function pointIndex(timeline, point) {
  return timeline.indexOf(point.barId);
}

function lastValue(series) {
  const point = series.lastPoint();
  if (!point) return null;
  if ('value' in point) return point.value;
  return point.close;
}

/** Colour of the last value by direction; `null` when it is undefined (single point, missing data), which keeps the neutral colour. */
function directionColor(series, theme) {
  const points = series._points;
  const last = points[points.length - 1];
  if (!last) return null;
  const options = series._options;
  if (typeof last.open === 'number' && typeof last.close === 'number') return colorForCandle(last, options, theme);
  if (typeof last.value !== 'number') return null;
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const previous = points[i].value;
    if (typeof previous !== 'number') continue;
    if (last.value > previous) return theme.up;
    if (last.value < previous) return theme.down;
    return theme.equal;
  }
  return null;
}

function lastValueColor(series, theme) {
  return series._options.lastValueColorMode === 'direction' ? directionColor(series, theme) : null;
}

/** Short conflict note in the pane corner, truncated to the plot width. */
function drawConflictNote(ctx, { layout, paneRect, text, theme, options }) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.plotX, paneRect.y, layout.plotWidth, paneRect.height);
  ctx.clip();
  ctx.fillStyle = theme.mutedText;
  ctx.font = `${options.fontSize ?? 12}px ${options.fontFamily ?? 'sans-serif'}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const maxWidth = Math.max(0, layout.plotWidth - 16);
  let shown = text;
  if (ctx.measureText(shown).width > maxWidth) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > maxWidth) shown = shown.slice(0, -1);
    shown = `${shown}…`;
  }
  ctx.fillText(shown, layout.plotX + 8, paneRect.y + 6);
  ctx.restore();
}

function drawPane(ctx, chart, layout, paneRect, theme, options, timeTicks, placed) {
  const { pane } = paneRect;
  const xContext = chart._paneXContext(pane);
  const derived = xContext.kind === 'derived' ? xContext.view : null;
  const indexScale = xContext.scale;
  const timeline = chart._timeline;
  const visible = indexScale.getVisibleRange();
  for (const scale of pane.priceScales.values()) scale.setHeight(paneRect.height);

  const firstVisibleScale =
    [...pane.priceScales.values()].find((scale) => scale.visible && !scale.overlay) ?? null;
  const watermark = options.watermark;
  if (paneRect === layout.panes[0] && watermark.visible && watermark.text !== '') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.plotX, paneRect.y, layout.plotWidth, paneRect.height);
    ctx.clip();
    // Alpha is applied only to the theme fallback; an explicit colour is drawn as given.
    if (watermark.color === null) ctx.globalAlpha = 0.07;
    ctx.fillStyle = watermark.color ?? theme.text;
    ctx.font = `bold ${watermark.fontSize}px ${options.layout.fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(watermark.text, layout.plotX + layout.plotWidth / 2, paneRect.y + paneRect.height / 2);
    ctx.restore();
  }
  if (!derived && options.sessions.visible && visible && options.sessions.starts.length) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.plotX, paneRect.y, layout.plotWidth, paneRect.height);
    ctx.clip();
    ctx.strokeStyle = options.sessions.color ?? theme.axisBorder;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const barId of options.sessions.starts) {
      const index = timeline.indexOf(barId);
      if (index === null) continue;
      const x = indexScale.logicalToCoordinate(index - 0.5);
      if (x === null || x < 0 || x > layout.plotWidth) continue;
      ctx.moveTo(layout.plotX + x, paneRect.y);
      ctx.lineTo(layout.plotX + x, paneRect.y + paneRect.height);
    }
    ctx.stroke();
    ctx.restore();
  }

  if (firstVisibleScale) {
    drawGrid(ctx, {
      layout,
      paneRect,
      priceScale: firstVisibleScale,
      indexScale,
      theme,
      grid: options.grid,
      priceOptions: options.priceScale,
      timeTicks: derived ? null : timeTicks
    });
  }

  if (visible) {
    const fromIndex = Math.max(0, Math.floor(visible.from) - 1);
    const toIndex = Math.min(indexScale.length - 1, Math.ceil(visible.to) + 1);
    ctx.save();
    ctx.beginPath();
    ctx.rect(layout.plotX, paneRect.y, layout.plotWidth, paneRect.height);
    ctx.clip();
    for (const series of pane.series) {
      if (derived) continue;
      const scale = pane.priceScales.get(series.priceScaleId);
      if (!scale || !(scale.visible || scale.overlay) || series._options.visible === false) continue;
      const points = [];
      for (const point of series._pointsInRange(fromIndex, toIndex)) {
        const index = pointIndex(timeline, point);
        if (index === null) continue;
        points.push({ ...point, index });
      }
      drawSeries(ctx, {
        series,
        points,
        xOf: (index) => layout.plotX + indexScale.logicalToCoordinate(index),
        yOf: (value) => paneRect.y + scale.priceToCoordinate(value),
        barSpacing: indexScale.barSpacing,
        options: series._options,
        theme,
        paneRect
      });
    }
    for (const series of pane.series) {
      if (derived) continue;
      const line = series._options.priceLine;
      if (!line || line.visible === false || series._options.visible === false) continue;
      const scale = pane.priceScales.get(series.priceScaleId);
      if (!scale || !(scale.visible || scale.overlay)) continue;
      const value = lastValue(series);
      if (value === null) continue;
      const y = scale.priceToCoordinate(value);
      if (y === null || y < 0 || y > paneRect.height) continue;
      drawPriceLine(ctx, { layout, paneRect, y, line, color: lastValueColor(series, theme), theme });
    }
    drawDerivedViews(ctx, { chart, paneRect, layout, theme });
    ctx.restore();
  }

  if (derived) {
    drawIndexStrip(ctx, {
      layout,
      strip: paneRect.axisStrip,
      indexScale,
      theme,
      options: options.layout,
      timeOptions: options.timeScale
    });
  } else if (xContext.kind === 'conflict') {
    drawConflictNote(ctx, { layout, paneRect, text: xContext.conflict, theme, options: options.layout });
  }

  const labels = [];
  const ticks = [];
  for (const side of ['left', 'right']) {
    const columns = axisColumns(pane, side, layout, layout.width);
    for (const column of columns) {
      let metadata = null;
      let hasProvider = false;
      const steps = [];
      for (const series of pane.series) {
        if (series.priceScaleId !== column.scale.name || series._options.visible === false) continue;
        if (!hasProvider) {
          metadata = series._metadata;
          hasProvider = true;
        }
        steps.push(series._metadata?.priceStep);
      }
      if (metadata && commonPriceStep(steps) === null) metadata = { ...metadata, priceStep: undefined };
      ticks.push(...drawPriceAxis(ctx, {
        paneRect, column, theme, priceOptions: options.priceScale, metadata
      }));
    }
    for (const column of columns) {
      for (const series of pane.series) {
        if (series.priceScaleId !== column.scale.name) continue;
        if (series._options.lastValueVisible === false || series._options.visible === false) continue;
        const value = lastValue(series);
        if (value === null) continue;
        const y = column.scale.priceToCoordinate(value);
        if (y === null) continue;
        labels.push({
          x: side === 'right' ? column.x : column.x + column.width,
          columnWidth: column.width,
          paneId: pane.id,
          scaleId: column.scale.name,
          seriesId: series.id,
          side,
          y,
          value,
          priceScale: column.scale,
          metadata: series._metadata,
          color: lastValueColor(series, theme)
        });
      }
    }
  }
  labels.push(...ticks);
  return drawLastValueLabels(ctx, {
    labels,
    paneRect,
    theme,
    options: options.layout,
    priceOptions: options.priceScale,
    locale: options.locale,
    placed
  });
}

/**
 * Main canvas renderer. Receives a 2D context already scaled for DPR and the
 * chart model; performs no DOM work and never fabricates bars or times.
 */
export function drawChart(ctx, chart, { width, height }, now = Date.now()) {
  const options = chart._options;
  const theme = chart._theme;
  ctx.save();
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.layout.background ?? theme.background;
  ctx.fillRect(0, 0, width, height);

  if (width <= 0 || height <= 0) {
    chart._axisPlates = [];
    ctx.restore();
    return;
  }

  const derivedPaneIds = chart._derivedPaneIds();
  const layout = computeLayout({
    width,
    height,
    panes: chart._panes,
    timeScaleVisible: options.timeScale.visible,
    derivedPaneIds
  });

  // The global time axis follows the source scale and exists only while a source-axis pane is visible.
  const indexScale = chart._indexScale;
  const hasSourcePane = layout.panes.some((rect) => !derivedPaneIds.has(rect.pane.id));
  const timeTicks = hasSourcePane
    ? resolveTimeTicks({ timeline: chart._timeline, indexScale, timeOptions: options.timeScale, timeZone: options.timeZone })
    : null;
  const overflow = [];
  const placedLabels = [];
  // Placed last-price plate rectangles of this frame, published for the drawing axis-label pass (internal,
  // replaced every frame, empty when none).
  chart._axisPlates = placedLabels;
  for (const paneRect of layout.panes) {
    overflow.push(...drawPane(ctx, chart, layout, paneRect, theme, options, timeTicks, placedLabels));
  }

  drawTimeAxis(ctx, {
    layout,
    indexScale,
    timeline: chart._timeline,
    theme,
    options: options.layout,
    timeOptions: options.timeScale,
    locale: options.locale,
    timeZone: options.timeZone,
    slotLabel: options.timeScale.slotLabel,
    chart,
    ticks: timeTicks,
    labels: hasSourcePane
  });
  if (chart._destroyed) {
    ctx.restore();
    return;
  }

  const crosshair = chart._crosshair;
  if (crosshair) {
    const paneRect = layout.panes.find((rect) => rect.pane === crosshair.pane);
    const xContext = chart._paneXContext(crosshair.pane);
    // A source crosshair spans every source-axis pane; a derived one stays in its own pane.
    const verticalRects = xContext.kind === 'derived'
      ? (paneRect ? [paneRect] : [])
      : layout.panes.filter((rect) => !derivedPaneIds.has(rect.pane.id));
    const scale = crosshair.pane
      ? [...crosshair.pane.priceScales.values()].find((candidate) => candidate.visible && !candidate.overlay) ?? null
      : null;
    drawCrosshair(ctx, {
      layout,
      paneRects: layout.panes,
      verticalRects,
      indexScale: xContext.scale,
      crosshair,
      priceScale: scale,
      theme,
      options: options.crosshair
    });
  }

  if (options.countdown.visible && chart._countdown) {
    drawCountdown(ctx, {
      layout,
      countdown: chart._countdown,
      theme,
      options: options.layout,
      placement: options.countdown.placement,
      anchor: placedLabels.find((entry) => entry.side === 'right') ?? placedLabels[0] ?? null,
      now
    });
  }

  ctx.restore();
  return overflow;
}
