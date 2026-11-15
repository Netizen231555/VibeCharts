// Runnable page for the recipes: the default interface with the built-in rail removed and one recipe in its place.
import { createChart, attachChartFeatures } from 'vibecharts';
import { toolPopover } from './tool-popover.js';
import { toolSelect } from './tool-select.js';
import { createI18n, mountLanguageSwitch } from '../shared/i18n.js';
import { en, ru } from './strings.js';
// Synthetic prices from the generator shared by the examples (not part of the package).
import { INSTRUMENTS, INTERVALS, generateSeries } from '../terminal/data.js';

const i18n = createI18n({ en, ru });
const { t } = i18n;
i18n.apply();
mountLanguageSwitch(document.querySelector('.page-header .header-controls'));

const interval = INTERVALS.find((entry) => entry.id === 'D');
const instrument = INSTRUMENTS[0];
const generated = generateSeries(instrument, interval);
const slots = generated.slots.slice(-120);
const bars = generated.bars.slice(-120);

const rows = ['builtin', 'popover', 'select'];
const parts = {
  toolPopover: { create: toolPopover, regions: ['top'], controls: ['tool:', 'clearDrawings'] },
  toolSelect: { create: toolSelect, regions: ['top'], controls: ['tool:', 'clearDrawings'] },
};
// Only the tool part differs; the layout is otherwise the default one. The recipes declare the tool controls they cover,
// so the built-in rail is simply left out: `without` would disable those controls in the model.
const layouts = {
  builtin: 'full',
  popover: { top: ['topBar', 'toolPopover'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine', 'dataTable'] },
  select: { top: ['topBar', 'toolSelect'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine', 'dataTable'] },
};

const host = document.querySelector('#host');
const modeSelect = document.querySelector('#mode');
const layoutText = document.querySelector('#layout');

function showError(message) {
  const alert = document.createElement('p');
  alert.setAttribute('role', 'alert');
  alert.className = 'example-error';
  alert.textContent = message;
  host.after(alert);
}

function describe(mode) {
  return mode === 'builtin' ? "layout: 'full'" : `parts: { ${mode === 'popover' ? 'toolPopover' : 'toolSelect'}: { create, regions: ['top'], controls: ['tool:', 'clearDrawings'] } }\n${JSON.stringify(layouts[mode], null, 2)}`;
}

try {
  const container = document.createElement('div');
  container.className = 'example-chart';
  host.append(container);
  const chart = createChart(container, { autoSize: true, theme: 'dark', locale: i18n.locale, timeZone: 'UTC', timeScale: { tickMode: 'time', barSpacing: 7 }, accessibilityLabel: t('chart.label') });
  chart.subscribe('error', ({ operation, error }) => showError(`${operation}: ${error.message}`));
  chart.timeline.setTimeline(slots);
  const series = chart.addSeries('candlestick', { id: 'price', priceLine: { style: 'dashed' }, lastValueColorMode: 'direction' });
  series.setData(bars, { instrumentId: instrument.id, interval: '1D', sourceId: 'synthetic-demo', priceStep: generated.step });
  attachChartFeatures(chart, {
    context: { instrumentId: instrument.id, interval: '1D', sourceId: 'synthetic-demo' },
    interaction: {},
    chartUI: { host, layout: layouts.popover, parts, title: `${instrument.id} · ${instrument.names[i18n.lang]}`, demo: true, theme: 'dark' },
  });
  chart.ui.resolveAvailable({ rows: bars });
  layoutText.textContent = describe('popover');

  modeSelect.addEventListener('change', () => {
    const mode = modeSelect.value;
    if (!rows.includes(mode)) { showError(t('error.unknownMode', { mode })); return; }
    try {
      chart.ui.setLayout(layouts[mode]);
      layoutText.textContent = describe(mode);
    } catch (error) {
      showError(t('error.layout', { message: error.message }));
    }
  });
  window.__partsChart = chart;
  window.__partsReady = true;
} catch (error) {
  showError(t('error.build', { message: error.message }));
  throw error;
}
