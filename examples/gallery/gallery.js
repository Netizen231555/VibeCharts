// Screenshot page for the README: one chart with the full chart UI ("hero").
// Prices come from the deterministic generator of the terminal example; the instrument is fictional.
import { createChart, attachChartFeatures } from '../../src/index.js';
import { INTERVALS, generateSeries } from '../terminal/data.js';

const LOCALE = 'en-US';
const TZ = 'Europe/Berlin';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const UP = '#3fa77f';
const DOWN = '#d9645a';
const BLUE = '#4a9fd0';
const ORANGE = '#e0a84a';
const TEAL = '#2dc5c9';
const UP_VOLUME = 'rgba(63, 167, 127, 0.45)';
const DOWN_VOLUME = 'rgba(217, 100, 90, 0.45)';
const VISIBLE_BARS = 70;

const NORTHERN = { id: 'NRTH', name: 'Northern Energy', base: 182.4, vol: 0.016, volume: 4.2e6 };

const byId = (id) => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
};

// A broken page must be obvious in a screenshot and in the console, never silently half-drawn.
function reportError(scope, error) {
  console.error(`[gallery] ${scope}`, error);
  const box = byId('gallery-error');
  const line = document.createElement('p');
  line.textContent = `${scope}: ${error?.message ?? error}`;
  box.append(line);
  box.hidden = false;
}

const fmtDate = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
const fmtHour = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function chartOptions() {
  return {
    theme: 'dark',
    locale: LOCALE,
    timeZone: TZ,
    autoSize: true,
    layout: { background: '#10161c', textColor: '#aeb8c3', fontSize: 12, fontFamily: FONT },
    grid: { visible: true, color: '#1b232b' },
    crosshair: {
      visible: true,
      color: '#7d8d9c',
      labelBackground: '#303b47',
      labelTextColor: '#ffffff',
      timeFormatter: (time) => `${fmtDate.format(time)} ${fmtHour.format(time)}`,
    },
    priceScale: { borderColor: '#2b3540', textColor: '#aeb8c3', tickSpacing: 44 },
    timeScale: { borderColor: '#2b3540', textColor: '#aeb8c3', barSpacing: 10, rightOffset: 4, tickMode: 'time' },
  };
}

function loadBars(instrument, intervalId, count) {
  const interval = INTERVALS.find((entry) => entry.id === intervalId);
  if (!interval) throw new Error(`Unknown interval ${intervalId}`);
  const { slots, bars, step } = generateSeries(instrument, interval);
  return { slots: slots.slice(-count), bars: bars.slice(-count), step };
}


const metadataFor = (instrument, interval, priceStep) => ({ instrumentId: instrument.id, interval, sourceId: 'feed', board: 'MAIN', priceStep });


// ------------------------------------------------------------------- hero
async function buildHero() {
  const instrument = NORTHERN;
  const { slots, bars, step } = loadBars(instrument, '60', 600);
  const n = bars.length;
  const metadata = metadataFor(instrument, '1h', step);
  const mode = { chartType: 'candles', indicator: 'ema20' };
  let chart = null;
  let price = null;
  let priceCounter = 0;
  let overlays = [];

  const seriesTypes = { candles: 'candlestick', bars: 'bar', line: 'line' };
  const commonOptions = { lastValueVisible: true, priceLine: { style: 'dashed' }, lastValueColorMode: 'direction' };
  const colorOptions = {
    candles: { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, equalColor: '#8793a0' },
    bars: { upColor: UP, downColor: DOWN },
    line: { color: BLUE, lineWidth: 2 },
  };

  function addPrice(type) {
    if (!seriesTypes[type]) throw new Error(`Unknown chart type ${type}`);
    // A replaced series gets a fresh id so the old one is gone for good before the new one appears.
    const series = chart.addSeries(seriesTypes[type], { id: `price-${++priceCounter}`, ...commonOptions, ...colorOptions[type] }, 'main');
    series.setData(type === 'line' ? bars.map(({ barId, close }) => ({ barId, value: close })) : bars, metadata);
    return series;
  }

  // Only the price keeps a last-value label: every extra label competes for the same axis column.
  function addOverlay(spec) {
    const handle = chart.addIndicator(spec);
    for (const seriesId of Object.values(handle.getState().outputSeries)) chart.series(seriesId).setOptions({ lastValueVisible: false });
    return handle;
  }

  // Indicators computed from the price series are rebuilt whenever that series is replaced.
  function addPriceOverlays() {
    const sourceField = mode.chartType === 'line' ? 'value' : 'close';
    overlays.push(addOverlay({ type: 'ema', source: price.id, pane: 'main', parameters: { period: 50, sourceField }, style: { color: ORANGE, lineWidth: 1.5 } }));
    if (mode.indicator) overlays.push(addSelectedIndicator(sourceField));
  }
  const selectable = { sma20: { type: 'sma', color: TEAL }, ema20: { type: 'ema', color: BLUE } };
  function addSelectedIndicator(sourceField) {
    const { type, color } = selectable[mode.indicator];
    return addOverlay({ type, source: price.id, pane: 'main', parameters: { period: 20, sourceField }, style: { color, lineWidth: 1.5 } });
  }
  function removePriceOverlays() {
    for (const handle of overlays.splice(0)) handle.remove();
  }

  function setChartType(type) {
    if (!seriesTypes[type]) throw new Error(`Unknown chart type ${type}`);
    if (type === mode.chartType) return;
    const previous = mode.chartType;
    removePriceOverlays();
    chart.removeSeries(price);
    try {
      mode.chartType = type;
      price = addPrice(type);
    } catch (error) {
      mode.chartType = previous;
      price = addPrice(previous);
      addPriceOverlays();
      throw error;
    }
    addPriceOverlays();
  }

  function setIndicator(value) {
    if (value !== null && !selectable[value]) throw new Error(`Unknown indicator ${value}`);
    removePriceOverlays();
    mode.indicator = value;
    addPriceOverlays();
  }

  chart = createChart(byId('hero-chart'), {
    ...chartOptions(),
    accessibilityLabel: `${instrument.id} ${instrument.name}, 1 hour candlestick chart`,
  });
  chart.subscribe('error', ({ operation, error }) => reportError(`chart ${operation}`, error));
  attachChartFeatures(chart, {
    context: { instrumentId: instrument.id, interval: '1h', sourceId: 'feed' },
    interaction: {},
    chartUI: {
      host: byId('hero'),
      title: `${instrument.id} · ${instrument.name} · 1h`,
      theme: 'dark',
      chartType: mode.chartType,
      indicator: mode.indicator,
      onChartType: setChartType,
      onIndicator: setIndicator,
    },
  });
  chart.timeline.setTimeline(slots);
  price = addPrice(mode.chartType);

  // Volume lives on an overlay scale in the lower fifth of the main pane; price keeps clear of it.
  const volumeMetadata = metadataFor(instrument, '1h', 1);
  const volumeUp = chart.addSeries('histogram', { id: 'volume-up', color: UP_VOLUME, lastValueVisible: false, priceScaleId: 'volume' }, 'main');
  const volumeDown = chart.addSeries('histogram', { id: 'volume-down', color: DOWN_VOLUME, lastValueVisible: false, priceScaleId: 'volume' }, 'main');
  const volumeScale = chart.priceScale('main', 'volume');
  volumeScale.setOverlay(true);
  volumeScale.setMargins({ top: 0.82, bottom: 0 });
  chart.priceScale('main').setMargins({ top: 0.08, bottom: 0.22 });
  const volumePoint = (bar) => ({ barId: bar.barId, value: bar.volume });
  // Series sharing a scale take their metadata in one transaction.
  chart.applyBatch({ series: [
    { seriesId: volumeUp.id, operation: 'setData', metadata: volumeMetadata, points: bars.filter((bar) => bar.close >= bar.open).map(volumePoint) },
    { seriesId: volumeDown.id, operation: 'setData', metadata: volumeMetadata, points: bars.filter((bar) => bar.close < bar.open).map(volumePoint) },
  ] });

  addPriceOverlays();
  chart.ui.resolveAvailable({ rows: bars });

  // Set the visible range after the chart has been laid out.
  await chart.whenRendered();
  const first = n - VISIBLE_BARS;
  chart.indexScale().setVisibleRange({ from: first, to: n + 8 });
  await chart.whenRendered();
}

// ---------------------------------------------------------------- startup
try {
  await buildHero();
} catch (error) {
  reportError('Hero chart failed', error);
  throw error;
}
window.__galleryReady = true;
