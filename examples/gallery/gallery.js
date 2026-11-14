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
const PURPLE = '#9a7fd1';
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

// Integer hash in [0, 1): the same index always gives the same value on every engine.
function unitHash(index) {
  let h = Math.imul(index ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Buy share follows the candle body with a little noise, so the delta pane reads like real order flow.
function withVolumeSplit(bars) {
  return bars.map((bar, index) => {
    const range = bar.high - bar.low;
    const pressure = range > 0 ? Math.tanh((2.4 * (bar.close - bar.open)) / range) : 0;
    const share = Math.min(0.92, Math.max(0.08, 0.5 + 0.3 * pressure + 0.12 * (unitHash(index) - 0.5)));
    const buyVolume = Math.round(bar.volume * share);
    return { ...bar, buyVolume, sellVolume: bar.volume - buyVolume };
  });
}

const metadataFor = (instrument, interval, priceStep) => ({ instrumentId: instrument.id, interval, sourceId: 'feed', board: 'MAIN', priceStep });

function anchorAt(bars, logical, price) {
  const index = Math.min(bars.length - 1, Math.max(0, Math.round(logical)));
  return { anchorBarId: bars[index].barId, offset: Math.round((logical - index) * 1e4) / 1e4, price };
}

// Drawings bind to the pane and its primary price scale; read both from the live layout instead of guessing.
function mainBinding(chart) {
  const pane = chart.getInteractionLayout().panes.find((entry) => entry.id === 'main');
  const scale = pane?.priceScales[0];
  if (!scale) throw new Error('The main pane has no primary price scale');
  return { paneId: pane.id, scaleId: scale.id };
}

function addDrawing(chart, binding, spec) {
  try {
    return chart.drawings.add({ ...binding, ...spec });
  } catch (error) {
    throw new Error(`drawings.add(${spec.type}) failed: ${error.message}`, { cause: error });
  }
}

const extremeIndex = (bars, from, to, better) => {
  let best = from;
  for (let i = from; i <= to; i += 1) if (better(bars[i], bars[best])) best = i;
  return best;
};

// ------------------------------------------------------------------- hero
async function buildHero() {
  const instrument = NORTHERN;
  const { slots, bars: plain, step } = loadBars(instrument, '60', 600);
  const bars = withVolumeSplit(plain);
  const n = bars.length;
  const metadata = metadataFor(instrument, '1h', step);
  const mode = { chartType: 'candles', indicator: 'sma20' };
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

  let rsiPane = null;
  // Indicators computed from the price series are rebuilt whenever that series is replaced.
  function addPriceOverlays() {
    const sourceField = mode.chartType === 'line' ? 'value' : 'close';
    overlays.push(addOverlay({ type: 'ema', source: price.id, pane: 'main', parameters: { period: 50, sourceField }, style: { color: ORANGE, lineWidth: 1.5 } }));
    overlays.push(addOverlay({ type: 'rsi', source: price.id, pane: rsiPane, parameters: { period: 14, sourceField }, style: { color: PURPLE, lineWidth: 1.5 } }));
    if (mode.indicator) overlays.push(addSelectedIndicator(sourceField));
  }
  const selectable = { sma20: { type: 'sma', color: BLUE }, ema20: { type: 'ema', color: TEAL } };
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

  // The delta source carries buy/sell volume and survives chart type changes; line charts have no such fields.
  const flow = chart.addSeries('candlestick', { id: 'flow', visible: false, lastValueVisible: false, priceScaleId: 'flow' }, 'main');
  chart.priceScale('main', 'flow').setOverlay(true);
  flow.setData(bars, metadata);

  rsiPane = chart.addPane({ height: 0.26 });
  const deltaPane = chart.addPane({ height: 0.24 });
  addPriceOverlays();
  addOverlay({ type: 'delta', source: 'flow', pane: deltaPane, style: { upColor: UP, downColor: DOWN } });
  chart.ui.resolveAvailable({ rows: bars });

  // Drawings and the crosshair need a laid-out chart, and the visible range needs its final size.
  await chart.whenRendered();
  const first = n - VISIBLE_BARS;
  chart.indexScale().setVisibleRange({ from: first, to: n + 8 });
  await chart.whenRendered();
  const binding = mainBinding(chart);
  const at = (logical, value) => anchorAt(bars, logical, value);

  const trendFrom = extremeIndex(bars, first + 2, first + 24, (bar, best) => bar.low < best.low);
  const trendTo = extremeIndex(bars, first + 34, n - 10, (bar, best) => bar.low < best.low);
  const zoneFrom = n - 46;
  const zoneTo = n - 33;
  const zoneCloses = bars.slice(zoneFrom, zoneTo + 1).map((bar) => bar.close);
  const closes = bars.slice(first).map((bar) => bar.close).sort((a, b) => a - b);
  const pivot = Math.round(closes[Math.floor(closes.length * 0.7)] / step) * step;

  addDrawing(chart, binding, { id: 'hero-trend', type: 'segment', anchors: [at(trendFrom, bars[trendFrom].low), at(trendTo, bars[trendTo].low)], style: { color: '#e8eef4', width: 2 } });
  addDrawing(chart, binding, { id: 'hero-level', type: 'horizontalLevel', anchors: [{ price: pivot }], style: { color: '#d36fb1', width: 1.5, dash: 'dashed' } });
  addDrawing(chart, binding, {
    id: 'hero-zone', type: 'rectangle',
    anchors: [at(zoneFrom, Math.min(...zoneCloses)), at(zoneTo, Math.max(...zoneCloses))],
    style: { color: BLUE, width: 1, fill: true, fillColor: 'rgba(74, 159, 208, 0.16)' },
  });

  const crosshairBar = bars[n - 24];
  chart.setCrosshair(crosshairBar.barId, crosshairBar.close);
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
