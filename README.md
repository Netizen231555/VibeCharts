# VibeCharts

**English** | [Русский](README.ru.md)

Zero-dependency Canvas 2D charting library for market data: candlesticks, bars, lines, areas and histograms, indicators, drawing tools, alerts and an accessible, composable interface.

![Candlestick chart with volume and exponential moving averages](.github/images/hero.webp)

## Features

- **Charts:** candlesticks, OHLC bars, lines, areas, histograms, baseline; multiple panes with independent price scales; linear, logarithmic and percent scales.
- **Indicators:** SMA, EMA, RSI, MACD, Bollinger Bands, ATR, Stochastic, VWAP, volume and volume delta; register your own.
- **Drawing tools:** 29 tools in a grouped left rail: lines, rays, channels, Fibonacci tools, shapes, text, pitchfork and more, with snapping and undo/redo.
- **Alerts:** price-level alerts you can drag on the chart.
- **Interface:** crosshair, legend, context menu, keyboard control, dark and light themes; build your own layout from parts.
- **Accessible by default:** semantic HTML, roles, keyboard operation and a data table alternative.
- **Index axis:** data is attached to opaque slot ids (`barId`) instead of timestamps, so gaps never distort the chart. Time is optional.
- **Zero dependencies, zero network:** Canvas 2D and the DOM only.


## Install

The package is not published to npm yet. Install it from GitHub:

```sh
npm install github:Netizen231555/VibeCharts
```

## Quick start

```js
import { createChart, attachChartFeatures, createChartUI } from 'vibecharts';
import 'vibecharts/styles.css';
import 'vibecharts/ui.css';

const host = document.querySelector('#chart-host');
host.style.height = '480px';
const container = document.createElement('div');
container.style.height = '100%';
host.append(container);

const chart = createChart(container, { theme: 'dark', locale: 'en-US' });
attachChartFeatures(chart, {
  context: { instrumentId: 'XYZ', interval: '1d', sourceId: 'my-feed' },
  interaction: {},
});

// The timeline is an ordered list of host slots; time is optional.
chart.timeline.setTimeline([
  { barId: 'b1', time: Date.UTC(2026, 0, 5) },
  { barId: 'b2', time: Date.UTC(2026, 0, 6) },
]);

const candles = chart.addSeries('candlestick', { id: 'price' });
candles.setData(
  [
    { barId: 'b1', open: 10, high: 12, low: 9, close: 11 },
    { barId: 'b2', open: 11, high: 13, low: 10, close: 12 },
  ],
  { instrumentId: 'XYZ', interval: '1d', sourceId: 'my-feed', priceStep: 0.01 },
);

chart.addIndicator({ type: 'sma', source: candles.id, pane: 'main', parameters: { period: 20, sourceField: 'close' } });

createChartUI(chart, { host, interaction: chart.interaction });
```

Interface language follows the `locale` option (`en-*` or `ru-*`). Keyboard: `Home` auto-scale, `F` follow the latest bar, `R` fit data, `L` linear/logarithmic scale; bindings are configurable. Holding `Alt` while drawing snaps to open/high/low/close and bar centres.

## Documentation and examples

- [docs/contract.md](docs/contract.md) is the full reference.
- [docs/parts.md](docs/parts.md) shows how to replace any part of the interface with your own markup.
- [examples/](examples/) has runnable pages, see [examples/README.md](examples/README.md):

```sh
node examples/terminal/serve.mjs 8340
# http://127.0.0.1:8340/examples/terminal/
```

Example data is synthetic.

## Status

Version 0.1.0: this is a vibe-coded project; most of the code was written with AI assistance and checked by the author in a browser. The API may change incompatibly in minor versions; there is no automated test suite yet. Do not use it for trading decisions without your own verification. Changes: [CHANGELOG.md](CHANGELOG.md).

Licensed under Apache-2.0, see [LICENSE](LICENSE). Provided "as is", without warranty; not investment advice.
