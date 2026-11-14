import { createChart, attachChartFeatures } from 'vibecharts';

// All values and identifiers in this example are synthetic, not market data.
export function mountTimeline(container: HTMLElement, withTime = false): () => void {
  const chart = createChart(container, { accessibilityLabel: 'Synthetic demonstration chart' });
  try {
    const features = attachChartFeatures(chart, {
      context: { instrumentId: 'synthetic', interval: 'demo', sourceId: 'local' },
      interaction: {},
      chartUI: { demo: true, title: 'Synthetic demonstration' },
    });
    chart.addSeries('candlestick', { id: 'price' });
    chart.addSeries('line', { id: 'numeric' });
    const slot = (barId: string, day: number) => withTime
      ? { barId, time: Date.UTC(2024, 0, day), sessionDate: { year: 2024, month: 1, day } }
      : { barId };
    chart.replaceData({
      slots: [slot('b', 2), slot('c', 3)],
      series: [
        { seriesId: 'price', points: [
          { barId: 'b', open: 10, high: 12, low: 9, close: 11 },
          { barId: 'c', open: 11, high: 13, low: 10, close: 12 },
        ] },
        { seriesId: 'numeric', points: [{ barId: 'b', value: 4 }, { barId: 'c', value: 5 }] },
      ],
    });
    chart.setCrosshair('b');
    chart.applyBatch({
      timeline: { op: 'prepend', slots: [slot('a', 1)] },
      series: [
        { seriesId: 'price', points: [{ barId: 'a', open: 9, high: 11, low: 8, close: 10 }] },
        { seriesId: 'numeric', points: [{ barId: 'a', value: 3 }] },
      ],
    });
    // b is now index 1; its identity and the crosshair anchor have not changed.
    console.assert(chart.timeline.indexOf('b') === 1);
    chart.indexScale().setVisibleRange({ from: 0, to: 3 });
    chart.series('numeric').correct({ barId: 'b', value: 4.5 });
    if (!features.ui) throw new Error('Synthetic example UI is unavailable');
    features.ui.resolveAvailable({ rows: chart.timeline.listSlots(), operation: 'synthetic static history' });
    return () => chart.destroy();
  } catch (error) {
    chart.destroy();
    throw error;
  }
}
