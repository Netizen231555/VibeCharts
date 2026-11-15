import { createChart, attachChartFeatures } from '../../src/index.js';
import { PRESETS } from '../../src/ui/index.js';
import { createI18n, mountLanguageSwitch } from '../shared/i18n.js';
import { en, ru } from './strings.js';
import { INSTRUMENTS, INTERVALS, generateSeries } from '../terminal/data.js';

const i18n = createI18n({ en, ru });
const { t } = i18n;
i18n.apply(document);
mountLanguageSwitch(document.querySelector('.header-controls'));

// All prices and volumes come from the deterministic generator in ../terminal/data.js and are synthetic.
const interval = INTERVALS.find((entry) => entry.id === 'D');
const instrument = INSTRUMENTS[0];
const generated = generateSeries(instrument, interval);
const slots = generated.slots.slice(-120);
const bars = generated.bars.slice(-120);
const numberFormat = new Intl.NumberFormat(i18n.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const types = { candles: 'candlestick', bars: 'bar', line: 'line' };
const UP = '#3fa77f';
const DOWN = '#d9645a';
const BLUE = '#4a9fd0';
const themeButton = document.querySelector('#theme');
const mounted = [];

function showError(host, message) {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.className = 'example-error';
  alert.textContent = message;
  host.append(alert);
}

/** Host-written part: shows how a layout can use a part that is not in the package. */
function instrumentPart(controller, { document: doc }) {
  const element = doc.createElement('div');
  element.className = 'example-instrument';
  const name = doc.createElement('strong');
  name.textContent = `${instrument.id} · ${instrument.names[i18n.lang]}`;
  const last = doc.createElement('span');
  last.textContent = numberFormat.format(bars.at(-1).close);
  const note = doc.createElement('small');
  note.textContent = t('lastPriceNote');
  element.append(name, last, note);
  return { element };
}

function mount(section, { layout, parts, title }) {
  const host = section.querySelector('[data-host]');
  const container = document.createElement('div');
  container.className = 'example-chart';
  host.append(container);
  const chart = createChart(container, {
    autoSize: true,
    theme: document.documentElement.dataset.theme,
    locale: i18n.locale,
    timeZone: 'UTC',
    timeScale: { tickMode: 'time', barSpacing: 7 },
    accessibilityLabel: t('chartLabel', { title }),
  });
  chart.subscribe('error', ({ operation, error }) => showError(host, `${operation}: ${error.message}`));
  chart.timeline.setTimeline(slots);
  const metadata = { instrumentId: instrument.id, interval: '1D', sourceId: 'synthetic-demo', priceStep: generated.step };
  let sequence = 0;
  let mode = 'candles';
  let indicator = null;
  let selectedIndicator = null;
  function addSource(nextMode) {
    // Only candlesticks have border and wick colours; bars accept just the direction colours.
    const options = nextMode === 'line'
      ? { color: BLUE, lineWidth: 2 }
      : nextMode === 'bars'
        ? { upColor: UP, downColor: DOWN }
        : { upColor: UP, downColor: DOWN, borderUpColor: UP, borderDownColor: DOWN, wickUpColor: UP, wickDownColor: DOWN };
    const series = chart.addSeries(types[nextMode], { id: `price-${++sequence}`, priceLine: { style: 'dashed' }, lastValueColorMode: 'direction', ...options });
    series.setData(nextMode === 'line' ? bars.map(({ barId, close }) => ({ barId, value: close })) : bars, metadata);
    return series;
  }
  let source = addSource(mode);
  function setIndicator(value) {
    indicator?.remove();
    indicator = null;
    selectedIndicator = value;
    if (value) {
      indicator = chart.addIndicator({
        type: value === 'sma20' ? 'sma' : 'ema',
        source: source.id,
        pane: 'main',
        parameters: { period: 20, sourceField: mode === 'line' ? 'value' : 'close' },
      });
    }
  }
  attachChartFeatures(chart, {
    context: { instrumentId: instrument.id, interval: '1D', sourceId: 'synthetic-demo' },
    interaction: {},
    chartUI: {
      host,
      layout,
      parts,
      title: `${instrument.id} · ${t('demoShort')}`,
      demo: true,
      demoLabel: t('demoLabel'),
      theme: document.documentElement.dataset.theme,
      chartType: mode,
      onChartType(value) {
        if (!types[value]) throw new Error(t('unknownChartType'));
        if (value === mode) return;
        const previousIndicator = selectedIndicator;
        setIndicator(null);
        chart.removeSeries(source);
        try {
          source = addSource(value);
          mode = value;
        } catch (error) {
          source = addSource(mode);
          setIndicator(previousIndicator);
          throw error;
        }
        setIndicator(previousIndicator);
      },
      onIndicator: setIndicator,
    },
  });
  chart.ui.resolveAvailable({ rows: bars, operation: t('loadOperation') });
  mounted.push(chart);
  return chart;
}

const layouts = {
  default: { layout: undefined, parts: undefined, title: t('titleDefault'), shown: `${t('noLayoutComment')}\n${JSON.stringify(PRESETS.full, null, 2)}` },
  compact: { layout: 'compact', parts: undefined, title: t('titleCompact'), shown: `layout: 'compact'\n${JSON.stringify(PRESETS.compact, null, 2)}` },
  custom: {
    layout: { top: ['instrument'], start: ['drawingRail'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine'], without: ['chartType:', 'indicator:', 'interval', 'undo', 'redo'] },
    parts: { instrument: instrumentPart },
    title: t('titleCustom'),
    shown: null,
  },
  end: {
    layout: { top: ['topBar'], end: ['drawingRail'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine'], without: [] },
    parts: undefined,
    title: t('titleEnd'),
    shown: null,
  },
  bottom: {
    layout: { top: ['topBar'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['drawingRail', 'statusLine'], without: [] },
    parts: undefined,
    title: t('titleBottom'),
    shown: null,
  },
  floating: {
    layout: { top: ['topBar'], overlay: ['drawingRail', 'navCluster'], menu: ['settingsMenu'], bottom: ['statusLine'], without: [] },
    parts: undefined,
    title: t('titleFloating'),
    shown: null,
  },
};
for (const name of ['end', 'bottom', 'floating']) layouts[name].shown = JSON.stringify(layouts[name].layout, null, 2);
layouts.custom.shown = `parts: { instrument: instrumentPart }\n${JSON.stringify(layouts.custom.layout, null, 2)}`;

for (const section of document.querySelectorAll('[data-layout-example]')) {
  const config = layouts[section.dataset.layoutExample];
  section.querySelector('[data-code]').textContent = config.shown;
  try {
    mount(section, config);
  } catch (error) {
    showError(section.querySelector('[data-host]'), t('buildFailed', { message: error.message }));
  }
}

themeButton.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  themeButton.setAttribute('aria-pressed', String(next === 'light'));
  themeButton.textContent = t(next === 'light' ? 'themeDark' : 'themeLight');
  for (const chart of mounted) chart.ui.setTheme(next);
});
