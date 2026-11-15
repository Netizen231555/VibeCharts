import { createChart, attachInteraction } from '../../src/index.js';
import { createI18n, mountLanguageSwitch } from '../shared/i18n.js';
import { en, ru } from './strings.js';
import { INSTRUMENTS, INTERVALS, generateSeries } from '../terminal/data.js';

const variants = Array.from({ length: 10 }, (_, index) => [`v${index + 1}Title`, `v${index + 1}Desc`, [`v${index + 1}Tag1`, `v${index + 1}Tag2`]]);
const i18n = createI18n({ en, ru });
const { t } = i18n;
i18n.apply(document);
mountLanguageSwitch(document.querySelector('.header-controls'));
const root = document.querySelector('#showcase');
const themeButton = document.querySelector('#theme');
const charts = [];
const data = INSTRUMENTS.slice(0, 4).map((instrument) => {
  const generated = generateSeries(instrument, INTERVALS.find((interval) => interval.id === 'D'));
  return { instrument, step: generated.step, slots: generated.slots.slice(-100), bars: generated.bars.slice(-100) };
});
const dateFormat = new Intl.DateTimeFormat(i18n.locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const numberFormat = new Intl.NumberFormat(i18n.locale, { maximumFractionDigits: 2 });
const colors = () => document.documentElement.dataset.theme === 'light'
  ? { background: '#ffffff', text: '#5e6d79', grid: '#e8edef', up: '#287e6b', down: '#a44b42', volume: '#9cbdb7', line: '#4e7184' }
  : { background: '#121820', text: '#99a5b3', grid: '#27323c', up: '#71b6a5', down: '#d18d85', volume: '#557c78', line: '#9bb8c6' };

function chartOptions(kind) {
  const c = colors();
  return {
    autoSize: true, theme: document.documentElement.dataset.theme, locale: i18n.locale, timeZone: 'UTC',
    layout: { background: c.background, textColor: c.text, fontSize: kind === 10 ? 11 : 12, fontFamily: kind === 10 ? 'monospace' : 'system-ui' },
    grid: { visible: ![2, 6, 10].includes(kind), color: c.grid },
    timeScale: { tickMode: 'time', barSpacing: 7 },
    priceScale: { tickSpacing: kind === 6 || kind === 10 ? 80 : 55 },
    accessibilityLabel: t('chartLabel', { kind }),
  };
}

function addVolume(chart, dataset, pane = 'main', overlay = false) {
  const volume = chart.addSeries('histogram', { id: 'volume', color: colors().volume, priceScaleId: 'volume', lastValueVisible: false }, pane);
  volume.setData(dataset.bars.map((bar) => ({ barId: bar.barId, value: bar.volume })));
  if (overlay) { const scale = chart.priceScale(pane, 'volume'); scale.setOverlay(true); scale.setMargins({ top: 0.8, bottom: 0 }); }
}

function makeChart(container, kind, dataset = data[0], { compact = false } = {}) {
  const chart = createChart(container, chartOptions(kind));
  chart.subscribe('error', ({ operation, error }) => showError(container, `${operation}: ${error.message}`));
  chart.timeline.setTimeline(dataset.slots);
  const c = colors();
  const price = chart.addSeries('candlestick', {
    id: 'price', upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down,
    wickUpColor: c.up, wickDownColor: c.down, priceLine: { style: 'dashed' }, lastValueColorMode: 'direction',
  });
  price.setData(dataset.bars, { instrumentId: dataset.instrument.id, interval: '1D', sourceId: 'synthetic-demo', priceStep: dataset.step });
  if (kind === 3) chart.priceScale('main').setSide('left');
  if ([2, 4, 6, 7, 8, 9].includes(kind)) addVolume(chart, dataset, 'main', true);
  if ([1, 3, 5, 10].includes(kind)) {
    const volumePane = chart.addPane({ height: kind === 5 ? 0.28 : 0.25 });
    addVolume(chart, dataset, volumePane);
  }
  if (kind === 5) {
    const pane = chart.addPane({ height: 0.28 });
    const average = chart.addSeries('line', { id: 'difference', color: c.line, lastValueVisible: false }, pane);
    const values = dataset.bars.flatMap((bar, index, bars) => index < 19 ? [] : [{ barId: bar.barId, value: bar.close - bars.slice(index - 19, index + 1).reduce((sum, item) => sum + item.close, 0) / 20 }]);
    average.setData(values);
  }
  if (kind === 4) {
    const comparison = chart.addSeries('candlestick', {
      id: 'percent-scale', priceScaleId: 'percent', lastValueVisible: false,
      upColor: 'transparent', downColor: 'transparent', equalColor: 'transparent',
      borderUpColor: 'transparent', borderDownColor: 'transparent', wickUpColor: 'transparent', wickDownColor: 'transparent',
    });
    comparison.setData(dataset.bars);
    const scale = chart.priceScale('main', 'percent');
    scale.setSide('left'); scale.setVisible(false);
    container.closest('.demo').querySelector('select').addEventListener('change', (event) => {
      try {
        const index = Number(event.target.value);
        if (event.target.value === '') { scale.setVisible(false); return; }
        scale.setMode('percent', { base: dataset.bars[index].close });
        scale.setVisible(true);
      } catch (error) { showError(container, t('baseChangeFailed', { message: error.message })); }
    });
  }
  attachInteraction(chart, {});
  chart.indexScale().setVisibleRange({ from: compact ? 45 : 15, to: 99 });
  charts.push({ chart, kind });
  return chart;
}
function showError(element, message) {
  let output = element.parentElement.querySelector('.error');
  if (!output) { output = document.createElement('p'); output.className = 'error'; output.setAttribute('role', 'alert'); element.parentElement.append(output); }
  output.textContent = t('chartError', { message });
}
function section(kind, [titleKey, descriptionKey, tagKeys]) {
  const article = document.createElement('section');
  article.className = 'variant'; article.id = `variant-${kind}`;
  const info = document.createElement('div'); info.className = 'variant-info';
  const number = document.createElement('div'); number.className = 'number'; number.textContent = String(kind).padStart(2, '0') + ' / 10';
  const heading = document.createElement('h2'); heading.textContent = t(titleKey);
  const paragraph = document.createElement('p'); paragraph.textContent = t(descriptionKey);
  const tagList = document.createElement('div'); tagList.className = 'tags';
  for (const tagKey of tagKeys) { const el = document.createElement('span'); el.className = 'tag'; el.textContent = t(tagKey); tagList.append(el); }
  info.append(number, heading, paragraph, tagList);
  const demo = document.createElement('div'); demo.className = 'demo';
  const header = document.createElement('div'); header.className = 'demo-header';
  const name = document.createElement('div'); name.className = 'symbol'; name.textContent = kind === 9 ? t('fourInstruments') : 'DEMO01';
  const subtitle = document.createElement('small'); subtitle.textContent = t('dailySynthetic'); name.append(subtitle); header.append(name);
  if (kind === 4) {
    const label = document.createElement('label'); label.className = 'base-control'; label.textContent = t('baseLabel');
    const select = document.createElement('select'); select.setAttribute('aria-label', t('baseAria'));
    for (const [value, text] of [['', t('baseNone')], ['0', t('baseFirst', { date: dateFormat.format(data[0].slots[0].time) })], ['49', t('baseMiddle', { date: dateFormat.format(data[0].slots[49].time) })], ['99', t('baseLast', { date: dateFormat.format(data[0].slots[99].time) })]]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    label.append(select); header.append(label);
  } else { const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = kind === 5 ? t('metaMulti') : t('metaDefault'); header.append(meta); }
  demo.append(header); article.append(info, demo); root.append(article);
  if (kind === 9) {
    const grid = document.createElement('div'); grid.className = 'chart-grid'; demo.append(grid); const group = [];
    data.forEach((dataset) => {
      const cell = document.createElement('div'); cell.className = 'chart-cell';
      const cellHead = document.createElement('div'); cellHead.className = 'cell-header'; cellHead.textContent = dataset.instrument.id;
      const label = document.createElement('span'); label.textContent = dataset.instrument.names[i18n.lang]; cellHead.append(label);
      const host = document.createElement('div'); host.className = 'chart compact'; cell.append(cellHead, host); grid.append(cell);
      try { group.push(makeChart(host, kind, dataset, { compact: true })); } catch (error) { showError(host, error.message); }
    });
    let synchronizing = false;
    group.forEach((chart) => chart.subscribe('visibleRangeChange', ({ range }) => {
      if (synchronizing || !range) return;
      synchronizing = true;
      try { group.forEach((other) => { if (other !== chart) other.indexScale().setVisibleRange(range); }); }
      finally { synchronizing = false; }
    }));
  } else {
    let parent = demo;
    if (kind === 8) {
      const split = document.createElement('div'); split.className = 'split';
      const aside = document.createElement('aside'); aside.className = 'instrument';
      const caption = document.createElement('div'); caption.className = 'caption'; caption.textContent = t('lastPriceCaption');
      const value = document.createElement('div'); value.className = 'large'; value.textContent = numberFormat.format(data[0].bars.at(-1).close);
      const list = document.createElement('dl');
      for (const [key, val] of [[t('open'), data[0].bars.at(-1).open], [t('high'), data[0].bars.at(-1).high], [t('low'), data[0].bars.at(-1).low]]) {
        const row = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = numberFormat.format(val); row.append(dt, dd); list.append(row);
      }
      aside.append(caption, value, list); split.append(aside); demo.append(split); parent = split;
    }
    const host = document.createElement('div'); host.className = `chart${kind === 5 ? ' tall' : ''}`; parent.append(host);
    try { makeChart(host, kind); } catch (error) { showError(host, error.message); }
  }
  const footer = document.createElement('div'); footer.className = 'demo-footer';
  const left = document.createElement('span'); left.textContent = kind === 5 ? t('footnoteDeviation') : t('footnoteHistory');
  const right = document.createElement('span'); right.textContent = t('footnoteRight'); footer.append(left, right); demo.append(footer);
}

variants.forEach((variant, index) => section(index + 1, variant));
themeButton.addEventListener('click', () => {
  const light = document.documentElement.dataset.theme !== 'light';
  document.documentElement.dataset.theme = light ? 'light' : 'dark';
  themeButton.setAttribute('aria-pressed', String(light)); themeButton.textContent = t(light ? 'themeDark' : 'themeLight');
  for (const { chart, kind } of charts) {
    try {
      chart.applyOptions(chartOptions(kind));
      const c = colors(); chart.series('price').setOptions({ upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down, wickUpColor: c.up, wickDownColor: c.down });
      chart.series('volume').setOptions({ color: c.volume });
      if (kind === 5) chart.series('difference').setOptions({ color: c.line });
    } catch (error) { showError(chart.container, t('themeChangeFailed', { message: error.message })); }
  }
});
