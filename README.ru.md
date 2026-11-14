# VibeCharts

[English](README.md) | **Русский**

Библиотека графиков на Canvas 2D без зависимостей: свечи, OHLC-бары, линии, области, гистограммы, базовая линия, производные виды (Heikin Ashi, Renko, Kagi, Point & Figure), рисование, индикаторы, доступный интерфейс из настраиваемых частей.

![Полная раскладка: свечи, панель рисования, навигация, статусная строка](.github/images/full-ui.webp)

Свечи, Renko и Kagi в одном графике: у каждой панели своя ось X.

![Три панели: свечи на оси времени, Renko и Kagi на осях по номерам элементов](.github/images/mixed-panes.webp)

Ключевая особенность — **индексная шкала**: данные привязаны к непрозрачным идентификаторам слотов (`barId`), а не к меткам времени. Время необязательно; когда оно есть, ось умеет выравниваться по календарным границам. Порядок задаёт хост, библиотека ничего не сортирует и не выдумывает.

Установка из GitHub (в npm пакет пока не опубликован):

```sh
npm install github:Netizen231555/VibeCharts
```

Или локально из каталога пакета: `npm install ../VibeCharts`.

## Быстрый старт

```js
import { createChart, attachChartFeatures, createChartUI } from 'vibecharts';
import 'vibecharts/styles.css';   // необязательно: стили DOM-элементов пакета
import 'vibecharts/ui.css';       // необязательно: раскладка и токены интерфейса

// host — элемент, внутри которого лежит контейнер графика (контейнер не переносится)
const host = document.querySelector('#chart-host');
host.style.height = '480px';
const container = document.createElement('div');
container.style.height = '100%';
host.append(container);

const chart = createChart(container, { theme: 'dark', locale: 'ru-RU' });
attachChartFeatures(chart, {
  context: { instrumentId: 'DEMO', interval: '1d', sourceId: 'synthetic' },
  interaction: {},
});

// шкала — упорядоченные слоты хоста; время необязательно
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
  // метаданные делают значения осмысленными: инструмент, интервал, источник, шаг цены
  { instrumentId: 'DEMO', interval: '1d', sourceId: 'synthetic', priceStep: 0.01 },
);

const ui = createChartUI(chart, { host, interaction: chart.interaction, demo: true });
```

## Интерфейс из частей

Вместо вызова `createChartUI` из быстрого старта можно передать свою раскладку:

```js
const ui = createChartUI(chart, {
  host,
  interaction: chart.interaction,
  layout: {
    top: ['instrument'],
    start: ['drawingRail'],
    overlay: ['navCluster'],
    menu: ['settingsMenu'],
    bottom: ['statusLine'],
    without: ['chartType:', 'indicator:', 'interval', 'undo', 'redo'],
  },
  parts: {                     // своя часть вместо встроенной
    instrument: (controller, { document }) => {
      const element = document.createElement('div');
      element.textContent = 'DEMO · своя часть';
      return { element };
    },
  },
});
```

Области: `top`, `start`, `overlay`, `bottom`, `menu`. Встроенные части: `topBar` (тип графика, индикатор, отмена/повтор), `drawingRail` (инструменты рисования), `navCluster` (навигация в углу графика), `settingsMenu` (тёмная тема, следование последнему бару, таблица данных, логарифмическая шкала, привязка рисунков, «Панели…», «Настройки рисунков…»; с опцией `accessibleActions: true` также клавиатурное перекрестие, сдвиг, масштаб цены и переход к соседнему бару), `statusLine`, `dataTable`. Действие, оставшееся без способа вызова (контрол, клавиша или пункт контекстного меню), отклоняется при создании — снятие действия задают явно через `layout.without`.

Оформление — токены CSS: `--chart-ui-accent`, `--chart-ui-bg`, `--chart-ui-focus` и другие на хосте.

## Ещё немного API

```js
// продолжение быстрого старта; attachChartFeatures подключает индикаторы и рисунки
const heikin = chart.addDerivedView('heikinAshi', candles, { parameters: {} });

// индикатор в отдельной панели
const rsiPane = chart.addPane({ height: 0.3 });
chart.addIndicator({ type: 'rsi', source: candles.id, pane: rsiPane, parameters: { period: 14, sourceField: 'close' } });

// объём поверх основной панели без второй оси
const volume = chart.addSeries('histogram', { priceScaleId: 'volume' });
chart.priceScale('main', 'volume').setOverlay(true);

// дельта объёма (buyVolume - sellVolume; точки свечей несут buyVolume/sellVolume), цвета по знаку
chart.addIndicator({ type: 'delta', source: candles.id, pane: rsiPane, style: { upColor: '#2fa77a', downColor: '#e0615a' } });

// подпись времени по календарным границам
chart.applyOptions({ timeScale: { tickMode: 'time' } });

// водяной знак по центру основной панели
chart.applyOptions({ watermark: { text: 'DEMO', fontSize: 64 } });

// рисунки
chart.drawings.add({
  id: 'level',
  type: 'horizontalLevel',
  paneId: 'main',
  scaleId: 'right',
  anchors: [{ price: 12 }],
});
```

Горячие клавиши графика (переопределяются через `bindings`): `Home` — автомасштаб цены, `F` — следование за реальным временем, `R` — показать все данные, `L` — линейная/логарифмическая шкала цены. Shift при построении или перетаскивании точки отрезка, луча, прямой, стрелки и линейки фиксирует цену второй точки по первой. Удержание Alt (настраивается `interaction.setDrawingSnap({ modifier })`: `alt` по умолчанию, `ctrl`, `meta` или `null`; Shift занят) при построении или перетаскивании точки включает сильную привязку к O/H/L/C первой видимой серии свечей/баров панели (или `sourceId`) и магнит к центру бара; на macOS Ctrl+клик — контекстное меню, поэтому по умолчанию Alt. Линию уровня алерта можно перетащить мышью: новая цена записывается через обновление алерта, а при отказе линия возвращается на прежнее место и ошибка попадает в событие `error`.

Полный контракт — [docs/contract.md](docs/contract.md).

## Принципы

- **Никаких выдуманных данных.** Отсутствующее значение показывается явно, ноль не подставляется; загрузка, пусто, доступно, ошибка — разные состояния.
- **Порядок и идентичность принадлежат хосту.** `barId` непрозрачен и стабилен; время не определяет порядок.
- **Доступность по умолчанию.** Семантический HTML, роли, работа с клавиатуры; интерфейс полезен и без стилей.
- **Ноль зависимостей, ноль сети.** Только Canvas 2D и DOM.

## Примеры

Папка [examples/](examples/) содержит страницы:

- [examples/terminal/](examples/terminal/) — терминал: инструменты, индикаторы, список инструментов, темы, PNG-экспорт.
- [examples/showcase/](examples/showcase/) — витрина из десяти компоновок шкал и панелей.
- [examples/layouts/](examples/layouts/) — раскладки интерфейса: по умолчанию, `compact`, своя часть и токены.
- [examples/index.html](examples/index.html) — статичная история и версионированный поток; исходники на TypeScript требуют сервера разработки с поддержкой TypeScript и разрешения импортов пакета.

Для первых трёх страниц отдайте корень пакета статическим сервером, например из каталога `VibeCharts`:

```sh
node examples/terminal/serve.mjs 8340
# http://127.0.0.1:8340/examples/terminal/
```

Аналогично откройте `http://127.0.0.1:8340/examples/showcase/` или `http://127.0.0.1:8340/examples/layouts/`. Этот сервер не компилирует TypeScript, поэтому `examples/index.html` через него не запустится. Для этой страницы можно запустить из каталога `VibeCharts` Vite (Node.js 20 или новее):

```sh
npx --yes vite@6 --host 127.0.0.1
# http://127.0.0.1:5173/examples/
```

Vite не входит в зависимости пакета; `npx` при необходимости скачает его из npm. Если порт занят, используйте адрес, выведенный Vite.

Все данные в примерах синтетические и помечены как демонстрационные.

## Статус

0.1.0, до первого релиза: API может меняться несовместимо в минорных версиях. Большая часть кода написана с помощью ИИ и проверялась автором в браузере; автоматических тестов пока нет. Не используйте для торговых решений без собственной проверки. Изменения — [CHANGELOG.md](CHANGELOG.md).

Лицензия — Apache-2.0, см. [LICENSE](LICENSE). Библиотека поставляется «как есть», без гарантий; примеры используют синтетические данные и не являются инвестиционной рекомендацией.
