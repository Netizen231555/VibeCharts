import { createChart, attachChartFeatures } from 'vibecharts';
import { sourceKey } from 'vibecharts/alerts';
import type { IndexDatafeed, FeedEvent, ObservationEvent } from 'vibecharts';

// Synthetic local values only. Neither this feed nor its observations use a network.
export async function mountVersionedFeed(container: HTMLElement, report: (message: string) => void): Promise<() => void> {
  const chart = createChart(container, { accessibilityLabel: 'Synthetic versioned feed' });
  const context = { instrumentId: 'synthetic', interval: 'demo', sourceId: 'local' };
  const measurement = { kind: 'series', seriesId: 'measure', field: 'value', units: 'demo' };
  let chartObserver: { next(event: FeedEvent): void } | undefined;
  let observationObserver: { next(event: ObservationEvent): void } | undefined;
  let snapshotRequested = false;
  try {
    const features = attachChartFeatures(chart, { context, datafeed: {
      mapObservation: ({ observation, snapshotVersion }) => {
        const version = observation.version ?? snapshotVersion;
        if (!version) throw new Error('Observation version or snapshot boundary is required');
        return {
          version, prevVersion: observation.prevVersion, state: observation.state,
          values: { [sourceKey(measurement)]: observation.value },
        };
      },
      onError: (error) => report(`Feed error: ${error.message}`),
      onObservation: (event) => report(`Observation: initializes=${event.initializes}, alert=${event.alert}`),
    } });
    chart.addSeries('candlestick', { id: 'price' });
    chart.addSeries('line', { id: 'measure' });
    features.alerts.add({
      id: 'synthetic-threshold',
      left: measurement,
      right: { kind: 'constant', value: 10, units: 'demo' },
      operation: 'crossUp', mode: 'repeating', observationMode: 'closed',
    });
    const feed: IndexDatafeed = {
      capabilities: { history: true, stream: true, observations: true },
      async loadHistory(request) {
        if (request.before) return {
          context, slots: [{ barId: 'a' }],
          series: [
            { seriesId: 'price', points: [{ kind: 'ohlcv', barId: 'a', open: 9, high: 11, low: 8, close: 10 }] },
            { seriesId: 'measure', points: [{ kind: 'numeric', barId: 'a', value: 3 }] },
          ], hasMore: false, sourceStatus: 'ok', snapshotVersion: 'v1',
        };
        return {
          context, slots: [{ barId: 'b' }],
          series: [
            { seriesId: 'price', points: [{ kind: 'ohlcv', barId: 'b', open: 10, high: 12, low: 9, close: 11 }] },
            { seriesId: 'measure', points: [{ kind: 'numeric', barId: 'b', value: 4 }] },
          ], hasMore: true, nextBefore: 'opaque-cursor', sourceStatus: 'ok', snapshotVersion: 'v1',
        };
      },
      subscribe(_context, observer) { chartObserver = observer; return () => { chartObserver = undefined; }; },
      observe(_context, observer) { observationObserver = observer; return () => { observationObserver = undefined; }; },
      requestSnapshot(_context, stream) { if (stream === 'observations') snapshotRequested = true; },
    };
    const initial = await features.connectDatafeed(feed, context);
    if (initial.error) throw new Error(initial.error.message);
    const older = await features.datafeed.loadMore(); // Cursor is passed unchanged; older slot is prepended.
    if (older.error) throw new Error(older.error.message);
    chartObserver?.next({ type: 'append', seriesId: 'price', slot: { barId: 'c' },
      point: { kind: 'ohlcv', barId: 'c', open: 11, high: 13, low: 10, close: 12 },
      barState: 'partial', version: 'v2', prevVersion: 'v1' });
    chartObserver?.next({ type: 'replace', seriesId: 'price',
      point: { kind: 'ohlcv', barId: 'c', open: 11, high: 14, low: 10, close: 13 },
      barState: 'closed', version: 'v3', prevVersion: 'v2' });
    observationObserver?.next({ type: 'snapshot', observation: { sourceId: 'sensor', value: 10, state: 'partial' }, snapshotVersion: 's1' });
    observationObserver?.next({ type: 'observation', observation: { sourceId: 'sensor', value: 12, state: 'closed', version: 'o3', prevVersion: 'o2' } });
    report(`Observation gap: consistent=${features.datafeed.getState().observationStream.consistent}; snapshot requested=${snapshotRequested}`);
    observationObserver?.next({ type: 'snapshot', observation: { sourceId: 'sensor', value: 13, state: 'closed' }, snapshotVersion: 's4' });
    observationObserver?.next({ type: 'observation', observation: { sourceId: 'sensor', value: 14, state: 'closed', version: 'o5', prevVersion: 's4' } });
    report(`Alert events after recovery initialization: ${features.alerts.events('synthetic-threshold').length}`);
    return () => { features.datafeed.disconnect(); chart.destroy(); };
  } catch (error) {
    chart.destroy();
    throw error;
  }
}
