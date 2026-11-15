// Older history in pages and a remembered time window, built on the public datafeed controller only.
// The library never loads anything by itself: the host decides when to call `datafeed.loadMore()`.
import { createChart, attachChartFeatures } from 'vibecharts';
// Synthetic prices from the generator shared by the examples (not part of the package).
import { INSTRUMENTS, INTERVALS, generateSeries } from '../terminal/data.js';
import { createI18n, mountLanguageSwitch } from '../shared/i18n.js';
import { en, ru } from './strings.js';
import { captureWindow, windowRange } from '../terminal/window.js';

const i18n = createI18n({ en, ru });
const { t, lang } = i18n;
i18n.apply();
mountLanguageSwitch(document.querySelector('.page-header .controls'));

const PAGE_SIZE = 200;
// Request the next page when this many bars or fewer remain to the left of the window.
const EDGE_BARS = 30;
const PAGE_DELAY_MS = 350;
const INTERVAL_IDS = ['60', 'D', 'W'];

const host = document.querySelector('#host');
const instrumentSelect = document.querySelector('#instrument');
const intervalSelect = document.querySelector('#interval');
const statusLine = document.querySelector('#status');
const requestLog = document.querySelector('#log');

const instruments = INSTRUMENTS.slice(0, 4);
const intervals = INTERVALS.filter((entry) => INTERVAL_IDS.includes(entry.id));
const generated = new Map();
const seriesFor = (instrument, interval) => {
  const key = `${instrument.id}|${interval.id}`;
  if (!generated.has(key)) generated.set(key, generateSeries(instrument, interval));
  return generated.get(key);
};

function setStatus(text, kind = 'info') {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

function logRequest(text) {
  const item = document.createElement('li');
  item.textContent = text;
  requestLog.prepend(item);
  while (requestLog.children.length > 30) requestLog.lastChild.remove();
}

/**
 * An in-memory `IndexDatafeed` that serves the newest `limit` bars first and then pages backwards. The opaque
 * cursor (`before`) is the id of the oldest bar already delivered; the abort signal cancels a pending page.
 */
function createPagedFeed(all, label) {
  return {
    capabilities: { history: true, stream: false, observations: false },
    loadHistory(request, signal) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const end = request.before === undefined ? all.bars.length : all.bars.findIndex((bar) => bar.barId === request.before);
          if (end < 0) { reject(new Error(t('error.cursor', { cursor: request.before }))); return; }
          const start = Math.max(0, end - request.limit);
          logRequest(t('log.page', { label, start, end: end - 1, total: all.bars.length, initial: request.before === undefined ? t('log.initial') : '' }));
          resolve({
            context: request.context,
            slots: all.slots.slice(start, end),
            series: [{ seriesId: 'price', points: all.bars.slice(start, end).map((bar) => ({ kind: 'ohlcv', ...bar })) }],
            hasMore: start > 0,
            ...(start > 0 ? { nextBefore: all.bars[start].barId } : {}),
            sourceStatus: 'synthetic',
          });
        }, PAGE_DELAY_MS);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      });
    },
  };
}

let session = null;

function unmount() {
  if (!session) return;
  const { chart, features } = session;
  session = null;
  features.datafeed.disconnect();
  chart.destroy();
  host.replaceChildren();
}

function describe(current) {
  const state = current.features.datafeed.getState();
  const more = t(state.hasMore ? 'status.more' : 'status.end');
  return t('status.summary', { instrument: current.instrument.id, interval: current.interval.labels[lang], count: state.timeline.slotCount, more });
}

async function loadMore(current) {
  const feed = current.features.datafeed;
  if (feed.getState().loading || !feed.getState().hasMore) return;
  setStatus(t('status.loadingOlder'));
  const state = await feed.loadMore();
  if (session !== current) return;
  if (state.error) setStatus(t('status.olderFailed', { message: state.error.message }), 'error');
  else setStatus(describe(current));
}

async function mount(instrument, interval, remembered) {
  unmount();
  setStatus(t('status.loading'));
  const all = seriesFor(instrument, interval);
  const container = document.createElement('div');
  container.className = 'example-chart';
  host.append(container);
  const chart = createChart(container, { autoSize: true, theme: 'dark', locale: i18n.locale, timeZone: 'UTC', accessibilityLabel: t('chart.label', { instrument: instrument.id, interval: interval.labels[lang] }) });
  const context = { instrumentId: instrument.id, interval: interval.id, sourceId: 'synthetic-demo' };
  const features = attachChartFeatures(chart, {
    context,
    interaction: {},
    datafeed: { pageSize: PAGE_SIZE, onError: (error) => setStatus(t('status.feedError', { operation: error.operation ?? t('status.feed'), message: error.message }), 'error') },
    chartUI: { host, layout: 'full', title: `${instrument.id} · ${instrument.names[lang]}`, demo: true, theme: 'dark' },
  });
  chart.addSeries('candlestick', { id: 'price', priceLine: { style: 'dashed' }, lastValueColorMode: 'direction' });
  const current = { chart, features, instrument, interval };
  session = current;

  const initial = await features.connectDatafeed(createPagedFeed(all, `${instrument.id} ${interval.labels[lang]}`), context);
  if (session !== current) return;
  if (initial.error) { setStatus(t('status.initialFailed', { message: initial.error.message }), 'error'); return; }

  const scale = chart.indexScale();
  let restored = null;
  if (remembered) {
    // The window may start before the first page: fetch pages until it is covered or the history ends.
    while (session === current && features.datafeed.getState().hasMore && scale.slots()[0].time > remembered.leftTime) {
      await loadMore(current);
      if (features.datafeed.getState().error) break;
    }
    if (session !== current) return;
    restored = windowRange(scale.slots(), remembered, interval.id);
  }
  const count = scale.slots().length;
  scale.setVisibleRange(restored ?? { from: Math.max(-0.5, count - 120), to: count + 8 });
  chart.priceScale('main').setAutoScale(true);
  setStatus(remembered && !restored
    ? t('status.noRemembered', { summary: describe(current) })
    : describe(current));

  chart.subscribe('visibleRangeChange', () => {
    const range = scale.getVisibleRange();
    if (range && range.from < EDGE_BARS) loadMore(current);
  });
  // The initial window may already sit at the edge of a short page.
  const range = scale.getVisibleRange();
  if (range && range.from < EDGE_BARS) loadMore(current);
}

function fill(select, entries, label) {
  select.replaceChildren(...entries.map((entry) => {
    const option = document.createElement('option');
    option.value = entry.id;
    option.textContent = label(entry);
    return option;
  }));
}
fill(instrumentSelect, instruments, (entry) => `${entry.id} · ${entry.names[lang]}`);
fill(intervalSelect, intervals, (entry) => entry.labels[lang]);
intervalSelect.value = 'D';

async function change() {
  const remembered = session ? captureWindow(session.chart, session.interval.id) : null;
  const instrument = instruments.find((entry) => entry.id === instrumentSelect.value);
  const interval = intervals.find((entry) => entry.id === intervalSelect.value);
  try {
    await mount(instrument, interval, remembered);
  } catch (error) {
    setStatus(t('status.buildFailed', { message: error.message }), 'error');
    throw error;
  }
}
instrumentSelect.addEventListener('change', change);
intervalSelect.addEventListener('change', change);
window.addEventListener('pagehide', unmount);

await change();
