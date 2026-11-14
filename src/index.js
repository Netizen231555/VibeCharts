import { Chart, CHART_EVENTS, SERIES_TYPES } from './core/chart.js';
import { DERIVED_TYPES } from './core/derived.js';
import { DEFAULT_OPTIONS } from './core/options.js';
import { createDomHost } from './dom/lifecycle.js';
import { ChartError, ERROR_CODES } from './errors.js';
import { THEMES } from './render/theme.js';
import { attachInteraction } from './interaction/index.js';
import { createChartUI } from './ui/index.js';
import { attachChartFeatures, createWorkspaceChartFactory } from './integration/index.js';
import { createDrawingStore } from './drawings/index.js';
import { computeIndicator, listIndicatorTypes, registerIndicatorType } from './indicators/engine.js';
import { timeFromOffsetString, timeFromUnixSeconds } from './core/validate.js';

/** @typedef {'linear'|'log'|'percent'} PriceScaleMode */
export const PRICE_SCALE_MODES = Object.freeze(['linear', 'log', 'percent']);

export const VERSION = '0.1.0';

/**
 * Creates a chart bound to a DOM container.
 *
 * The container must be an element; the chart creates and owns its canvas,
 * overlay, live regions and accessible table. The container itself is not
 * removed on destroy.
 *
 * @param {HTMLElement} container
 * @param {object} [options]
 * @returns {Chart}
 */
export function createChart(container, options = {}) {
  if (!container || typeof container !== 'object' || typeof container.appendChild !== 'function') {
    throw new ChartError('INVALID_CONTAINER', 'createChart: container must be a DOM element');
  }
  const host = createDomHost(container, {
    autoSize: options?.autoSize,
    accessibilityLabel: options?.accessibilityLabel,
    locale: options?.locale
  });
  try {
    const chart = new Chart(host, options ?? {});
    return chart;
  } catch (error) {
    host.destroy();
    throw error;
  }
}

export {
  Chart,
  ChartError,
  ERROR_CODES,
  SERIES_TYPES,
  CHART_EVENTS,
  DERIVED_TYPES,
  DEFAULT_OPTIONS,
  THEMES,
  attachInteraction,
  createChartUI,
  attachChartFeatures,
  createDrawingStore,
  computeIndicator,
  registerIndicatorType,
  listIndicatorTypes,
  timeFromOffsetString,
  timeFromUnixSeconds,
  createWorkspaceChartFactory
};
