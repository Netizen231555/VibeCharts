import { createApp, ref, onMounted, onBeforeUnmount, watch } from 'vue';
import { createChart, attachChartFeatures } from 'vibecharts';
import { INSTRUMENTS, INTERVALS, generateSeries } from '../terminal/data.js';

// The data is synthetic and does not represent a real instrument.
const instrument = INSTRUMENTS[0];
const generated = generateSeries(instrument, INTERVALS.find((interval) => interval.id === 'D'));
const slots = generated.slots.slice(-120);
const bars = generated.bars.slice(-120);
const context = { instrumentId: instrument.id, interval: '1D', sourceId: 'synthetic-demo' };

const ChartExample = {
  props: { kind: { type: String, required: true }, theme: { type: String, required: true } },
  template: `
    <section class="example">
      <h2>{{ kind === 'candlestick' ? 'Свечи с инструментами рисования' : 'Линейный график' }}</h2>
      <p v-if="error" role="alert">{{ error }}</p>
      <div ref="host" class="chart-host"><div ref="container" class="chart-container"></div></div>
    </section>`,
  setup(props) {
    const host = ref(null);
    const container = ref(null);
    const error = ref('');
    let chart = null;

    onMounted(() => {
      try {
        chart = createChart(container.value, {
          autoSize: true, theme: props.theme, locale: 'ru-RU', timeZone: 'UTC',
          timeScale: { tickMode: 'time', barSpacing: 7 },
          accessibilityLabel: 'Демонстрационный график с синтетическими данными',
        });
        chart.subscribe('error', ({ operation, error: cause }) => { error.value = `${operation}: ${cause.message}`; });
        chart.timeline.setTimeline(slots);
        const series = chart.addSeries(props.kind, { id: 'price' });
        const points = props.kind === 'line' ? bars.map(({ barId, close }) => ({ barId, value: close })) : bars;
        series.setData(points, { ...context, priceStep: generated.step });
        if (props.kind === 'candlestick') {
          attachChartFeatures(chart, {
            context, interaction: {},
            chartUI: { host: host.value, title: 'Синтетические данные', demo: true, theme: props.theme },
          });
          chart.ui.resolveAvailable({ rows: bars });
        }
      } catch (cause) {
        chart?.destroy();
        chart = null;
        error.value = `Не удалось создать график: ${cause.message}`;
      }
    });
    watch(() => props.theme, (theme) => {
      if (!chart) return;
      try { if (chart.ui) chart.ui.setTheme(theme); else chart.applyOptions({ theme }); }
      catch (cause) { error.value = `Не удалось изменить тему: ${cause.message}`; }
    });
    onBeforeUnmount(() => { chart?.destroy(); chart = null; });
    return { host, container, error };
  },
};

createApp({
  components: { ChartExample },
  setup() {
    const theme = ref('dark');
    const visible = ref(true);
    return { theme, visible };
  },
  template: `
    <main>
      <h1>Графики в Vue</h1>
      <p>Демонстрационные синтетические данные; не рыночные котировки.</p>
      <div class="controls">
        <button type="button" @click="theme = theme === 'dark' ? 'light' : 'dark'">Сменить тему</button>
        <button type="button" @click="visible = !visible">{{ visible ? 'Удалить графики' : 'Создать графики' }}</button>
      </div>
      <template v-if="visible">
        <ChartExample kind="candlestick" :theme="theme" />
        <ChartExample kind="line" :theme="theme" />
      </template>
      <p v-else role="status">Графики удалены; ресурсы освобождены.</p>
    </main>`,
}).mount('#app');
