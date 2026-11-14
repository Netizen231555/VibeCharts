/**
 * Responsive layout decisions for the chart UI.
 *
 * At 320 CSS pixels with 200% text nothing may be irreversibly clipped: the
 * toolbar wraps, the control row scrolls horizontally instead of hiding
 * controls, and the chart keeps a finite minimum height. The function is pure
 * so the narrow-screen and text-scale behaviour is testable without a browser.
 */
import { InteractionError } from '../interaction/errors.js';
import { clamp, isFiniteNumber } from '../interaction/geometry.js';

export const NARROW_WIDTH = 560;

export function computeResponsiveLayout({ width, textScale = 1, controlCount = 10, minTargetSize = 44, minChartHeight = 160 } = {}) {
  if (!isFiniteNumber(width) || width < 0) {
    throw new InteractionError('width must be a finite non-negative number', { code: 'INVALID_LAYOUT', field: 'width' });
  }
  if (!isFiniteNumber(textScale) || textScale <= 0) {
    throw new InteractionError('textScale must be a finite positive number', { code: 'INVALID_LAYOUT', field: 'textScale' });
  }
  if (!isFiniteNumber(minTargetSize) || minTargetSize <= 0 || !isFiniteNumber(minChartHeight) || minChartHeight <= 0) {
    throw new InteractionError('minTargetSize and minChartHeight must be finite positive numbers', { code: 'INVALID_LAYOUT', field: 'minTargetSize' });
  }
  // Text at 200% needs roughly twice the horizontal room per control.
  const effectiveWidth = width / textScale;
  const controlMinWidth = Math.min(width, Math.ceil(48 * textScale));
  const columns = Math.max(1, Math.floor(effectiveWidth / 48));
  const stacked = effectiveWidth < NARROW_WIDTH;
  const scrollX = stacked;
  const chartMinHeight = Math.max(minChartHeight, Math.ceil(minChartHeight / textScale));
  const toolbarRows = Math.max(1, Math.ceil(controlCount / Math.max(1, columns)));
  return {
    width,
    textScale,
    effectiveWidth,
    stacked,
    scrollX,
    columns,
    toolbarRows,
    controlMinWidth,
    minTargetSize: Math.ceil(minTargetSize * Math.min(1, textScale + 0.5)),
    chartMinHeight,
    overflowX: scrollX ? 'auto' : 'visible',
    // Clipping is never the answer: the row scrolls or wraps instead.
    clip: false,
    attributes: {
      'data-layout': stacked ? 'compact' : 'regular',
      'data-scroll-x': scrollX ? 'true' : 'false',
      'data-columns': String(columns),
      'data-text-scale': String(textScale),
    },
    chartHeight: (availableHeight) => {
      if (!isFiniteNumber(availableHeight) || availableHeight <= 0) return chartMinHeight;
      return Math.max(chartMinHeight, Math.floor(availableHeight - toolbarRows * (minTargetSize + 8)));
    },
    controlWidth: () => clamp(Math.floor(width / Math.max(1, Math.min(columns, controlCount))), Math.min(width, 44), width),
  };
}
