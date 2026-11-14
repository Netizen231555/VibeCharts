import { createAlertEngine } from '../alerts/engine.js';
import { createDatafeedController } from '../datafeed/index.js';
import { createExtensionRegistry } from '../extensions/registry.js';
import { createReplaySession } from '../replay/session.js';
import { attachInteraction } from '../interaction/index.js';
import { createChartUI } from '../ui/index.js';
import { attachDrawings } from './drawings.js';
import { attachIndicators } from './indicators.js';
import { attachAlertPresentation } from './alertPresentation.js';
import { createModuleScope } from '../core/module-scope.js';
import { translate } from './messages.js';

/** Attach optional chart capabilities. The host owns data sources, persistence and alert delivery. */
export function attachChartFeatures(chart, options = {}) {
  if (!chart || typeof chart.attach !== 'function' || !chart.surface) throw new TypeError('A chart with the public extension surface is required');
  if (options.datafeed?.mapObservation !== undefined && typeof options.datafeed.mapObservation !== 'function') throw new TypeError('datafeed.mapObservation must be a function');
  const cleanups = [];
  const add = (name, api, hooks = {}, shape = {}) => {
    const scope = createModuleScope(chart, name, api, shape);
    try {
      const detach = chart.attach({
        name,
        api: scope.api,
        hooks: { ...hooks, onDestroy() {
          try { hooks.onDestroy?.(); } finally { scope.dispose(); }
        } }
      });
      cleanups.push(detach);
    } catch (error) {
      scope.dispose();
      throw error;
    }
  };
  let replay = null;
  let ui = null;
  try {
    const ownsAlerts = !options.alertEngine;
    const alerts = options.alertEngine ?? createAlertEngine({
      ...options.alerts,
      resolveBarIndex: (id, chartId) =>
        chartId && chartId !== (options.drawingChartId ?? chart.id) ? null : chart.timeline.indexOf(id)
    });
    cleanups.push(attachDrawings(chart, { ...options, alertEngine: alerts }));
    cleanups.push(attachIndicators(chart, { alerts, chartId: options.drawingChartId, invalidateOnDestroy: ownsAlerts, suppressAlertEffects: () => replay !== null }));
    cleanups.push(attachAlertPresentation(chart, alerts, { chartId: options.drawingChartId }));
    const geometrySources = record => [record.definition.left, record.definition.right].filter(source =>
      source?.kind === 'drawing' && Array.isArray(source.points) &&
      (source.chartId == null ? ownsAlerts : source.chartId === (options.drawingChartId ?? chart.id)));
    function refreshAlertAnchors() {
      if (replay) return;
      for (const record of alerts.list()) {
        if (record.authority !== 'local') continue;
        const sources = geometrySources(record);
        if (sources.length) alerts.setGeometryResolved(record.id, sources.every(source =>
          source.points.every(point => chart.timeline.indexOf(point.anchorBarId) !== null)));
      }
    }
    add('alerts', alerts, {
      onHistoryPreview(plan) {
        const removed = new Set(plan.removedBarIds);
        return { alerts: [...plan.alerts, ...alerts.list().filter(record => record.authority === 'local' &&
          geometrySources(record).some(source => source.points.some(point => removed.has(point.anchorBarId))))
          .map(record => ({ id: record.id }))] };
      },
      onHistoryRemoved: refreshAlertAnchors,
      onReset: refreshAlertAnchors,
      onTimelineChange(change) {
        if (['append', 'prepend', 'replace'].includes(change.kind)) refreshAlertAnchors();
      },
      onDataChange(change) {
        if (change.kind === 'replace' || (change.kind === 'batch' && change.timelineKind)) refreshAlertAnchors();
      },
      onSeriesRemoved(series) {
        alerts.markSourceRemoved({ kind: 'series', seriesId: series.id, ...(options.drawingChartId ? { chartId: options.drawingChartId } : {}) });
      },
      onDestroy() {
        if (ownsAlerts) {
          alerts.setBackendAdapter(null);
          alerts.stopSession();
        }
      }
    }, { subscriptions: ['subscribe'] });

    const extensions = createExtensionRegistry({
      chartContext: {
        context: () => chart.drawings.context(),
        timeline: chart.timeline,
        indexScale: () => chart.indexScale(),
        subscribe: (event, handler) => chart.subscribe(event, handler),
        requestRender: () => chart.requestRender(),
        addControl: control => { chart._assertAlive('extensions.addControl'); return chart._host.addControl?.(control); },
        removeControl: id => chart._host.removeControl?.(id),
        series: chart.series
      },
      onError: options.onExtensionError ?? (event => chart._reportError(event.error, `extension.${event.id}.${event.operation}`))
    });
    add('extensions', extensions, {
      onRender({ ctx, layout }) {
        for (const instance of extensions.listInstances()) if (instance.renderable) instance.render(ctx, chart.surface, layout);
      },
      onDestroy: () => extensions.disposeAll()
    }, {
      subscriptions: ['subscribe'],
      results: { register: {}, create: {}, listInstances: { array: {} }, importState: { array: {} } }
    });

    const feedSubscriptions = [];
    const feedChart = {
      timeline: chart.timeline,
      series: chart.series,
      applyBatch: batch => chart.applyBatch(batch),
      replaceData: data => chart.replaceData(data),
      resetData: () => chart.resetData(),
      subscribe(event, handler) {
        const unsubscribe = chart.subscribe(event, handler);
        feedSubscriptions.push(unsubscribe);
        return unsubscribe;
      }
    };
    const interruptAlerts = (reason, stream) => {
      if (!ownsAlerts && stream) alerts.disconnectStream(stream);
      else alerts.disconnect(reason);
    };
    const report = error => {
      if (chart._destroyed) return;
      if (options.datafeed?.mapObservation && error.operation === 'observe') interruptAlerts('datafeed-error', feed.getState().context);
      if (ui) ui.fail({ operation: translate(chart._options.locale, 'datafeed.operation'), message: error.message });
      chart.surface.emit('error', { operation: 'datafeed', error });
      options.datafeed?.onError?.(error);
    };
    const feed = createDatafeedController({
      ...options.datafeed,
      chart: feedChart,
      onError: report,
      onStatus(event) {
        if (chart._destroyed) return;
        if (options.datafeed?.mapObservation && event.status === 'disconnected') interruptAlerts('datafeed-disconnected', event.context);
        if (ui) {
          if (event.status === 'loading' || event.status === 'reconciling') ui.startLoading();
          else if (event.status === 'empty') ui.resolveEmpty();
          else if (event.status === 'available') ui.resolveAvailable({ rows: chart.timeline.listSlots() });
          else if (event.status === 'unavailable' || event.status === 'disconnected') ui.fail({ operation: translate(chart._options.locale, 'datafeed.operation'), message: translate(chart._options.locale, 'datafeed.unavailable') });
        }
        options.datafeed?.onStatus?.(event);
      },
      onObservation(event) {
        if (chart._destroyed) return;
        if (options.datafeed?.mapObservation) {
          try {
            const mapped = options.datafeed.mapObservation(event);
            if (event.consistent) {
              const { instrumentId, interval, sourceId } = event.context;
              const stream = { instrumentId, interval, sourceId };
              if (mapped?.stream && (mapped.stream.instrumentId !== instrumentId ||
                  mapped.stream.interval !== interval || mapped.stream.sourceId !== sourceId)) {
                throw new Error('Mapped observation stream does not match the datafeed context');
              }
              const observation = mapped ? { ...mapped, stream } : {
                stream,
                version: event.observation.version ?? event.snapshotVersion,
                prevVersion: event.observation.prevVersion,
                values: {}
              };
              if (event.initializes) {
                const { version, values, barId, time, state, index } = observation;
                alerts.confirmSnapshot(Object.fromEntries(Object.entries({ stream, version, values, barId, time, state, index }).filter(([, value]) => value !== undefined)));
              }
              else if (event.alert) alerts.observe(observation);
            }
          } catch (error) { interruptAlerts('observation-mapping-error', event.context); report(error); }
        }
        options.datafeed?.onObservation?.(event);
      }
    });
    const disconnectFeed = () => {
      try { feed.disconnect(); }
      finally { for (const unsubscribe of feedSubscriptions.splice(0)) unsubscribe(); }
    };
    cleanups.push(disconnectFeed);
    const feedApi = { ...feed, connect(source, context) {
      if (replay) throw new Error('Stop replay before connecting a live datafeed');
      return feed.connect(source, context);
    } };
    add('datafeed', feedApi, { onDestroy: disconnectFeed }, { subscriptions: ['subscribe'] });
    add('connectDatafeed', (source, context) => feedApi.connect(source, context));

    const replayApi = {
      create({ source, events, series, ...rest }) {
        if (replay) throw new Error('A replay session is already active');
        if (feed.getState().connected) throw new Error('Disconnect the live datafeed before replay');
        if (!source || typeof source !== 'object' || source.apply !== undefined || source.views !== undefined) throw new TypeError('Replay source must not provide apply or views; the chart owns replay application');
        if (!series || typeof series !== 'object' || Array.isArray(series)) throw new TypeError('Replay requires an explicit stream-to-series mapping');
        const mapping = { ...series };
        const targetIds = Object.values(mapping);
        if (targetIds.some(id => typeof id !== 'string' || !id) || new Set(targetIds).size !== targetIds.length) throw new Error('Replay series mappings must be unique series ids');
        for (const id of targetIds) chart.series(id);
        if (Array.isArray(events)) for (const event of events) {
          if (event?.type !== 'observation' && typeof event?.streamId === 'string' && !Object.hasOwn(mapping, event.streamId)) throw new Error(`Replay stream ${event.streamId} has no chart series mapping`);
        }
        const apply = state => {
          const streams = new Map(state.streams.map(stream => [stream.streamId, stream]));
          const entries = Object.entries(mapping).map(([streamId, seriesId]) => ({ seriesId, points: (streams.get(streamId)?.bars ?? []).map(bar => ({ barId: bar.barId, ...bar.values })) }));
          chart.replaceData({ slots: state.timeline, series: entries });
        };
        const session = createReplaySession({ ...rest, events, source: { ...source, apply } });
        const destroy = session.destroy;
        session.destroy = () => { destroy(); if (replay === session) replay = null; };
        replay = session;
        try { apply(session.getState()); }
        catch (error) { replay = null; session.destroy(); throw error; }
        return session;
      },
      get current() { return replay; },
      stop() { if (replay) { replay.destroy(); replay = null; } }
    };
    add('replay', replayApi, { onDestroy: () => replayApi.stop() }, { results: { create: {} }, properties: { current: {} } });

    if (options.interaction !== undefined && options.interaction !== false) {
      const interaction = attachInteraction(chart, options.interaction);
      try { add('interaction', interaction, { onDestroy: () => { if (!chart._destroyed) interaction.destroy(); } }); } catch (error) { interaction.destroy(); throw error; }
    }
    if (options.ui !== undefined) throw new TypeError('The `ui` option was replaced by `chartUI`');
    if (options.chartUI !== undefined && options.chartUI !== false) {
      if (!chart.interaction) throw new Error('UI requires explicitly attached interaction');
      ui = createChartUI(chart, { ...options.chartUI, interaction: chart.interaction });
      try {
        add('ui', ui, { onDestroy: () => { if (!chart._destroyed) ui.destroy(); } }, {
          properties: { statusModel: {}, derived: { subscriptions: ['subscribe'] } },
        });
      } catch (error) { ui.destroy(); throw error; }
    }
    return chart;
  } catch (error) {
    for (const cleanup of cleanups.reverse()) cleanup();
    throw error;
  }
}

export { createWorkspaceChartFactory } from './workspace.js';
