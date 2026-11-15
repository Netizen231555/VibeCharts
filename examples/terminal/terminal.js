// Terminal example built only on the public vibecharts API.
// All instruments, prices and volumes are SYNTHETIC (see data.js).
import { createChart, attachChartFeatures } from 'vibecharts';
import { exportChartPng } from 'vibecharts/workspaces';
import { sourceKey } from 'vibecharts/alerts';
import { INSTRUMENTS, INTERVALS, generateSeries, decimalsOf, createTicker } from './data.js';
import { createToolbarModel, createUiController, createIcon } from 'vibecharts/ui';
import { captureWindow, windowRange } from './window.js';
import { createSettings } from './settings-model.js';
import { createSettingsPanel } from './settings-panel.js';
import { createI18n, mountLanguageSwitch } from '../shared/i18n.js';
import { en, ru } from './strings.js';

// The page is built once in the chosen language (the switch reloads it), so strings are resolved at the point of use.
const i18n = createI18n({ en, ru });
const { t } = i18n;
i18n.apply(document);
mountLanguageSwitch(document.getElementById('language-host'));
const nameOf = (instrument) => instrument.names[i18n.lang];
const labelOf = (interval) => interval.labels[i18n.lang];

const TZ = 'Europe/Moscow';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
// Settings (colours, series looks, the default style of new drawings) are kept in localStorage.
const settings = createSettings();
// What the series, the legend and the side panel read; refreshColors() reassigns it from the current theme's settings.
let VALUES;
let UP;
let DOWN;
let UP_VOLUME;
let DOWN_VOLUME;
let LINE_COLOR;
const withAlpha = (hex, alpha) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};
function refreshColors() {
  VALUES = settings.values(state.theme);
  UP = VALUES['candle.up'];
  DOWN = VALUES['candle.down'];
  UP_VOLUME = withAlpha(VALUES['volume.up'], VALUES['volume.opacity']);
  DOWN_VOLUME = withAlpha(VALUES['volume.down'], VALUES['volume.opacity']);
  LINE_COLOR = VALUES['line.color'];
  document.documentElement.style.setProperty('--up', UP);
  document.documentElement.style.setProperty('--down', DOWN);
}


const ICONS = {
  cursor: '<path d="M6 4l11 8-5 1.2 3 5.8-2.2 1.1-3-5.8L6 17z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  magnet: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  eyeOff: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>',
  lock: '<path d="M6 11h12v9H6z"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3"/>',
  undo: '<path d="M9 7L5 11l4 4"/><path d="M5 11h9a5 5 0 010 10h-3"/>',
  redo: '<path d="M15 7l4 4-4 4"/><path d="M19 11h-9a5 5 0 000 10h3"/>',
  indicators: '<path d="M3 17l5-6 4 4 5-8 4 5"/>',
  candles: '<path d="M7 4v16M17 4v16"/><rect x="5" y="8" width="4" height="7" fill="currentColor"/><rect x="15" y="6" width="4" height="9"/>',
  bars: '<path d="M7 4v16M7 9H4M7 15h3M17 3v17M17 7h-3M17 13h3"/>',
  line: '<path d="M3 17l5-5 4 3 8-9"/>',
  area: '<path d="M3 17l5-5 4 3 8-9v14H3z" fill="currentColor" fill-opacity=".25"/><path d="M3 17l5-5 4 3 8-9"/>',
  theme: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  camera: '<path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  forward: '<path d="M7 6l6 6-6 6M13 6l6 6-6 6"/>',
  bell: '<path d="M6 17v-6a6 6 0 0112 0v6l1.5 2h-15z"/><path d="M10 21h4"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;

const $ = (id) => document.getElementById(id);
const els = {
  terminal: $('terminal'), chart: $('chart'), legend: $('legend'), notice: $('notice'), status: $('status'), clock: $('clock'),
  toRealtime: $('to-realtime'), watchlist: $('watchlist'), details: $('details'), alerts: $('alerts'), listSelect: $('list-select'),
};
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = svg(node.dataset.icon);

const CHART_TYPES = [
  { id: 'candles', label: t('chartType.candles'), icon: 'candles' },
  { id: 'bars', label: t('chartType.bars'), icon: 'bars' },
  { id: 'line', label: t('chartType.line'), icon: 'line' },
  { id: 'area', label: t('chartType.area'), icon: 'area' },
];
const INDICATORS = [
  { id: 'volume', label: t('indicator.volume') },
  { id: 'sma', label: t('indicator.sma') },
  { id: 'ema', label: t('indicator.ema') },
  { id: 'bollinger', label: t('indicator.bollinger') },
  { id: 'rsi', label: t('indicator.rsi') },
  { id: 'macd', label: t('indicator.macd') },
];
const RANGES = [
  { id: '1d', label: t('range.1d'), days: 1 }, { id: '5d', label: t('range.5d'), days: 5 }, { id: '1m', label: t('range.1m'), days: 30 },
  { id: '3m', label: t('range.3m'), days: 91 }, { id: '6m', label: t('range.6m'), days: 182 }, { id: 'ytd', label: t('range.ytd'), ytd: true },
  { id: '1y', label: t('range.1y'), days: 365 }, { id: 'all', label: t('range.all'), all: true },
];

// Static lists stand in for user-managed watchlists; membership refers to instrument ids from data.js.
const LISTS = [
  { id: 'all', label: t('list.all'), ids: null },
  { id: 'favorites', label: t('list.favorites'), ids: ['DEMO01', 'DEMO02', 'DEMO05', 'DEMO10'] },
  { id: 'resources', label: t('list.resources'), ids: ['DEMO01', 'DEMO03', 'DEMO06', 'DEMO07', 'DEMO10'] },
  { id: 'services', label: t('list.services'), ids: ['DEMO02', 'DEMO04', 'DEMO08', 'DEMO09', 'DEMO11', 'DEMO12'] },
];

const state = {
  instrument: INSTRUMENTS[0], interval: INTERVALS[3], chartType: 'candles', theme: 'dark',
  indicators: new Set(['volume', 'sma']), live: true, tool: null, magnet: false,
  listId: 'all', alerts: new Map(), // alerts: instrument id -> [{ price, operation, engineId }]
};

// ---------------------------------------------------------------- formatting
const priceFmt = (decimals) => new Intl.NumberFormat(i18n.locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const compact = new Intl.NumberFormat(i18n.locale, { notation: 'compact', maximumFractionDigits: 2 });
const pctFmt = new Intl.NumberFormat(i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtCrossDate = new Intl.DateTimeFormat(i18n.locale, { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
const fmtHour = new Intl.DateTimeFormat(i18n.locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtClock = new Intl.DateTimeFormat(i18n.locale, { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');
const pctText = (pct) => `${sign(pct)}${pctFmt.format(Math.abs(pct))}%`;

// -------------------------------------------------------------------- menus
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.panel.remove();
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu.button.focus();
  openMenu = null;
}
function showMenu(button, build, { placement = 'below' } = {}) {
  if (openMenu) { const same = openMenu.button === button; closeMenu(); if (same) return; }
  const panel = document.createElement('div');
  panel.className = 'menu';
  panel.setAttribute('role', 'menu');
  build(panel, closeMenu);
  // The top bar scrolls horizontally, which would clip an absolutely positioned child; the panel lives on <body> instead.
  document.body.append(panel);
  const anchor = button.getBoundingClientRect();
  if (placement === 'right') {
    panel.style.left = `${Math.round(anchor.right + 4)}px`;
    panel.style.top = `${Math.round(Math.max(8, Math.min(anchor.top, window.innerHeight - panel.offsetHeight - 8)))}px`;
  } else {
    panel.style.top = `${Math.round(anchor.bottom + 4)}px`;
    panel.style.left = `${Math.round(Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8)))}px`;
  }
  button.setAttribute('aria-expanded', 'true');
  openMenu = { button, panel };
  panel.querySelector('button')?.focus();
}
document.addEventListener('pointerdown', (event) => { if (openMenu && !openMenu.panel.contains(event.target) && !openMenu.button.contains(event.target)) { openMenu.panel.remove(); openMenu.button.setAttribute('aria-expanded', 'false'); openMenu = null; } });
document.addEventListener('keydown', (event) => {
  if (!openMenu) return;
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(); return; }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const items = [...openMenu.panel.querySelectorAll('button')];
    const index = items.indexOf(document.activeElement);
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
});
function menuItem(parent, label, { checked, mark, icon, iconNode, onClick }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (checked !== undefined) item.setAttribute('aria-checked', String(checked));
  // The armed tool of a flyout is shown by the item's highlight, so it needs no empty column for a check mark.
  if (mark !== false) {
    const checkMark = document.createElement('span');
    checkMark.className = 'check';
    checkMark.textContent = checked ? '✓' : '';
    item.append(checkMark);
  }
  if (icon) { const i = document.createElement('span'); i.className = 'icon'; i.innerHTML = svg(icon); item.append(i); }
  if (iconNode) { const i = document.createElement('span'); i.className = 'icon'; i.append(iconNode); item.append(i); }
  const text = document.createElement('span');
  text.textContent = label;
  item.append(text);
  item.addEventListener('click', onClick);
  parent.append(item);
}

// -------------------------------------------------------------------- state
const dataCache = new Map();
function dataFor(instrument, interval) {
  const key = `${instrument.id}|${interval.id}`;
  if (!dataCache.has(key)) dataCache.set(key, generateSeries(instrument, interval));
  return dataCache.get(key);
}
const dailyOf = (instrument) => dataFor(instrument, INTERVALS.find((i) => i.id === 'D'));

let chart = null;
let session = null; // everything owned by the current chart instance

function announce(message) { els.status.textContent = ''; els.status.textContent = message; }
function showNotice(message, kind = 'error') { els.notice.textContent = message; els.notice.dataset.kind = kind; els.notice.hidden = false; announce(message); }
function clearNotice() { els.notice.hidden = true; els.notice.textContent = ''; delete els.notice.dataset.kind; }

// The chart's colours and switches for the current theme, from the settings.
function themeOptions() {
  const v = VALUES;
  return {
    theme: state.theme,
    layout: { background: v['chart.background'], textColor: v['chart.text'], fontSize: v['chart.fontSize'], fontFamily: FONT },
    grid: { visible: v['grid.visible'], color: v['grid.color'] },
    crosshair: { visible: v['crosshair.visible'], color: v['crosshair.color'], labelBackground: v['crosshair.plate'], labelTextColor: v['crosshair.plateText'] },
    priceScale: { borderColor: v['axis.border'], textColor: v['axis.text'] },
    timeScale: { borderColor: v['axis.border'], textColor: v['axis.text'] },
  };
}
// Series options of the current chart type; the same function serves the first build and a live change.
function priceSeriesOptions() {
  const v = VALUES;
  switch (state.chartType) {
    case 'candles': {
      const linked = v['candle.linked'];
      return {
        upColor: v['candle.up'], downColor: v['candle.down'], equalColor: v['candle.equal'],
        borderUpColor: linked ? v['candle.up'] : v['candle.borderUp'], borderDownColor: linked ? v['candle.down'] : v['candle.borderDown'],
        wickUpColor: linked ? v['candle.up'] : v['candle.wickUp'], wickDownColor: linked ? v['candle.down'] : v['candle.wickDown'],
        borderVisible: v['candle.borderVisible'], wickVisible: v['candle.wickVisible'],
      };
    }
    case 'bars': return { upColor: v['candle.up'], downColor: v['candle.down'] };
    case 'line': return { color: LINE_COLOR, lineWidth: 2 };
    default: return { lineColor: LINE_COLOR, lineWidth: 2, fillColor: withAlpha(LINE_COLOR, v['area.opacity']) };
  }
}
const priceLineOptions = () => ({ visible: VALUES['priceLine.visible'], style: VALUES['priceLine.style'] });

function chartOptions(step) {
  const theme = themeOptions();
  return {
    ...theme, locale: i18n.locale, timeZone: TZ, autoSize: true,
    accessibilityLabel: t('chart.accessibility', { id: state.instrument.id, interval: labelOf(state.interval) }),
    // Ticks sit on calendar boundaries; the crosshair plate names the weekday and, intraday, the time.
    timeScale: { ...theme.timeScale, barSpacing: 9, rightOffset: 10, tickMode: 'time' },
    priceScale: { ...theme.priceScale, tickSpacing: 44 },
    crosshair: {
      ...theme.crosshair,
      timeFormatter: (time) => (state.interval.id === 'D' || state.interval.id === 'W' ? fmtCrossDate.format(time) : `${fmtCrossDate.format(time)} ${fmtHour.format(time)}`),
    },
  };
}

// ---------------------------------------------------------- series building
function pointsFor(type, bars) {
  return type === 'line' || type === 'area' ? bars.map(({ barId, close }) => ({ barId, value: close })) : bars;
}
function addPrice(s) {
  const { bars, step } = s.data;
  const metadata = { instrumentId: `DEMO:${state.instrument.id}`, interval: state.interval.id, sourceId: 'synthetic-demo', board: 'DEMO', priceStep: step };
  const common = { id: 'price', lastValueVisible: true, priceLine: priceLineOptions(), lastValueColorMode: 'direction' };
  const type = state.chartType;
  if (type === 'candles') s.price = chart.addSeries('candlestick', { ...common, ...priceSeriesOptions() }, 'main');
  else if (type === 'bars') s.price = chart.addSeries('bar', { ...common, ...priceSeriesOptions() }, 'main');
  else if (type === 'line') s.price = chart.addSeries('line', { ...common, ...priceSeriesOptions() }, 'main');
  else s.price = chart.addSeries('area', { ...common, ...priceSeriesOptions(), basePrice: Math.min(...bars.map((b) => b.low)) }, 'main');
  s.price.setData(pointsFor(type, bars), metadata);
}
// Magnet on: every anchor takes the nearest candle's time and its nearest O/H/L/C price; the source is the primary price series.
const magnetSnap = () => (state.magnet ? { mode: 'strong', magnet: true } : { mode: 'free', magnet: false });
function removeSeriesSafe(series) { if (series) { try { chart.removeSeries(series); } catch (error) { showNotice(t('error.removeSeries', { message: error.message })); } } }

// Volume is drawn on an overlay scale in the lower fifth of the main pane: its own range, no axis column.
const seriesMetadata = (step) => ({ instrumentId: `DEMO:${state.instrument.id}`, interval: state.interval.id, sourceId: 'synthetic-demo', board: 'DEMO', priceStep: step });
function volumeUnit(bars) {
  const max = bars.reduce((m, b) => Math.max(m, b.volume), 0);
  if (max >= 1e6) return { div: 1e6, step: 0.01, label: t('unit.million') };
  if (max >= 1e3) return { div: 1e3, step: 0.1, label: t('unit.thousand') };
  return { div: 1, step: 1, label: '' };
}
function addVolume(s) {
  const { bars } = s.data;
  const last = bars.length - 1;
  const unit = volumeUnit(bars);
  const metadata = seriesMetadata(unit.step);
  const point = (b) => ({ barId: b.barId, value: b.volume / unit.div });
  s.volUnit = unit;
  const mk = (id) => chart.addSeries('histogram', { id, color: UP_VOLUME, lastValueVisible: false, priceScaleId: 'volume' }, 'main');
  s.volUp = mk('vol-up');
  s.volDown = mk('vol-down');
  s.volLive = mk('vol-live');
  const scale = chart.priceScale('main', 'volume');
  scale.setOverlay(true);
  scale.setMargins({ top: 0.8, bottom: 0 });
  // Price keeps clear of the volume band.
  chart.priceScale('main').setMargins({ top: 0.1, bottom: 0.25 });
  // One transaction: series sharing a scale may not receive metadata one by one.
  chart.applyBatch({ series: [
    { seriesId: s.volUp.id, operation: 'setData', metadata, points: bars.slice(0, last).filter((b) => b.close >= b.open).map(point) },
    { seriesId: s.volDown.id, operation: 'setData', metadata, points: bars.slice(0, last).filter((b) => b.close < b.open).map(point) },
    { seriesId: s.volLive.id, operation: 'setData', metadata, points: [point(bars[last])] },
  ] });
  chart.series(s.volDown.id).setOptions({ color: DOWN_VOLUME });
  paintLiveVolume(s);
}
function paintLiveVolume(s) {
  const b = s.data.bars[s.data.bars.length - 1];
  if (s.volLive) chart.series(s.volLive.id).setOptions({ color: b.close >= b.open ? UP_VOLUME : DOWN_VOLUME });
}
function removeVolume(s) {
  for (const key of ['volUp', 'volDown', 'volLive']) { removeSeriesSafe(s[key]); s[key] = null; }
  chart.priceScale('main').setMargins(null);
}

function indicatorSpec(id) {
  const field = state.chartType === 'line' || state.chartType === 'area' ? 'value' : 'close';
  switch (id) {
    case 'sma': return { type: 'sma', parameters: { period: 20, sourceField: field }, colors: { value: VALUES['ind.sma'] }, label: 'SMA 20' };
    case 'ema': return { type: 'ema', parameters: { period: 50, sourceField: field }, colors: { value: VALUES['ind.ema'] }, label: 'EMA 50' };
    case 'bollinger': return { type: 'bollinger', parameters: { period: 20, k: 2, sourceField: field }, colors: { middle: VALUES['ind.bollingerMiddle'], upper: VALUES['ind.bollingerBand'], lower: VALUES['ind.bollingerBand'] }, label: 'Bollinger 20 2' };
    case 'rsi': return { type: 'rsi', parameters: { period: 14, sourceField: field }, colors: { value: VALUES['ind.rsi'] }, label: 'RSI 14', pane: true, height: 0.32 };
    case 'macd': return { type: 'macd', parameters: { fast: 12, slow: 26, signal: 9, sourceField: field }, colors: { macd: VALUES['ind.macd'], signal: VALUES['ind.macdSignal'], histogram: VALUES['ind.macdHistogram'] }, label: 'MACD 12 26 9', pane: true, height: 0.38 };
    default: return null;
  }
}
function paintOutputs(outputs, spec) {
  for (const [name, color] of Object.entries(spec.colors)) {
    const seriesId = outputs[name];
    if (seriesId) chart.series(seriesId).setOptions({ color, ...(name === 'histogram' ? {} : { lineWidth: 1 }) });
  }
}
function addIndicator(s, id) {
  const spec = indicatorSpec(id);
  if (!spec || s.indicators.has(id)) return;
  const pane = spec.pane ? chart.addPane({ height: spec.height }) : 'main';
  const handle = chart.addIndicator({ type: spec.type, source: 'price', pane, parameters: spec.parameters });
  const outputs = handle.getState().outputSeries;
  paintOutputs(outputs, spec);
  s.indicators.set(id, { handle, spec, pane: spec.pane ? pane : null, outputs });
}
function removeIndicator(s, id) {
  const entry = s.indicators.get(id);
  if (!entry) return;
  entry.handle.remove();
  if (entry.pane) { try { chart.removePane(entry.pane); } catch (error) { showNotice(t('error.removePane', { message: error.message })); } }
  s.indicators.delete(id);
}
function rebuildOverlays(s) {
  for (const id of [...s.indicators.keys()]) removeIndicator(s, id);
  for (const id of INDICATORS.map((i) => i.id)) if (id !== 'volume' && state.indicators.has(id)) addIndicator(s, id);
}

// ----------------------------------------------------------------- legend
function legendRow(className) { const row = document.createElement('div'); row.className = `row ${className}`; return row; }
function span(text, className, color) { const s = document.createElement('span'); s.textContent = text; if (className) s.className = className; if (color) s.style.color = color; return s; }
function bold(text, color) { const b = document.createElement('b'); b.textContent = text; if (color) b.style.color = color; return b; }

function updateLegend(barId, seriesValues) {
  if (!session) return;
  const { bars } = session.data;
  const index = barId === null ? bars.length - 1 : session.index.get(barId);
  const bar = bars[index ?? bars.length - 1];
  const prev = bars[(index ?? bars.length - 1) - 1];
  const decimals = decimalsOf(session.data.step);
  const f = priceFmt(decimals);
  const change = prev ? bar.close - prev.close : 0;
  const pct = prev ? (change / prev.close) * 100 : 0;
  const color = bar.close >= bar.open ? UP : DOWN;
  const rows = [];
  const title = legendRow('title');
  title.append(span(state.instrument.id, ''), span('·', 'dim'), span(nameOf(state.instrument), 'dim'), span('·', 'dim'), span(labelOf(state.interval), 'dim'));
  if (state.live) { const dot = document.createElement('span'); dot.className = 'live'; dot.title = t('legend.liveTitle'); title.append(dot); }
  rows.push(title);
  const ohlc = legendRow('ohlc');
  ohlc.append(span(t('legend.open'), 'k'), bold(f.format(bar.open), color), span(t('legend.high'), 'k'), bold(f.format(bar.high), color), span(t('legend.low'), 'k'), bold(f.format(bar.low), color), span(t('legend.close'), 'k'), bold(f.format(bar.close), color),
    bold(`${sign(change)}${f.format(Math.abs(change))} (${pctText(pct)})`, change >= 0 ? UP : DOWN));
  rows.push(ohlc);
  if (state.indicators.has('volume')) { const vol = legendRow('vol'); vol.append(span(t('legend.volume'), 'k'), bold(compact.format(bar.volume), color)); rows.push(vol); }
  const byId = new Map((seriesValues ?? chart.getSeriesValues(bar.barId) ?? []).map((entry) => [entry.seriesId, entry]));
  for (const [id, entry] of session.indicators) {
    const row = legendRow('ind');
    row.append(span(entry.spec.label, 'name'));
    for (const [name, seriesId] of Object.entries(entry.outputs)) {
      const v = byId.get(seriesId);
      const value = v?.values?.value ?? v?.value ?? null;
      row.append(bold(typeof value === 'number' ? f.format(value) : '∅', entry.spec.colors[name]));
    }
    rows.push(row);
  }
  els.legend.replaceChildren(...rows);
}

// ---------------------------------------------------------------- watchlist
function listRows() {
  const list = LISTS.find((entry) => entry.id === state.listId);
  if (!list) throw new Error(t('list.unknown', { id: state.listId }));
  const members = list.ids ? INSTRUMENTS.filter((instrument) => list.ids.includes(instrument.id)) : INSTRUMENTS;
  return members.map((instrument) => {
    const daily = dailyOf(instrument).bars;
    const last = daily[daily.length - 1].close;
    const prev = daily[daily.length - 2].close;
    return { instrument, last, change: last - prev, pct: ((last - prev) / prev) * 100, decimals: decimalsOf(dailyOf(instrument).step) };
  });
}
function renderWatchlist(liveClose) {
  const rows = listRows();
  els.watchlist.replaceChildren(...rows.map((row) => {
    const live = liveClose !== undefined && row.instrument.id === state.instrument.id;
    const last = live ? liveClose : row.last;
    const prevClose = row.last - row.change;
    const change = last - prevClose;
    const pct = (change / prevClose) * 100;
    const f = priceFmt(row.decimals);
    const color = change >= 0 ? 'up' : 'down';
    const tr = document.createElement('tr');
    if (row.instrument.id === state.instrument.id) tr.setAttribute('aria-current', 'true');
    const th = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'row-btn';
    button.setAttribute('aria-label', `${row.instrument.id}, ${nameOf(row.instrument)}`);
    const logo = document.createElement('span'); logo.className = 'logo'; logo.textContent = row.instrument.id.slice(-2); logo.setAttribute('aria-hidden', 'true');
    button.append(logo, document.createTextNode(row.instrument.id));
    // The whole row is the target; a click on the button (keyboard Enter or Space) bubbles to the row.
    tr.addEventListener('click', () => selectInstrument(row.instrument));
    th.append(button);
    const cell = (text, cls) => { const td = document.createElement('td'); const s = document.createElement('span'); s.className = `cell ${cls ?? ''}`; s.textContent = text; td.append(s); return td; };
    tr.append(th, cell(f.format(last)), cell(`${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${sign(change)}${f.format(Math.abs(change))}`, color),
      cell(pctText(pct), color));
    return tr;
  }));
}
function renderDetails(liveClose) {
  const { instrument } = state;
  const daily = dailyOf(instrument);
  const bars = daily.bars;
  const today = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const f = priceFmt(decimalsOf(daily.step));
  const close = liveClose ?? today.close;
  const change = close - prev.close;
  const pct = (change / prev.close) * 100;
  const color = change >= 0 ? 'up' : 'down';
  const name = document.createElement('div'); name.className = 'name';
  const logo = document.createElement('span'); logo.className = 'logo'; logo.textContent = instrument.id.slice(-2); logo.setAttribute('aria-hidden', 'true');
  name.append(logo, document.createTextNode(`${instrument.id} · ${nameOf(instrument)}`));
  const price = document.createElement('div'); price.className = 'price'; price.textContent = f.format(close);
  const chg = document.createElement('div'); chg.className = `chg ${color}`;
  chg.textContent = `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${sign(change)}${f.format(Math.abs(change))}  ${pctText(pct)}`;
  const dl = document.createElement('dl');
  const stat = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  stat(t('detail.open'), f.format(today.open)); stat(t('detail.high'), f.format(Math.max(today.high, close))); stat(t('detail.low'), f.format(Math.min(today.low, close)));
  stat(t('detail.prevClose'), f.format(prev.close)); stat(t('detail.volume'), compact.format(today.volume));
  els.details.replaceChildren(name, price, chg, dl);
}

// ------------------------------------------------------------------- alerts
// Alerts are level alerts on the price series: the engine reports a crossing, the line on the chart can be dragged.
// They are evaluated against the simulated stream only, so they are idle while the stream is switched off.
const ALERT_UNITS = 'demo';
let alertCounter = 0;
let placingAlert = false;
const alertsFor = () => { if (!state.alerts.has(state.instrument.id)) state.alerts.set(state.instrument.id, []); return state.alerts.get(state.instrument.id); };
const alertLeft = () => ({ kind: 'series', seriesId: 'price', field: state.chartType === 'line' || state.chartType === 'area' ? 'value' : 'close', units: ALERT_UNITS });
const alertLevel = (record, decimals) => t(record.operation === 'crossUp' ? 'alert.levelUp' : 'alert.levelDown', { price: priceFmt(decimals).format(record.price) });
const alertText = (record, decimals) => `${record.operation === 'crossUp' ? '▲' : '▼'} ${alertLevel(record, decimals)}`;

function registerAlert(record) {
  record.engineId = `alert-${++alertCounter}`;
  chart.alerts.add({
    id: record.engineId,
    // The line label shows the name; the level itself stays readable on the price axis while the line is dragged.
    name: t(record.operation === 'crossUp' ? 'alert.nameUp' : 'alert.nameDown', { id: state.instrument.id }),
    left: alertLeft(),
    right: { kind: 'constant', value: record.price, units: ALERT_UNITS },
    operation: record.operation,
    mode: 'once',
    observationMode: 'partial',
  });
}
function syncAlerts() {
  for (const entry of chart.alerts.list()) chart.alerts.remove(entry.id);
  for (const record of alertsFor()) registerAlert(record);
  renderAlerts();
}
function renderAlerts() {
  const records = alertsFor();
  const decimals = decimalsOf(session.data.step);
  const title = document.createElement('h3'); title.textContent = t('alerts.title');
  if (records.length === 0) {
    const hint = document.createElement('p'); hint.textContent = t('alert.empty');
    els.alerts.replaceChildren(title, hint);
    return;
  }
  const list = document.createElement('ul');
  for (const record of records) {
    const item = document.createElement('li');
    const label = document.createElement('span'); label.textContent = alertText(record, decimals);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '✕';
    remove.setAttribute('aria-label', t('alert.removeAria', { text: alertText(record, decimals) }));
    remove.addEventListener('click', () => removeAlert(record));
    item.append(label, remove);
    list.append(item);
  }
  els.alerts.replaceChildren(title, list);
}
function dropAlertRecord(engineId) {
  const records = alertsFor();
  const index = records.findIndex((record) => record.engineId === engineId);
  if (index >= 0) records.splice(index, 1);
  return index >= 0;
}
function removeAlert(record) {
  try { chart.alerts.remove(record.engineId); } catch (error) { showNotice(t('error.alertRemove', { message: error.message })); return; }
  dropAlertRecord(record.engineId);
  renderAlerts();
  announce(t('alert.removed'));
}
function addAlertAt(price) {
  const step = session.data.step;
  const level = Number((Math.round(price / step) * step).toFixed(decimalsOf(step)));
  const bars = session.data.bars;
  const record = { price: level, operation: level >= bars[bars.length - 1].close ? 'crossUp' : 'crossDown', engineId: null };
  registerAlert(record);
  alertsFor().push(record);
  renderAlerts();
  announce(t('alert.created', { text: alertText(record, decimalsOf(step)) }));
}
function onAlertEvent(event) {
  if (event.type === 'alert-updated') {
    const record = alertsFor().find((entry) => entry.engineId === event.alertId);
    if (record) { record.price = chart.alerts.get(event.alertId).definition.right.value; renderAlerts(); }
  } else if (event.type === 'alert-event') {
    const record = alertsFor().find((entry) => entry.engineId === event.alertId);
    if (!record) return;
    const text = t('alert.fired', { id: state.instrument.id, text: alertLevel(record, decimalsOf(session.data.step)) });
    dropAlertRecord(event.alertId);
    const s = session;
    // The engine is still dispatching this event; remove the finished alert afterwards.
    queueMicrotask(() => { if (session !== s) return; try { chart.alerts.remove(event.alertId); } catch (error) { showNotice(t('error.alertRemove', { message: error.message })); } renderAlerts(); });
    showNotice(text, 'info');
    setTimeout(() => { if (els.notice.textContent === text) clearNotice(); }, 8000);
  }
}
function observeAlerts(s, bar) {
  const version = ++s.alertVersion;
  chart.alerts.observe({
    version: String(version), prevVersion: version > 1 ? String(version - 1) : null, state: 'partial', barId: bar.barId,
    values: { [sourceKey(alertLeft())]: bar.close },
  });
}
function setPlacingAlert(on) {
  placingAlert = on;
  $('alert-button').setAttribute('aria-pressed', String(on));
  els.chart.classList.toggle('placing-alert', on);
  if (on) showNotice(t('alert.place'), 'info');
  else if (els.notice.dataset.kind === 'info') clearNotice();
}
// Capture phase on the chart host: a placement click must not also start a pan or a drawing.
els.chart.addEventListener('pointerdown', (event) => {
  if (!placingAlert) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const price = session?.hoverPrice;
  setPlacingAlert(false);
  try {
    if (!Number.isFinite(price)) throw new Error(t('alert.noPrice'));
    addAlertAt(price);
  } catch (error) { showNotice(t('error.alertCreate', { message: error.message })); }
}, true);
document.addEventListener('keydown', (event) => { if (placingAlert && event.key === 'Escape') setPlacingAlert(false); });

// -------------------------------------------------------------- list select
function populateLists() {
  els.listSelect.replaceChildren(...LISTS.map((list) => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = `${list.label} (${list.ids ? list.ids.length : INSTRUMENTS.length})`;
    return option;
  }));
  els.listSelect.value = state.listId;
}
els.listSelect.addEventListener('change', () => {
  state.listId = els.listSelect.value;
  renderWatchlist();
  announce(t('list.announce', { name: LISTS.find((list) => list.id === state.listId).label }));
});

// ------------------------------------------------------------ chart session
function teardown() {
  if (!session) return;
  clearInterval(session.timer);
  session.ui?.destroy();
  for (const off of session.unsubscribe) { try { off(); } catch { /* subscription already closed */ } }
  try { chart.destroy(); } catch (error) { showNotice(t('error.destroy', { message: error.message })); }
  chart = null; session = null;
}

function setVisibleBars(count) {
  const n = session.data.bars.length;
  chart.indexScale().setVisibleRange({ from: Math.max(-0.5, n - count), to: n + 9 });
  chart.priceScale('main').setAutoScale(true);
}

function build() {
  // The time window the user was looking at stays when the instrument or the interval changes.
  const remembered = chart && session ? captureWindow(chart, session.intervalId) : null;
  teardown();
  clearNotice();
  const data = dataFor(state.instrument, state.interval);
  const s = { data, intervalId: state.interval.id, index: new Map(data.bars.map((b, i) => [b.barId, i])), indicators: new Map(), unsubscribe: [], alertVersion: 0, hoverPrice: null, ticker: createTicker(`${state.instrument.id}|${state.interval.id}`, state.instrument, data.step) };
  session = s;
  try {
    chart = createChart(els.chart, chartOptions(data.step));
    attachChartFeatures(chart, { context: { instrumentId: `DEMO:${state.instrument.id}`, interval: state.interval.id, sourceId: 'synthetic-demo' }, interaction: {} });
    s.ui = createUiController(chart, { interaction: chart.interaction });
    chart.timeline.setTimeline(data.slots);
    addPrice(s);
    if (state.indicators.has('volume')) addVolume(s);
    rebuildOverlays(s);
    chart.interaction.setDrawingSnap(magnetSnap());
    chart.interaction.setDrawingStyle(settings.drawingValues());
    syncAlerts();
  } catch (error) {
    teardown();
    showNotice(t('error.build', { message: error.message }));
    return;
  }
  const targetBars = state.interval.id === 'W' ? 110 : state.interval.id === 'D' ? 140 : 130;
  // Set before the first frame: the default view fits the whole history, so waiting for a later frame would paint
  // every bar squeezed first and then jump to the working window. A window carried over from the previous chart
  // wins when this series has bars inside it; otherwise the working window of the interval is used.
  try {
    const carried = remembered ? windowRange(data.slots, remembered, state.interval.id) : null;
    if (carried) {
      chart.indexScale().setVisibleRange(carried);
      chart.priceScale('main').setAutoScale(true);
      chart.indexScale().setFollowRealTime(remembered.rightTime >= data.slots[data.slots.length - 1].time);
    } else {
      setVisibleBars(targetBars);
      chart.indexScale().setFollowRealTime(true);
    }
  } catch (error) { showNotice(t('error.visibleRange', { message: error.message })); }
  els.toRealtime.hidden = true;
  s.unsubscribe.push(chart.subscribe('visibleRangeChange', (payload) => {
    els.toRealtime.hidden = chart.indexScale().isFollowingRealTime();
    $('auto').setAttribute('aria-pressed', String(chart.priceScale('main').isAutoScale()));
  }));
  s.unsubscribe.push(chart.subscribe('crosshairMove', (payload) => {
    s.hoverBarId = payload.insideHistory ? payload.barId : null;
    s.hoverPrice = payload.paneId === 'main' && Number.isFinite(payload.price) ? payload.price : null;
    updateLegend(s.hoverBarId, payload.insideHistory ? payload.series : undefined);
  }));
  s.unsubscribe.push(chart.subscribe('error', ({ operation, error }) => showNotice(`${operation}: ${error?.message ?? error}`)));
  s.unsubscribe.push(chart.alerts.subscribe(onAlertEvent));
  s.unsubscribe.push(chart.drawings.subscribe(() => { syncHistoryButtons(); syncDrawingStateButtons(); settingsPanel.refreshSelection(); }));
  s.unsubscribe.push(chart.interaction.subscribe('toolChange', ({ toolId }) => { state.tool = toolId; syncToolButtons(); }));
  state.tool = null;
  syncToolButtons();
  syncHistoryButtons();
  syncDrawingStateButtons();
  updateLegend(null);
  renderWatchlist();
  renderDetails();
  startLive();
}

function startLive() {
  clearInterval(session.timer);
  if (!state.live) return;
  const s = session;
  s.timer = setInterval(() => {
    if (document.hidden || session !== s) return;
    try {
      const bars = s.data.bars;
      const next = s.ticker(bars[bars.length - 1]);
      bars[bars.length - 1] = next;
      s.price.update(state.chartType === 'line' || state.chartType === 'area' ? { barId: next.barId, value: next.close } : next);
      if (s.volLive) { s.volLive.update({ barId: next.barId, value: next.volume / s.volUnit.div }); paintLiveVolume(s); }
      updateLegend(s.hoverBarId ?? null);
      renderDetails(next.close);
      renderWatchlist(next.close);
      observeAlerts(s, next);
    } catch (error) { clearInterval(s.timer); showNotice(t('error.liveStopped', { message: error.message })); }
  }, 1000);
}

// ------------------------------------------------------------------ toolbar
function selectInstrument(instrument) {
  if (instrument.id === state.instrument.id) return;
  state.instrument = instrument;
  syncSymbol();
  build();
  announce(t('announce.instrument', { id: instrument.id, name: nameOf(instrument) }));
}
function selectInterval(interval) {
  if (interval.id === state.interval.id) return;
  state.interval = interval;
  syncIntervals();
  build();
  announce(t('announce.interval', { label: labelOf(interval) }));
}
function syncSymbol() {
  $('symbol-text').textContent = state.instrument.id;
  $('symbol-logo').textContent = state.instrument.id.slice(-2);
}
function syncIntervals() {
  for (const button of $('intervals').children) button.setAttribute('aria-pressed', String(button.dataset.id === state.interval.id));
}
function syncType() {
  const type = CHART_TYPES.find((entry) => entry.id === state.chartType);
  $('type-button').innerHTML = `<span class="icon">${svg(type.icon)}</span><span></span>`;
  $('type-button').lastElementChild.textContent = type.label;
  $('type-button').setAttribute('aria-label', t('type.current', { label: type.label }));
  $('type-button').title = t('type.current', { label: type.label });
}
function syncHistoryButtons() {
  $('undo').disabled = !chart?.drawings?.canUndo();
  $('redo').disabled = !chart?.drawings?.canRedo();
}
// Hide and lock act on every drawing and group at once. Pressed means all are hidden or locked; an empty or
// unavailable store keeps the button focusable (aria-disabled) with the reason as its title, as the rail does.
function syncDrawingStateButtons() {
  const summary = typeof chart?.drawings?.summary === 'function' ? chart.drawings.summary() : null;
  for (const [id, flag, pressedState] of [['hide-all', 'visible', 'none'], ['lock-all', 'locked', 'all']]) {
    const button = document.getElementById(id);
    if (!button) continue;
    const reason = summary === null ? t('tool.bulkUnavailable') : (summary[flag] === null ? t('tool.bulkEmpty') : '');
    button.setAttribute('aria-pressed', String(summary !== null && summary[flag] === pressedState));
    if (reason) button.setAttribute('aria-disabled', 'true'); else button.removeAttribute('aria-disabled');
    const name = t(flag === 'visible' ? 'tool.hideAll' : 'tool.lockAll');
    button.setAttribute('aria-label', reason ? `${name}: ${reason}` : name);
    button.title = reason ? `${name}: ${reason}` : name;
  }
}

for (const interval of INTERVALS) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'interval'; button.dataset.id = interval.id; button.textContent = labelOf(interval);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => selectInterval(interval));
  $('intervals').append(button);
}
$('symbol-button').addEventListener('click', () => { els.terminal.classList.add('show-side'); document.querySelector('#watchlist .row-btn')?.focus(); });
$('type-button').addEventListener('click', (event) => showMenu(event.currentTarget, (panel, close) => {
  for (const type of CHART_TYPES) menuItem(panel, type.label, { icon: type.icon, checked: type.id === state.chartType, onClick: () => { close(); changeType(type.id); } });
}));
function changeType(id) {
  if (id === state.chartType) return;
  state.chartType = id;
  syncType();
  const s = session;
  try {
    for (const key of [...s.indicators.keys()]) removeIndicator(s, key);
    removeSeriesSafe(s.price);
    addPrice(s);
    rebuildOverlays(s);
    syncAlerts();
    updateLegend(null);
  } catch (error) { showNotice(t('error.changeType', { message: error.message })); }
}
$('indicators-button').addEventListener('click', (event) => showMenu(event.currentTarget, (panel) => {
  const h = document.createElement('h3'); h.textContent = t('indicators.title'); panel.append(h);
  for (const ind of INDICATORS) {
    menuItem(panel, ind.label, { checked: state.indicators.has(ind.id), onClick: () => toggleIndicator(ind.id) });
  }
}));
function toggleIndicator(id) {
  const s = session;
  const on = !state.indicators.has(id);
  try {
    if (on) { state.indicators.add(id); if (id === 'volume') addVolume(s); else addIndicator(s, id); }
    else { state.indicators.delete(id); if (id === 'volume') removeVolume(s); else removeIndicator(s, id); }
    updateLegend(null);
    announce(t(on ? 'indicator.on' : 'indicator.off', { label: INDICATORS.find((i) => i.id === id).label }));
  } catch (error) { if (on) state.indicators.delete(id); else state.indicators.add(id); showNotice(t('error.indicator', { message: error.message })); }
  closeMenu();
}
$('undo').addEventListener('click', () => { chart.drawings.undo(); syncHistoryButtons(); });
$('redo').addEventListener('click', () => { chart.drawings.redo(); syncHistoryButtons(); });
$('alert-button').addEventListener('click', () => setPlacingAlert(!placingAlert));
$('live-toggle').addEventListener('click', (event) => {
  state.live = !state.live;
  event.currentTarget.setAttribute('aria-pressed', String(state.live));
  startLive(); updateLegend(null);
  announce(t(state.live ? 'announce.liveOn' : 'announce.liveOff'));
});
// ----------------------------------------------------------------- settings
// A change reaches the chart that exists (chart options, price series, volume, indicators, the default style of new
// drawings), the side panel and the legend without a rebuild, so drawings and the view stay.
function applySettings() {
  refreshColors();
  document.documentElement.dataset.theme = state.theme;
  const s = session;
  if (!s) return;
  try {
    chart.applyOptions(themeOptions());
    chart.series(s.price.id).setOptions({ ...priceSeriesOptions(), priceLine: priceLineOptions() });
    if (s.volUp) {
      chart.series(s.volUp.id).setOptions({ color: UP_VOLUME });
      chart.series(s.volDown.id).setOptions({ color: DOWN_VOLUME });
      paintLiveVolume(s);
    }
    for (const [id, entry] of s.indicators) paintOutputs(entry.outputs, indicatorSpec(id));
    chart.interaction.setDrawingStyle(settings.drawingValues());
  } catch (error) { showNotice(t('error.settings', { message: error.message })); }
  updateLegend(s.hoverBarId ?? null);
  renderWatchlist();
  renderDetails();
}
function setTheme(name) {
  state.theme = name;
  try { settings.setActiveTheme(name); } catch (error) { showNotice(t('settings.error.save', { message: error.message })); }
}
$('theme').addEventListener('click', () => setTheme(state.theme === 'dark' ? 'light' : 'dark'));
const settingsPanel = createSettingsPanel({
  settings, t, getTheme: () => state.theme, setTheme, getChart: () => chart, button: $('settings'),
  onError: (message) => showNotice(message), onAnnounce: announce,
});
settings.subscribe(applySettings);
$('snapshot').addEventListener('click', async () => {
  try {
    const result = await exportChartPng(chart, { chartId: chart.id });
    const blob = result instanceof Blob ? result : result?.blob;
    if (!(blob instanceof Blob)) throw new Error(t('error.exportEmpty'));
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${state.instrument.id}-${state.interval.id}-demo.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce(t('announce.snapshot'));
  } catch (error) { showNotice(t('error.snapshot', { message: error.message })); }
});
$('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch((error) => showNotice(t('error.fullscreen', { message: error.message })));
});
$('side-toggle').addEventListener('click', (event) => {
  const open = els.terminal.classList.toggle('show-side');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
els.toRealtime.addEventListener('click', () => chart.indexScale().scrollToRealTime());

// -------------------------------------------------------------- draw toolbar
// The tool list, its groups and the labels in the chart language come from the library's own model; arming goes
// through the headless controller, so a refusal (for example a tool that needs data) arrives as a reason to show.
const toolControls = createToolbarModel({ locale: i18n.locale }).groups.find((group) => group.id === 'tools').controls;
const TOOL_GROUPS = [...new Set(toolControls.map((control) => control.group))].map((id) => {
  const tools = toolControls.filter((control) => control.group === id);
  return { id, label: tools[0].groupLabel, tools };
});
const toolLabels = new Map(toolControls.map((control) => [control.value, control.label]));
const lastToolOfGroup = new Map(TOOL_GROUPS.map((group) => [group.id, group.tools[0].value]));
const groupButtons = new Map();
const cursorButton = document.createElement('button');
cursorButton.type = 'button'; cursorButton.className = 'tool-btn';
cursorButton.setAttribute('aria-label', t('tool.cursor')); cursorButton.title = t('tool.cursor');
cursorButton.innerHTML = `<span class="icon">${svg('cursor')}</span>`;
cursorButton.addEventListener('click', () => setActiveTool(null));
$('drawbar').append(cursorButton);
for (const group of TOOL_GROUPS) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'tool-btn tool-group';
  button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<span class="icon"></span>';
  button.addEventListener('click', () => showMenu(button, (panel, close) => {
    const heading = document.createElement('h3');
    heading.textContent = group.label;
    panel.append(heading);
    for (const tool of group.tools) {
      menuItem(panel, tool.label, { checked: state.tool === tool.value, mark: false, iconNode: createIcon(document, tool.value, { size: 18 }), onClick: () => { close(); setActiveTool(tool.value); } });
    }
  }, { placement: 'right' }));
  groupButtons.set(group.id, button);
  $('drawbar').append(button);
}
// The group button shows the tool last used from that group and is active while one of its tools is armed.
function syncToolButtons() {
  cursorButton.classList.toggle('active', state.tool === null);
  for (const group of TOOL_GROUPS) {
    const button = groupButtons.get(group.id);
    const armed = group.tools.some((control) => control.value === state.tool);
    if (armed) lastToolOfGroup.set(group.id, state.tool);
    const current = lastToolOfGroup.get(group.id);
    button.classList.toggle('active', armed);
    button.querySelector('.icon').replaceChildren(createIcon(document, current, { size: 20 }));
    const name = `${group.label}: ${toolLabels.get(current)}`;
    button.title = name; button.setAttribute('aria-label', name);
  }
}
function setActiveTool(id) {
  try {
    if (id === null) { chart.interaction.setTool(null); return; }
    const result = session.ui.run(`tool:${id}`);
    if (!result.ok) showNotice(result.reason);
  } catch (error) { showNotice(t('error.tool', { message: error.message })); }
}
syncToolButtons();
{
  const gap = document.createElement('span'); gap.className = 'gap'; $('drawbar').append(gap);
  const magnet = document.createElement('button');
  magnet.type = 'button'; magnet.className = 'tool-btn'; magnet.title = t('tool.magnet'); magnet.setAttribute('aria-label', t('tool.magnet')); magnet.setAttribute('aria-pressed', 'false');
  magnet.innerHTML = `<span class="icon">${svg('magnet')}</span>`;
  magnet.addEventListener('click', () => {
    state.magnet = !state.magnet;
    magnet.setAttribute('aria-pressed', String(state.magnet));
    try { chart.interaction.setDrawingSnap(magnetSnap()); } catch (error) { showNotice(t('error.magnet', { message: error.message })); }
  });
  const trash = document.createElement('button');
  trash.type = 'button'; trash.className = 'tool-btn'; trash.title = t('tool.clear'); trash.setAttribute('aria-label', t('tool.clear'));
  trash.innerHTML = `<span class="icon">${svg('trash')}</span>`;
  trash.addEventListener('click', () => { try { chart.interaction.setTool(null); chart.drawings.clear(); } catch (error) { showNotice(t('error.clear', { message: error.message })); } });
  const bulkButton = (id, icon, flag, setAll) => {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tool-btn'; button.id = id; button.setAttribute('aria-pressed', 'false');
    button.innerHTML = `<span class="icon">${svg(icon)}</span>`;
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-disabled') === 'true') { showNotice(button.title); return; }
      try {
        // A mixed state hides or locks everything first; only a fully hidden or locked set is reversed.
        const summary = chart.drawings.summary();
        chart.drawings[setAll](flag === 'visible' ? summary.visible === 'none' : summary.locked !== 'all');
      } catch (error) { showNotice(t('error.bulk', { message: error.message })); }
    });
    return button;
  };
  $('drawbar').append(magnet, bulkButton('hide-all', 'eyeOff', 'visible', 'setAllVisible'),
    bulkButton('lock-all', 'lock', 'locked', 'setAllLocked'), trash);
  syncDrawingStateButtons();
}

// ---------------------------------------------------------------- range bar
for (const range of RANGES) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'range'; button.textContent = range.label; button.title = t('range.show', { label: range.label });
  button.addEventListener('click', () => applyRange(range));
  $('ranges').append(button);
}
function applyRange(range) {
  const { slots } = session.data;
  const n = slots.length;
  if (range.all) { chart.indexScale().fitContent(); chart.priceScale('main').setAutoScale(true); return; }
  const lastTime = slots[n - 1].time;
  let target;
  if (range.ytd) target = Date.UTC(new Date(lastTime).getUTCFullYear(), 0, 1);
  else target = lastTime - range.days * 86_400_000;
  let lo = 0; let hi = n - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (slots[mid].time >= target) hi = mid; else lo = mid + 1; }
  const from = Math.min(lo, n - 24);
  chart.indexScale().setVisibleRange({ from: Math.max(-0.5, from - 0.5), to: n + 9 });
  chart.priceScale('main').setAutoScale(true);
}
$('log').addEventListener('click', (event) => {
  const on = event.currentTarget.getAttribute('aria-pressed') !== 'true';
  try { chart.priceScale('main').setMode(on ? 'log' : 'linear'); event.currentTarget.setAttribute('aria-pressed', String(on)); }
  catch (error) { showNotice(t('error.logScale', { message: error.message })); }
});
$('auto').addEventListener('click', () => { chart.priceScale('main').setAutoScale(true); $('auto').setAttribute('aria-pressed', 'true'); });
const clockText = () => `${fmtClock.format(Date.now())} (${t('clock.zone')})`;
setInterval(() => { els.clock.textContent = clockText(); }, 1000);
els.clock.textContent = clockText();

syncSymbol(); syncIntervals(); syncType(); populateLists();
// Settings are read after the UI exists so that a corrupt record can be reported; the defaults stay in place then.
let loadError = null;
try { settings.load(); } catch (error) { loadError = error; }
state.theme = settings.activeTheme();
document.documentElement.dataset.theme = state.theme;
refreshColors();
build();
if (loadError) showNotice(t('settings.error.load', { message: loadError.message }));
window.addEventListener('pagehide', teardown);
