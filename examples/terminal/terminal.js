// Terminal example built only on the public vibecharts API.
// All instruments, prices and volumes are SYNTHETIC (see data.js).
import { createChart, attachChartFeatures } from 'vibecharts';
import { exportChartPng } from 'vibecharts/workspaces';
import { INSTRUMENTS, INTERVALS, generateSeries, decimalsOf, createTicker } from './data.js';

const TZ = 'Europe/Moscow';
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const UP = '#3fa77f';
const DOWN = '#d9645a';
const BLUE = '#4a9fd0';
const ORANGE = '#e0a84a';
const PURPLE = '#9a7fd1';

const THEMES = {
  dark: { theme: 'dark', layout: { background: '#10161c', textColor: '#aeb8c3', fontSize: 12, fontFamily: FONT }, grid: { visible: true, color: '#1b232b' },
    crosshair: { visible: true, color: '#7d8d9c', labelBackground: '#303b47', labelTextColor: '#ffffff' }, priceScale: { borderColor: '#2b3540', textColor: '#aeb8c3' },
    timeScale: { borderColor: '#2b3540', textColor: '#aeb8c3' } },
  light: { theme: 'light', layout: { background: '#ffffff', textColor: '#1d2630', fontSize: 12, fontFamily: FONT }, grid: { visible: true, color: '#ebeff2' },
    crosshair: { visible: true, color: '#8a97a4', labelBackground: '#d8dee4', labelTextColor: '#1d2630' }, priceScale: { borderColor: '#d8dee4', textColor: '#1d2630' },
    timeScale: { borderColor: '#d8dee4', textColor: '#1d2630' } },
};

const ICONS = {
  cursor: '<path d="M6 4l11 8-5 1.2 3 5.8-2.2 1.1-3-5.8L6 17z"/>',
  segment: '<circle cx="6" cy="17" r="2"/><circle cx="18" cy="7" r="2"/><path d="M7.5 15.5l9-7"/>',
  ray: '<circle cx="6" cy="17" r="2"/><path d="M7.5 15.5L20 6"/><path d="M15 6h5v5"/>',
  horizontal: '<path d="M3 12h18"/><circle cx="12" cy="12" r="2"/>',
  vertical: '<path d="M12 3v18"/><circle cx="12" cy="12" r="2"/>',
  channel: '<path d="M4 15l13-8"/><path d="M7 20l13-8"/><circle cx="4" cy="15" r="1.5"/><circle cx="17" cy="7" r="1.5"/>',
  fib: '<path d="M3 5h18M3 10h12M3 15h12M3 20h18"/><path d="M5 20L19 5" stroke-dasharray="2 2"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
  text: '<path d="M6 6h12M12 6v13M9 19h6"/>',
  measure: '<rect x="3" y="9" width="18" height="6" rx="1" transform="rotate(-35 12 12)"/><path d="M8 13l1.5 1.2M11 11l1.5 1.2M14 9l1.5 1.2" />',
  magnet: '<path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
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
};
const svg = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;

const $ = (id) => document.getElementById(id);
const els = {
  terminal: $('terminal'), chart: $('chart'), legend: $('legend'), notice: $('notice'), status: $('status'), clock: $('clock'),
  toRealtime: $('to-realtime'), watchlist: $('watchlist'), details: $('details'),
};
for (const node of document.querySelectorAll('[data-icon]')) node.innerHTML = svg(node.dataset.icon);

const CHART_TYPES = [
  { id: 'candles', label: 'Свечи', icon: 'candles' },
  { id: 'bars', label: 'Бары', icon: 'bars' },
  { id: 'line', label: 'Линия', icon: 'line' },
  { id: 'area', label: 'Область', icon: 'area' },
];
const INDICATORS = [
  { id: 'volume', label: 'Объём' },
  { id: 'sma', label: 'Скользящая средняя (SMA 20)' },
  { id: 'ema', label: 'Экспоненциальная средняя (EMA 50)' },
  { id: 'bollinger', label: 'Полосы Боллинджера (20, 2)' },
  { id: 'rsi', label: 'RSI (14)' },
  { id: 'macd', label: 'MACD (12, 26, 9)' },
];
const DRAW_TOOLS = [
  { id: null, label: 'Курсор', icon: 'cursor' },
  { id: 'segment', label: 'Трендовая линия', icon: 'segment' },
  { id: 'ray', label: 'Луч', icon: 'ray' },
  { id: 'horizontalLevel', label: 'Горизонтальная линия', icon: 'horizontal' },
  { id: 'verticalLine', label: 'Вертикальная линия', icon: 'vertical' },
  { id: 'parallelChannel', label: 'Параллельный канал', icon: 'channel' },
  { id: 'fibRetracement', label: 'Коррекция Фибоначчи', icon: 'fib' },
  { id: 'rectangle', label: 'Прямоугольник', icon: 'rect' },
  { id: 'text', label: 'Текст', icon: 'text' },
  { id: 'measure', label: 'Линейка', icon: 'measure' },
];
const RANGES = [
  { id: '1d', label: '1Д', days: 1 }, { id: '5d', label: '5Д', days: 5 }, { id: '1m', label: '1М', days: 30 },
  { id: '3m', label: '3М', days: 91 }, { id: '6m', label: '6М', days: 182 }, { id: 'ytd', label: 'С нач. года', ytd: true },
  { id: '1y', label: '1Г', days: 365 }, { id: 'all', label: 'Все', all: true },
];

const state = {
  instrument: INSTRUMENTS[0], interval: INTERVALS[3], chartType: 'candles', theme: 'dark',
  indicators: new Set(['volume', 'sma']), live: true, tool: null, magnet: false,
};

// ---------------------------------------------------------------- formatting
const priceFmt = (decimals) => new Intl.NumberFormat('ru-RU', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 2 });
const fmtCrossDate = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' });
const fmtHour = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const fmtClock = new Intl.DateTimeFormat('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '');

// -------------------------------------------------------------------- menus
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.panel.remove();
  openMenu.button.setAttribute('aria-expanded', 'false');
  openMenu.button.focus();
  openMenu = null;
}
function showMenu(button, build) {
  if (openMenu) { const same = openMenu.button === button; closeMenu(); if (same) return; }
  const panel = document.createElement('div');
  panel.className = 'menu';
  panel.setAttribute('role', 'menu');
  build(panel, closeMenu);
  button.parentElement.append(panel);
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
function menuItem(parent, label, { checked, icon, onClick }) {
  const item = document.createElement('button');
  item.type = 'button';
  item.setAttribute('role', checked === undefined ? 'menuitem' : 'menuitemcheckbox');
  if (checked !== undefined) item.setAttribute('aria-checked', String(checked));
  const mark = document.createElement('span');
  mark.className = 'check';
  mark.textContent = checked ? '✓' : '';
  item.append(mark);
  if (icon) { const i = document.createElement('span'); i.className = 'icon'; i.innerHTML = svg(icon); item.append(i); }
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
function showNotice(message) { els.notice.textContent = message; els.notice.hidden = false; announce(message); }
function clearNotice() { els.notice.hidden = true; els.notice.textContent = ''; }

function chartOptions(step) {
  const theme = THEMES[state.theme];
  return {
    ...theme, locale: 'ru-RU', timeZone: TZ, autoSize: true,
    accessibilityLabel: `График ${state.instrument.id}, ${state.interval.label}. Синтетические демонстрационные данные.`,
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
  const common = { id: 'price', lastValueVisible: true, priceLine: { style: 'dashed' }, lastValueColorMode: 'direction' };
  const type = state.chartType;
  if (type === 'candles') {
    s.price = chart.addSeries('candlestick', { ...common, upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN, equalColor: '#8793a0' }, 'main');
  } else if (type === 'bars') {
    s.price = chart.addSeries('bar', { ...common, upColor: UP, downColor: DOWN }, 'main');
  } else if (type === 'line') {
    s.price = chart.addSeries('line', { ...common, color: BLUE, lineWidth: 2 }, 'main');
  } else {
    s.price = chart.addSeries('area', { ...common, lineColor: BLUE, lineWidth: 2, fillColor: 'rgba(74, 159, 208, 0.14)', basePrice: Math.min(...bars.map((b) => b.low)) }, 'main');
  }
  s.price.setData(pointsFor(type, bars), metadata);
}
function removeSeriesSafe(series) { if (series) { try { chart.removeSeries(series); } catch (error) { showNotice(`Не удалось удалить ряд: ${error.message}`); } } }

// Volume is drawn on an overlay scale in the lower fifth of the main pane: its own range, no axis column.
const UP_VOLUME = 'rgba(8, 153, 129, 0.55)';
const DOWN_VOLUME = 'rgba(242, 54, 69, 0.55)';
const seriesMetadata = (step) => ({ instrumentId: `DEMO:${state.instrument.id}`, interval: state.interval.id, sourceId: 'synthetic-demo', board: 'DEMO', priceStep: step });
function volumeUnit(bars) {
  const max = bars.reduce((m, b) => Math.max(m, b.volume), 0);
  if (max >= 1e6) return { div: 1e6, step: 0.01, label: 'млн' };
  if (max >= 1e3) return { div: 1e3, step: 0.1, label: 'тыс' };
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
    case 'sma': return { type: 'sma', parameters: { period: 20, sourceField: field }, colors: { value: BLUE }, label: 'SMA 20' };
    case 'ema': return { type: 'ema', parameters: { period: 50, sourceField: field }, colors: { value: ORANGE }, label: 'EMA 50' };
    case 'bollinger': return { type: 'bollinger', parameters: { period: 20, k: 2, sourceField: field }, colors: { middle: ORANGE, upper: BLUE, lower: BLUE }, label: 'Bollinger 20 2' };
    case 'rsi': return { type: 'rsi', parameters: { period: 14, sourceField: field }, colors: { value: PURPLE }, label: 'RSI 14', pane: true, height: 0.32 };
    case 'macd': return { type: 'macd', parameters: { fast: 12, slow: 26, signal: 9, sourceField: field }, colors: { macd: BLUE, signal: ORANGE, histogram: UP }, label: 'MACD 12 26 9', pane: true, height: 0.38 };
    default: return null;
  }
}
function addIndicator(s, id) {
  const spec = indicatorSpec(id);
  if (!spec || s.indicators.has(id)) return;
  const pane = spec.pane ? chart.addPane({ height: spec.height }) : 'main';
  const handle = chart.addIndicator({ type: spec.type, source: 'price', pane, parameters: spec.parameters });
  const outputs = handle.getState().outputSeries;
  for (const [name, color] of Object.entries(spec.colors)) {
    const seriesId = outputs[name];
    if (seriesId) chart.series(seriesId).setOptions({ color, ...(name === 'histogram' ? {} : { lineWidth: 1 }) });
  }
  s.indicators.set(id, { handle, spec, pane: spec.pane ? pane : null, outputs });
}
function removeIndicator(s, id) {
  const entry = s.indicators.get(id);
  if (!entry) return;
  entry.handle.remove();
  if (entry.pane) { try { chart.removePane(entry.pane); } catch (error) { showNotice(`Не удалось удалить панель: ${error.message}`); } }
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
  title.append(span(state.instrument.id, ''), span('·', 'dim'), span(state.instrument.name, 'dim'), span('·', 'dim'), span(state.interval.label, 'dim'));
  if (state.live) { const dot = document.createElement('span'); dot.className = 'live'; dot.title = 'Эмуляция потока включена (синтетические данные)'; title.append(dot); }
  rows.push(title);
  const ohlc = legendRow('ohlc');
  ohlc.append(span('О', 'k'), bold(f.format(bar.open), color), span('В', 'k'), bold(f.format(bar.high), color), span('Н', 'k'), bold(f.format(bar.low), color), span('З', 'k'), bold(f.format(bar.close), color),
    bold(`${sign(change)}${f.format(Math.abs(change))} (${sign(pct)}${Math.abs(pct).toFixed(2).replace('.', ',')}%)`, change >= 0 ? UP : DOWN));
  rows.push(ohlc);
  if (state.indicators.has('volume')) { const vol = legendRow('vol'); vol.append(span('Объём', 'k'), bold(compact.format(bar.volume), color)); rows.push(vol); }
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
  return INSTRUMENTS.map((instrument) => {
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
    button.setAttribute('aria-label', `${row.instrument.id}, ${row.instrument.name}`);
    const logo = document.createElement('span'); logo.className = 'logo'; logo.textContent = row.instrument.id.slice(-2); logo.setAttribute('aria-hidden', 'true');
    button.append(logo, document.createTextNode(row.instrument.id));
    button.addEventListener('click', () => selectInstrument(row.instrument));
    th.append(button);
    const cell = (text, cls) => { const td = document.createElement('td'); const s = document.createElement('span'); s.className = `cell ${cls ?? ''}`; s.textContent = text; td.append(s); return td; };
    tr.append(th, cell(f.format(last)), cell(`${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${sign(change)}${f.format(Math.abs(change))}`, color),
      cell(`${sign(pct)}${Math.abs(pct).toFixed(2).replace('.', ',')}%`, color));
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
  name.append(logo, document.createTextNode(`${instrument.id} · ${instrument.name}`));
  const price = document.createElement('div'); price.className = 'price'; price.textContent = f.format(close);
  const chg = document.createElement('div'); chg.className = `chg ${color}`;
  chg.textContent = `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${sign(change)}${f.format(Math.abs(change))}  ${sign(pct)}${Math.abs(pct).toFixed(2).replace('.', ',')}%`;
  const dl = document.createElement('dl');
  const stat = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); };
  stat('Открытие', f.format(today.open)); stat('Максимум', f.format(Math.max(today.high, close))); stat('Минимум', f.format(Math.min(today.low, close)));
  stat('Пред. закрытие', f.format(prev.close)); stat('Объём', compact.format(today.volume));
  els.details.replaceChildren(name, price, chg, dl);
}

// ------------------------------------------------------------ chart session
function teardown() {
  if (!session) return;
  clearInterval(session.timer);
  for (const off of session.unsubscribe) { try { off(); } catch { /* subscription already closed */ } }
  try { chart.destroy(); } catch (error) { showNotice(`Ошибка освобождения графика: ${error.message}`); }
  chart = null; session = null;
}

function setVisibleBars(count) {
  const n = session.data.bars.length;
  chart.indexScale().setVisibleRange({ from: Math.max(-0.5, n - count), to: n + 9 });
  chart.priceScale('main').setAutoScale(true);
}

function build() {
  teardown();
  clearNotice();
  const data = dataFor(state.instrument, state.interval);
  const s = { data, index: new Map(data.bars.map((b, i) => [b.barId, i])), indicators: new Map(), unsubscribe: [], ticker: createTicker(`${state.instrument.id}|${state.interval.id}`, state.instrument, data.step) };
  session = s;
  try {
    chart = createChart(els.chart, chartOptions(data.step));
    attachChartFeatures(chart, { context: { instrumentId: `DEMO:${state.instrument.id}`, interval: state.interval.id, sourceId: 'synthetic-demo' }, interaction: {} });
    chart.timeline.setTimeline(data.slots);
    addPrice(s);
    if (state.indicators.has('volume')) addVolume(s);
    rebuildOverlays(s);
    chart.interaction.setDrawingSnap({ mode: state.magnet ? 'weak' : 'free', ...(state.magnet ? { sourceId: 'price', threshold: 12 } : {}) });
  } catch (error) {
    teardown();
    showNotice(`Не удалось построить график: ${error.message}`);
    return;
  }
  const targetBars = state.interval.id === 'W' ? 110 : state.interval.id === 'D' ? 140 : 130;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (session !== s) return;
    try { setVisibleBars(targetBars); chart.indexScale().setFollowRealTime(true); } catch (error) { showNotice(`Не удалось задать видимый диапазон: ${error.message}`); }
    updateLegend(null);
  }));
  els.toRealtime.hidden = true;
  s.unsubscribe.push(chart.subscribe('visibleRangeChange', (payload) => {
    els.toRealtime.hidden = chart.indexScale().isFollowingRealTime();
    $('auto').setAttribute('aria-pressed', String(chart.priceScale('main').isAutoScale()));
  }));
  s.unsubscribe.push(chart.subscribe('crosshairMove', (payload) => {
    s.hoverBarId = payload.insideHistory ? payload.barId : null;
    updateLegend(s.hoverBarId, payload.insideHistory ? payload.series : undefined);
  }));
  s.unsubscribe.push(chart.subscribe('error', ({ operation, error }) => showNotice(`${operation}: ${error?.message ?? error}`)));
  s.unsubscribe.push(chart.drawings.subscribe(() => syncHistoryButtons()));
  s.unsubscribe.push(chart.interaction.subscribe('toolChange', ({ toolId }) => { if (toolId === null) setActiveTool(null, true); }));
  syncHistoryButtons();
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
    } catch (error) { clearInterval(s.timer); showNotice(`Эмуляция потока остановлена: ${error.message}`); }
  }, 1000);
}

// ------------------------------------------------------------------ toolbar
function selectInstrument(instrument) {
  if (instrument.id === state.instrument.id) return;
  state.instrument = instrument;
  syncSymbol();
  build();
  announce(`Инструмент ${instrument.id}, ${instrument.name}`);
}
function selectInterval(interval) {
  if (interval.id === state.interval.id) return;
  state.interval = interval;
  syncIntervals();
  build();
  announce(`Интервал ${interval.label}`);
}
function syncSymbol() {
  $('symbol-text').textContent = state.instrument.id;
  $('symbol-logo').textContent = state.instrument.id.slice(-2);
}
function syncIntervals() {
  for (const button of $('intervals').children) button.setAttribute('aria-pressed', String(button.dataset.id === state.interval.id));
}
function syncType() {
  const type = CHART_TYPES.find((t) => t.id === state.chartType);
  $('type-button').innerHTML = svg(type.icon);
  $('type-button').setAttribute('aria-label', `Тип графика: ${type.label}`);
  $('type-button').title = `Тип графика: ${type.label}`;
}
function syncHistoryButtons() {
  $('undo').disabled = !chart?.drawings?.canUndo();
  $('redo').disabled = !chart?.drawings?.canRedo();
}

for (const interval of INTERVALS) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'interval'; button.dataset.id = interval.id; button.textContent = interval.label;
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
    updateLegend(null);
  } catch (error) { showNotice(`Не удалось сменить тип графика: ${error.message}`); }
}
$('indicators-button').addEventListener('click', (event) => showMenu(event.currentTarget, (panel) => {
  const h = document.createElement('h3'); h.textContent = 'Индикаторы'; panel.append(h);
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
    announce(`${INDICATORS.find((i) => i.id === id).label}: ${on ? 'включён' : 'выключен'}`);
  } catch (error) { if (on) state.indicators.delete(id); else state.indicators.add(id); showNotice(`Индикатор не изменён: ${error.message}`); }
  closeMenu();
}
$('undo').addEventListener('click', () => { chart.drawings.undo(); syncHistoryButtons(); });
$('redo').addEventListener('click', () => { chart.drawings.redo(); syncHistoryButtons(); });
$('live-toggle').addEventListener('click', (event) => {
  state.live = !state.live;
  event.currentTarget.setAttribute('aria-pressed', String(state.live));
  startLive(); updateLegend(null);
  announce(`Эмуляция потока ${state.live ? 'включена' : 'выключена'}`);
});
$('theme').addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = state.theme;
  try { chart.applyOptions(THEMES[state.theme]); } catch (error) { showNotice(`Тема не применена: ${error.message}`); }
  updateLegend(null);
});
$('snapshot').addEventListener('click', async () => {
  try {
    const result = await exportChartPng(chart, { chartId: chart.id });
    const blob = result instanceof Blob ? result : result?.blob;
    if (!(blob instanceof Blob)) throw new Error('экспорт не вернул изображение');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${state.instrument.id}-${state.interval.id}-demo.png`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    announce('Снимок графика сохранён');
  } catch (error) { showNotice(`Снимок не создан: ${error.message}`); }
});
$('fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.().catch((error) => showNotice(`Полный экран недоступен: ${error.message}`));
});
$('side-toggle').addEventListener('click', (event) => {
  const open = els.terminal.classList.toggle('show-side');
  event.currentTarget.setAttribute('aria-expanded', String(open));
});
els.toRealtime.addEventListener('click', () => chart.indexScale().scrollToRealTime());

// -------------------------------------------------------------- draw toolbar
const toolButtons = new Map();
function setActiveTool(id, silent = false) {
  state.tool = id;
  for (const [toolId, button] of toolButtons) button.classList.toggle('active', toolId === id);
  if (silent) return;
  try {
    if (id === null) { chart.interaction.setTool(null); return; }
    let props = {};
    if (id === 'text') {
      const text = window.prompt('Текст аннотации', 'Заметка');
      if (text === null) { setActiveTool(null, true); toolButtons.get(null).classList.add('active'); return; }
      props = { text };
    }
    chart.interaction.armDrawing(id, { props });
    announce('Стрелки перемещают курсор, Enter задаёт якорь, Escape отменяет');
  } catch (error) { showNotice(`Инструмент недоступен: ${error.message}`); setActiveTool(null, true); toolButtons.get(null).classList.add('active'); }
}
for (const tool of DRAW_TOOLS) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'tool-btn';
  button.setAttribute('aria-label', tool.label); button.title = tool.label;
  button.innerHTML = `<span class="icon">${svg(tool.icon)}</span>`;
  button.addEventListener('click', () => setActiveTool(tool.id));
  toolButtons.set(tool.id, button);
  $('drawbar').append(button);
}
toolButtons.get(null).classList.add('active');
{
  const gap = document.createElement('span'); gap.className = 'gap'; $('drawbar').append(gap);
  const magnet = document.createElement('button');
  magnet.type = 'button'; magnet.className = 'tool-btn'; magnet.title = 'Магнит к ценам OHLC'; magnet.setAttribute('aria-label', 'Магнит к ценам OHLC'); magnet.setAttribute('aria-pressed', 'false');
  magnet.innerHTML = `<span class="icon">${svg('magnet')}</span>`;
  magnet.addEventListener('click', () => {
    state.magnet = !state.magnet;
    magnet.setAttribute('aria-pressed', String(state.magnet));
    try { chart.interaction.setDrawingSnap({ mode: state.magnet ? 'weak' : 'free', ...(state.magnet ? { sourceId: 'price', threshold: 12 } : {}) }); } catch (error) { showNotice(`Магнит недоступен: ${error.message}`); }
  });
  const trash = document.createElement('button');
  trash.type = 'button'; trash.className = 'tool-btn'; trash.title = 'Удалить все рисунки'; trash.setAttribute('aria-label', 'Удалить все рисунки');
  trash.innerHTML = `<span class="icon">${svg('trash')}</span>`;
  trash.addEventListener('click', () => { try { chart.interaction.setTool(null); chart.drawings.clear(); } catch (error) { showNotice(`Рисунки не удалены: ${error.message}`); } });
  $('drawbar').append(magnet, trash);
}

// ---------------------------------------------------------------- range bar
for (const range of RANGES) {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'range'; button.textContent = range.label; button.title = `Показать: ${range.label}`;
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
  catch (error) { showNotice(`Логарифмическая шкала недоступна: ${error.message}`); }
});
$('auto').addEventListener('click', () => { chart.priceScale('main').setAutoScale(true); $('auto').setAttribute('aria-pressed', 'true'); });
setInterval(() => { els.clock.textContent = `${fmtClock.format(Date.now())} (Москва, UTC+3)`; }, 1000);
els.clock.textContent = `${fmtClock.format(Date.now())} (Москва, UTC+3)`;

syncSymbol(); syncIntervals(); syncType();
build();
window.addEventListener('pagehide', teardown);
