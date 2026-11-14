import { attachChartFeatures } from './index.js';

/** Create the workspace's chart factory without loading data or accessing storage. */
export function createWorkspaceChartFactory({ createChart, context, chartOptions = {}, features = {} } = {}) {
  if (typeof createChart !== 'function') throw new TypeError('createChart is required');
  return (container, request = {}) => {
    const state = request.chartState;
    const identity = request.context ?? state?.modules?.drawings?.context ?? context;
    const chart = createChart(container, state?.options ?? chartOptions);
    try {
      const stagedFeatures = request.validation
        ? { ...features, alertEngine: undefined, alerts: {}, datafeed: undefined }
        : features;
      attachChartFeatures(chart, { ...stagedFeatures, context: identity });
      if (state) {
        for (const pane of state.panes ?? []) if (pane.id !== 'main') chart.addPane(pane);
        const indicators = state.modules?.indicators ?? [];
        const outputs = new Set(indicators.flatMap(indicator => Object.values(indicator.outputSeries)));
        for (const series of state.series ?? []) {
          if (outputs.has(series.id)) continue;
          const seriesOptions = { id: series.id, priceScaleId: series.priceScaleId, visible: series.visible, lastValueVisible: series.lastValueVisible };
          if (series.title !== null && series.title !== undefined) seriesOptions.title = series.title;
          if (series.metadata !== null && series.metadata !== undefined) seriesOptions.metadata = series.metadata;
          chart.addSeries(series.type, seriesOptions, series.paneId);
        }
        for (const indicator of indicators) {
          const firstOutput = Object.values(indicator.outputSeries)[0];
          const descriptor = state.series.find(series => series.id === firstOutput);
          if (!descriptor) throw new Error(`Missing output series for indicator ${indicator.id}`);
          const handle = chart.addIndicator({ id: indicator.id, type: indicator.type, parameters: indicator.parameters,
            source: indicator.source, pane: indicator.pane, style: indicator.style, priceScaleId: descriptor.priceScaleId });
          handle.setVisible(indicator.visible);
          handle.setLocked(indicator.locked);
        }
        for (const derived of state.derived ?? []) chart.addDerivedView(derived.type, derived.sourceId, { id: derived.id, parameters: derived.parameters, visible: derived.visible });
      }
      return chart;
    } catch (error) {
      chart.destroy();
      throw error;
    }
  };
}
