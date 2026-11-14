import { drawCandles } from './series-renderers.js';

function elementIndex(view, element) {
  return view.indexScale().barIdToIndex(element.id);
}

function highlight(ctx, theme, x, y, width, height) {
  ctx.save();
  ctx.strokeStyle = theme.text;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - width / 2, y - height / 2, width, height);
  ctx.restore();
}

/**
 * Draws derived views on their own index scale. Heikin Ashi stays on the source
 * index scale; Renko/Kagi/P&F use the view's independent element positions.
 */
export function drawDerivedView(ctx, { view, chart, layout, paneRect, theme }) {
  const selection = view.getSelection();
  const selectedId = selection.resolved ? selection.elementId : null;
  const scale = paneRect.pane.priceScales.get(view._source.priceScaleId);
  if (!scale?.visible) return;

  if (view.type === 'heikinAshi') {
    const elements = view.elements();
    const points = [];
    for (const element of elements) {
      const index = chart._timeline.indexOf(element.completionBarId);
      if (index === null) continue;
      points.push({
        index,
        open: element.open,
        high: element.high,
        low: element.low,
        close: element.close
      });
    }
    drawCandles(ctx, {
      points,
      xOf: (index) => layout.plotX + chart._indexScale.indexToCoordinate(index),
      yOf: (value) => paneRect.y + scale.priceToCoordinate(value),
      barSpacing: chart._indexScale.barSpacing,
      options: view._source._options,
      theme
    });
    return;
  }

  const derivedScale = view.indexScale();
  const xOf = (index) => layout.plotX + derivedScale.indexToCoordinate(index);
  const yOf = (value) => paneRect.y + scale.priceToCoordinate(value);

  if (view.type === 'renko') {
    const points = [];
    for (const element of view.elements()) {
      const index = elementIndex(view, element);
      if (index === null) continue;
      points.push({
        index,
        open: element.open,
        high: element.high,
        low: element.low,
        close: element.close
      });
    }
    drawCandles(ctx, {
      points,
      xOf,
      yOf,
      barSpacing: derivedScale.barSpacing,
      options: {},
      theme
    });
    if (selectedId !== null) {
      const element = view.element(selectedId);
      const index = element ? elementIndex(view, element) : null;
      if (index !== null) {
        highlight(ctx, theme, xOf(index), yOf(element.close), Math.max(4, derivedScale.barSpacing * 0.7), 14);
      }
    }
    return;
  }

  if (view.type === 'kagi') {
    const elements = view.elements();
    ctx.save();
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      const x = xOf(i);
      const prevX = i === 0 ? layout.plotX + derivedScale.logicalToCoordinate(-0.5) : xOf(i - 1);
      const color = element.direction === 'up' ? theme.up : theme.down;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(prevX, yOf(element.fromPrice));
      ctx.lineTo(x, yOf(element.toPrice));
      ctx.stroke();
      if (selectedId === element.id) {
        ctx.strokeStyle = theme.text;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(prevX, yOf(element.fromPrice));
        ctx.lineTo(x, yOf(element.toPrice));
        ctx.stroke();
        ctx.lineWidth = 2;
      }
    }
    ctx.restore();
    return;
  }

  if (view.type === 'pointAndFigure') {
    const elements = view.elements();
    const size = Math.max(4, Math.min(derivedScale.barSpacing * 0.7, 20));
    ctx.save();
    ctx.font = `${Math.max(8, size)}px ${theme.fontFamily ?? 'sans-serif'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < elements.length; i += 1) {
      const element = elements[i];
      const x = xOf(i);
      const y = yOf(element.level);
      ctx.strokeStyle = element.kind === 'X' ? theme.up : theme.down;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 1.5;
      if (element.kind === 'X') {
        ctx.beginPath();
        ctx.moveTo(x - size / 2, y - size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.moveTo(x + size / 2, y - size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (selectedId === element.id) {
        highlight(ctx, theme, x, y, size + 4, size + 4);
      }
    }
    ctx.restore();
  }
}

/**
 * Draws the derived views of one pane. Independent views are drawn only when the
 * pane owns their axis (`kind === 'derived'`); in a conflict pane they stay hidden
 * instead of drifting on the source axis.
 */
export function drawDerivedViews(ctx, context) {
  const pane = context.paneRect.pane;
  const xContext = context.chart._paneXContext(pane);
  for (const view of context.chart._derivedViews.values()) {
    if (!view.visible || view._source.pane !== pane) continue;
    if (view.type !== 'heikinAshi' && view !== (xContext.kind === 'derived' ? xContext.view : null)) continue;
    drawDerivedView(ctx, { ...context, view });
  }
}
