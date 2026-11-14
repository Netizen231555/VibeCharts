export const AXIS_WIDTH = 64;
export const TIME_AXIS_HEIGHT = 22;

/**
 * Computes plot rectangles from the current pane/scale structure.
 * Pure function: no DOM, no chart mutation.
 */
export function computeLayout({ width, height, panes, timeScaleVisible = true, derivedPaneIds = null }) {
  const timeAxisHeight = timeScaleVisible ? TIME_AXIS_HEIGHT : 0;
  const plotHeight = Math.max(0, height - timeAxisHeight);
  const visible = panes
    .filter((pane) => pane.visible !== false)
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const effective = visible.length > 0 ? visible : panes.slice(0, 1);
  const weights = effective.map((pane) => (Number.isFinite(pane.height) && pane.height > 0 ? pane.height : 1));
  const weightSum = weights.reduce((sum, value) => sum + value, 0) || 1;

  let leftColumns = 0;
  let rightColumns = 0;
  for (const pane of effective) {
    let left = 0;
    let right = 0;
    for (const scale of pane.priceScales.values()) {
      if (!scale.visible || scale.overlay) continue;
      if (scale.side === 'left') left += 1;
      else right += 1;
    }
    leftColumns = Math.max(leftColumns, left);
    rightColumns = Math.max(rightColumns, right);
  }

  const leftWidth = leftColumns * AXIS_WIDTH;
  const rightWidth = rightColumns * AXIS_WIDTH;
  const plotX = leftWidth;
  const plotWidth = Math.max(0, width - leftWidth - rightWidth);

  let y = 0;
  const paneRects = effective.map((pane, index) => {
    const paneHeight = (weights[index] / weightSum) * plotHeight;
    // A pane with its own derived x-axis reserves a strip at its bottom for ordinal labels.
    const stripHeight = derivedPaneIds?.has(pane.id) ? Math.min(TIME_AXIS_HEIGHT, paneHeight) : 0;
    const rect = {
      pane,
      x: plotX,
      y,
      width: plotWidth,
      height: paneHeight - stripHeight,
      axisStrip: stripHeight > 0
        ? { x: plotX, y: y + paneHeight - stripHeight, width: plotWidth, height: stripHeight }
        : null
    };
    y += paneHeight;
    return rect;
  });

  return {
    width,
    height,
    leftWidth,
    rightWidth,
    plotX,
    plotWidth,
    plotHeight,
    timeAxis: { x: plotX, y: plotHeight, width: plotWidth, height: timeAxisHeight },
    panes: paneRects
  };
}

/**
 * Axis column rectangles for one pane and side, ordered from the outer edge.
 */
export function axisColumns(pane, side, layout, width) {
  const columns = [];
  let offset = 0;
  for (const scale of pane.priceScales.values()) {
    if (!scale.visible || scale.overlay || scale.side !== side) continue;
    if (side === 'right') {
      columns.push({ scale, x: width - offset - AXIS_WIDTH, width: AXIS_WIDTH });
    } else {
      columns.push({ scale, x: offset, width: AXIS_WIDTH });
    }
    offset += AXIS_WIDTH;
  }
  return columns;
}
