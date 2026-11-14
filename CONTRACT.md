# charting — integration contract (0.1.0)

This file is the binding contract between the chart core (`src/core`, `src/render`, `src/dom`) and the optional modules in this package (indicators, drawings, datafeed, interaction, UI, workspaces, alerts, replay, extensions). Public API names below are stable for 0.1.x. Internal fields prefixed `_` are not public.

## 1. Package entry points

| Specifier | Module | Contents |
| --- | --- | --- |
| `vibecharts` | `src/index.js` | `createChart`, `Chart`, `ChartError`, constants, time conversion helpers and the feature factories listed in the README |
| `vibecharts/theme` | `src/render/theme.js` | `THEMES`, `resolveTheme` |
| `vibecharts/interaction` | `src/interaction/index.js` | `attachInteraction` and pure interaction helpers |
| `vibecharts/ui` | `src/ui/index.js` | `createChartUI` and layout/part helpers (optional UI layer) |
| `vibecharts/integration` | `src/integration/index.js` | `attachChartFeatures` (composes drawings, indicators, alerts, extensions, datafeed, replay, interaction, UI) |
| `vibecharts/drawings` | `src/drawings/index.js` | `createDrawingStore` |
| `vibecharts/indicators` | `src/indicators/engine.js` | `computeIndicator`, `registerIndicatorType`, `listIndicatorTypes` |
| `vibecharts/datafeed` | `src/datafeed/index.js` | `createDatafeedController` and validators |
| `vibecharts/alerts` | `src/alerts/engine.js` | `createAlertEngine`, alert validators |
| `vibecharts/replay` | `src/replay/session.js` | `createReplaySession`, `createSimulation`, `validateReplayInput` |
| `vibecharts/extensions` | `src/extensions/registry.js` | `createExtensionRegistry` |
| `vibecharts/workspaces` | `src/workspaces/index.js` | `createWorkspace`, `createSyncController`, `exportChartPng`, tree/marker helpers |
| `vibecharts/styles.css` | `src/styles/charting.css` | Optional stylesheet for package-created DOM; imported separately from JavaScript |
| `vibecharts/ui.css` | `src/styles/ui.css` | Optional stylesheet for the chart UI parts (`--chart-ui-*` tokens, region layout); imports the files in `src/styles/ui/` |

Importing any entry point must not require `window`/`document`; DOM access starts only inside `createChart`, `attachInteraction` and `createChartUI`.

```js
import { createChart, attachInteraction, createChartUI, attachChartFeatures } from 'vibecharts';
const chart = createChart(container, { theme: 'dark' });
chart.timeline.setTimeline(slots);            // host-owned order
const candles = chart.addSeries('candlestick', { metadata }, 'main');
candles.setData(points);
const interaction = attachInteraction(chart, {});
const ui = createChartUI(chart, { host, interaction }); // host holds the chart container as a direct child
// or: attachChartFeatures(chart, { context, interaction: {}, chartUI: { host } });
```

## 2. Public data types

```ts
type UnixMilliseconds = number;               // integer safe ms UTC, |t| <= 8.64e15
type SessionDate = { year: number; month: number; day: number }; // valid Gregorian date
type Slot = { barId: string; time?: UnixMilliseconds; sessionDate?: SessionDate };
type OhlcPoint = { barId: string; open: number; high: number; low: number; close: number; volume?: number | null; buyVolume?: number | null; sellVolume?: number | null };
type NumericPoint = { barId: string; value: number };
type SeriesPoint = OhlcPoint | NumericPoint;

type SeriesMetadata = {
  instrumentId: string; interval: string; sourceId: string;
  board?: string; market?: string; instrumentType?: string;
  currency?: string; priceUnit?: string; volumeUnit?: string;
  priceStep?: number; observedAt?: UnixMilliseconds; delayMs?: number;
  timeZone?: string; calendar?: { timeZone: string };
};
```
Explicit conversion helpers `timeFromUnixSeconds(seconds)` and `timeFromOffsetString(value)` return UTC Unix milliseconds and reject invalid, out-of-range or sub-millisecond values. The string helper accepts ISO date-times with seconds, an explicit `Z` or numeric offset, and at most three fractional digits; it rejects ambiguous local strings and unknown `-00:00` offsets. Timeline, feed, replay, alert-observation and extension timestamps use the same ECMAScript Date range.

`barId` is opaque, host-supplied, stable within `(instrumentId, interval, sourceId)`. It is never derived from time, index or array position. Missing `time` means no time label and no time distance; `sessionDate` is never converted to a UTC midnight. `volume: null` means unavailable; `0` means zero. `buyVolume` and `sellVolume` follow the same rules as `volume` (finite, `>= 0`, `null`/absent = unavailable, never `0`; invalid values throw `INVALID_VOLUME` with the field name) and are kept by `data()`, `update`, `applyBatch`, restore and datafeed points.

## 3. `createChart(container, options): Chart`

`container` must be a DOM element. The chart appends and owns a root element (canvas, overlay, `role=status`, `role=alert`, visually hidden accessible table) and removes only that root on `destroy()`.

Options (all validated atomically; unknown keys are rejected):

```ts
type ChartOptions = {
  theme?: 'dark' | 'light';
  locale?: string;                 // BCP 47
  timeZone?: string;               // IANA; default 'UTC' and labelled UTC
  layout?: { background?: string | null; textColor?: string | null; fontSize?: number; fontFamily?: string };
  grid?: { visible?: boolean; color?: string | null };
  sessions?: { visible?: boolean; color?: string | null; starts?: string[] };
  watermark?: { visible?: boolean; text?: string; color?: string | null; fontSize?: number };
  crosshair?: { visible?: boolean; color?: string | null; labelBackground?: string | null; labelTextColor?: string | null; timeFormatter?: ((time: UnixMilliseconds, slot: Slot) => string) | null };
  timeScale?: {
    visible?: boolean; barSpacing?: number; rightOffset?: number;
    borderColor?: string | null; textColor?: string | null;
    slotLabel?: ((barId: string | null, slot: Slot | null, index: number) => string) | null;
    tickMode?: 'index' | 'time';
  };
  priceScale?: { borderColor?: string | null; textColor?: string | null; tickSpacing?: number | null; margins?: { top: number; bottom: number } | null };
  autoSize?: boolean;              // one ResizeObserver, never duplicated
  accessibilityLabel?: string;
  countdown?: { visible?: boolean; placement?: 'corner' | 'label' };
};
```

Session boundaries are host supplied: `sessions: { visible?, color?, starts?: string[] }` marks the boundary immediately before each listed `barId`. An unknown or removed slot is not guessed; its boundary appears only when that ID is present. Session dates and timestamps are never inferred from these markers. `timeScale.borderColor` and `timeScale.textColor` independently override the index-axis border and labels; `null` restores theme inheritance.

Watermark: `watermark: { visible?, text?, color?, fontSize? }` (defaults `{ visible: true, text: '', color: null, fontSize: 48 }`) draws `text` bold, centred in the plot area of the first pane, behind its series and clipped to the plot rectangle; it is re-centred on every render, so resize follows automatically. `text` must be a string and an empty string draws nothing; `fontSize` must be a finite number above 0 (CSS pixels); `color` is a colour string or `null`. With `null` the theme text colour is drawn at alpha 0.07; an explicit colour is used as given, without added transparency. Unknown keys and invalid values are rejected before any change is applied. The section is included in `getState().options` and is patched through `applyOptions` or `createChart` options like the other sections.

Color overrides default to `null` (inherit the selected theme); setting an override to `null` restores theme inheritance. The UI theme control updates the chart and is unavailable without `chart.applyOptions`.

Presentation options added by `chart-visual-parity` are opt-in; their defaults reproduce the earlier output. `timeScale.tickMode` is `'index'` (equally spaced ticks) or `'time'` (ticks on calendar boundaries; slots without `time` fall back to index ticks). `crosshair.timeFormatter` is trusted host code returning a string, and `crosshair.labelTextColor` colours the plate text independently of `layout.textColor` (`null` inherits). `priceScale.tickSpacing` is a positive pixel distance between price labels (`null` keeps five ticks); `priceScale.margins` is `{ top, bottom }` as fractions of the pane height, each in `[0, 1)` with a sum below 1 (`null` keeps 10% on each side). `countdown.placement` is `'corner'` or `'label'`. Invalid values are rejected before any option changes, naming the field.

Time axis (`timeScale.tickMode: 'time'`): when every visible slot (plus the slot before the first one, if it has a time) carries `time`, ticks are the first existing slot of each bucket of the chosen step in `timeZone` (minute steps 1–720, day, day-of-month blocks of 2/5/10/15, month steps 1/3/6, year steps). The step is the finest one whose duration covers 84 px, estimated from the median distance between neighbouring slots, so overnight and weekend gaps do not coarsen it. A bucket never starts a second tick (wall-clock repeats at a DST shift cannot duplicate one), a boundary without a slot gives no tick, and two ticks closer than 84 px keep the one for the larger boundary. A label names the largest boundary the tick crosses (year, month, day, then time) and is bold when that boundary is larger than the step's own unit. If any visible slot lacks `time` the axis falls back to index ticks without inventing dates. The vertical grid uses the same ticks.

## 4. `Chart` public API

```ts
chart.id: string
chart.timeline: Timeline
chart.container: HTMLElement
chart.canvas: HTMLCanvasElement | null
chart.element: HTMLElement
chart.surface: ChartSurface            // internal integration facade (section 10)
chart.integration: ChartSurface        // alias

chart.indexScale(): IndexScale
chart.priceScale(paneOrId, scaleId = 'right'): PriceScale
chart.addPane(options?): Pane
chart.removePane(paneOrId): void       // last pane or non-empty pane rejected
chart.addSeries(type, options?, pane?): Series
chart.removeSeries(seriesOrId): void
chart.applyBatch(batch): Chart
chart.replaceData({ slots, series }): Chart
chart.resetData(): void
chart.applyOptions(patch): Chart
chart.resize(width, height): Chart
chart.subscribe(event, handler): () => void
chart.destroy(): void
chart.getPanes(): PaneDescriptor[]
chart.applyPaneLayout(panes): void
chart.getInteractionLayout(): InteractionLayout
chart.getSeriesValues(barId): SeriesValueEntry[]
chart.getState(): ChartState
chart.restoreState(snapshot): Chart
chart.addDerivedView(type, source, options): DerivedView
chart.removeDerivedView(viewOrId): void
chart.derivedViews(): DerivedView[]
chart.setCrosshair(barId, price?, pane?): void
chart.setCrosshairAnchor({ anchorBarId, offset, price? }, pane?): void
chart.getCrosshair(): CrosshairState | null
chart.setBarCloseTime(barId: string, closeTimeMs: number | null): void
chart.setBarCloseTime(barId: null): void
chart.attach({ name, api, hooks }): () => void
chart.detach(name): void
chart.datafeed?: DatafeedController           // after attachChartFeatures
chart.connectDatafeed?(source, context): Promise<DatafeedControllerState> // after attachChartFeatures
chart.alerts?: AlertEngine                    // after attachChartFeatures
chart.drawings?: DrawingStore                 // after attachChartFeatures
chart.addIndicator?({ type, source, pane, parameters?, style?, id?, priceScaleId? }): IndicatorHandle
chart.series(seriesId): SeriesAdapter   // function; also .list/.remove/.add/.setVisible

chart.renderRevision: number           // increments on every requestRender
chart.presentedRevision: number        // last fully drawn revision
chart.whenRendered(revision?): Promise<number>
chart.requestRender(): void
```

`addSeries` types: `candlestick`, `bar`, `line`, `histogram`, `area`, `baseline`. Area and baseline require a finite `options.basePrice`. Series options: `id`, `priceScaleId`, `metadata`, `visible`, `lastValueVisible`, `title`, plus type styling (`upColor`, `downColor`, `equalColor`, `border*Color`, `wick*Color`, `borderVisible`, `wickVisible`, `color`, `lineWidth`, `basePrice`, `fillColor`, `above*`, `below*`).

`priceLine` (`{ visible?, style?: 'solid' | 'dashed' | 'dotted', color?: string | null, width? }`) draws a line across the plot at the last present value; it is off by default, and an object that omits `visible` is drawn. `lastValueColorMode` is `'neutral'` (default) or `'direction'`. Both are presentation overrides reported by `series.options()` and removed with `undefined`; they are not part of `getState().series`.

`chart.series(id).options()` returns a copy of the series' explicit style overrides and `lastValueVisible` when set. `setOptions(patch)` validates the complete style/last-value visibility patch before applying it and requests a redraw; an `undefined` value removes that override, except for the required `basePrice` of area and baseline series. `setVisible(visible)` changes visibility only when the value differs from the effective one and then emits one `datachange` with `kind: 'seriesVisibility'`; a no-op change emits nothing.

`setBarCloseTime` accepts only the current (last) timeline bar. When a close time is set, enabling `countdown.visible` starts one-second redraws; disabling it or destroying the chart stops them. A timeline change that makes another bar current, or clears the timeline, removes the old close time and stops its timer. No close time means no countdown timer.

Last-value labels use the last present source `close` or numeric `value` in timeline order; an empty or independently disabled series has no label. A supplied price step controls decimal precision and supplied currency is shown for price values; without a step the numeric representation is neutral and does not invent precision. An explicit `priceUnit` is appended to the value, `priceUnit: 'percent'` is rendered as `%`, and a currency equal to the unit is not repeated. Percent labels show percentages without a currency. Scale ticks use the shared step only when all visible series on that scale agree on it. Labels are arranged independently per visible scale column: last values take priority in series order, followed by scale ticks. Shifted labels have leader lines; when a full label cannot fit, lower-priority labels appear with their pane, scale, series or tick and complete formatted value in the keyboard-operable “More price labels” list. Neither placement nor formatting changes source values or scale coordinates.

The interaction crosshair emits `crosshairMove` on the chart as well as on the interaction controller. It snaps only within history and otherwise reports a free coordinate and signed edge offset without a bar, time or date. Pointer coordinates are relative to the chart container and converted through the selected pane's plot and price scale. The textual OHLCV readout distinguishes absent values from zero and refreshes under a stationary pointer. A missing bar time never produces a time label. Interaction-specific locale/time-zone overrides take precedence; otherwise the current chart settings are used, and UTC timestamps are identified as UTC.

The optional accessible table displays OHLCV fields for candle/bar series and a `value` column for numeric series. It refreshes after data changes and uses the chart locale and time zone unless the interaction was configured with explicit overrides; missing time, session date and volume remain absent.

Wheel zoom is consumed only over a visible plot, not over an axis or outside the plot. Hiding a pane moves focus to its restore control only when that pane held chart focus; otherwise the existing focus is preserved.

The context menu depends on the hit target and omits actions that cannot act there. Plot (and a drawing on it): «Подогнать данные», «Вернуться к последнему бару», «Автомасштаб цены». Price axis: «Автомасштаб цены», «Ценовая шкала слева» or «справа» (only the side the scale is not on), «Инвертировать ценовую шкалу» (both only when the scale options can be applied) and «Логарифмическая шкала» (checkable; only on the primary scale, not on a percent scale). Index axis and the chart outside any pane: fit and return to the last bar. With more than one visible pane every pane target adds «Скрыть панель», «Переместить панель выше» (not on the first pane) and «Переместить панель ниже» (not on the last). A target without items opens no menu (a pointer right-click keeps the browser menu); Shift+F10 then announces «Нет доступных действий». `interaction.toggleLogScale(paneId?)` and `interaction.getPriceScaleMode(paneId?)` expose the same primary-scale toggle as the `l` binding.

The context menu is positioned within the viewport when opened. With the optional stylesheet its size is bounded by the viewport and overflowing items can be scrolled; hosts replacing the stylesheet are responsible for their own menu sizing.

Ownership: a series/pane from another chart is rejected (`SERIES_OWNERSHIP` / `UNKNOWN_PANE`). IDs are stable and unique per chart.

`destroy()` emits `destroy` exactly once, cancels pending draw and accessible-table frames, subscriptions, observers, pointer capture, DOM handlers and chart-owned nodes, and leaves the host container intact. Existing unsubscribe functions remain idempotent and callable; repeated `destroy()` is safe. Other chart operations, including operations on previously obtained chart-owned timeline, series, pane, scale, derived-view, integration and optional-feature handles, reject with `CHART_DESTROYED`. Pending `whenRendered` promises reject with that code. Cleanup continues after a module failure; the first `destroy()` reports cleanup failures as an `AggregateError` after attempting the remaining cleanup.

`resize(width, height)` accepts finite non-negative CSS-pixel dimensions. Zero dimensions suspend drawing; the data, interactive state and visible logical range are retained when size returns. The backing buffer uses the current DPR, including when DPR changes without a change in the container's CSS dimensions. Automatic container observation is optional and is disconnected on destruction.

## 5. `Timeline`

```ts
chart.timeline.revision: number
chart.timeline.length: number
chart.timeline.slotAt(index): Slot | null
chart.timeline.indexOf(barId): number | null
chart.timeline.toArray(): Slot[]
chart.timeline.listSlots(): Slot[]
chart.timeline.setTimeline(slots): Timeline
chart.timeline.append(slots): Timeline
chart.timeline.prepend(slots): Timeline
chart.timeline.previewRemoveHistoryBefore(barId): HistoryRemovalPlan
chart.timeline.removeHistoryBefore(plan): { removedBarIds, boundaryBarId, revision }
```

Order is exactly the host array order. Nothing is sorted or deduplicated. `append`/`prepend` reject existing or in-batch duplicate `barId`s. `setTimeline` is rejected atomically if it would drop a slot referenced by series points; use `resetData()` or `replaceData()` for a full change. `removeHistoryBefore` removes slots strictly before the boundary and all series points there in one commit; changes to the timeline, series revisions, or affected drawings, alerts and calculations require a new preview. Drawings anchored on removed bars become unresolved but keep `{anchorBarId, offset}`. The integrated local alert engine pauses affected drawing alerts until the anchors return; backend state is not changed. Shared-engine hosts must supply explicit matching chart IDs for this reconciliation. No automatic eviction exists.

## 6. `Series`

```ts
series.id, series.type, series.pane, series.priceScaleId, series.revision, series.length
series.setData(data, metadata?): Series
series.update(point): Series
series.prepend(data): Series
series.correct(point): Series
series.data(): SeriesPoint[]
series.point(barId): SeriesPoint | null
series.lastPoint(): SeriesPoint | null
series.metadata(): SeriesMetadata | null
```

- `setData` replaces everything, accepts `[]`; changing identity requires a complete new metadata object.
- `update` replaces the last point at the same `barId`, or adds a point on a later existing slot; older slots require `correct`.
- `prepend` adds a non-overlapping ordered batch strictly before the first existing point.
- `correct` replaces an existing point by `barId`; it never creates one.
- Points are ordered by timeline position; duplicate or reversed `barId`s reject the whole call. Inputs are copied.

## 7. Scales

`IndexScale` (horizontal, integer indices = current slot positions, fractional = free logical step units):

```ts
indexToCoordinate(index): number | null
coordinateToIndex(x): number | null       // nearest between first/last centers, tie -> earlier
barIdToIndex(barId): number | null
indexToBarId(index): string | null
barIdToCoordinate(barId): number | null
coordinateToLogical(x): number | null
logicalToCoordinate(logical): number | null
getVisibleRange(): { from: number; to: number } | null
setVisibleRange({ from, to }): void       // finite, from < to; may extend outside history
fitContent(): void
scrollToRealTime(): void
timeToIndex(time): number | null          // null when absent; throws on multiple matches
isFollowingRealTime(): boolean
setFollowRealTime(enabled): void
slots(): Slot[]                           // integration adapters
```

Empty timeline returns `null` for anchor-dependent conversions. Unknown `barId`/index returns `null`. A fractional logical coordinate never creates a bar or date.

`PriceScale`:

```ts
priceToCoordinate(price): number | null
coordinateToPrice(y): number | null
getVisibleRange(): { min: number; max: number } | null
setVisibleRange({ min, max }): void       // disables auto scale
setAutoScale(enabled): void
setMargins({ top, bottom } | null): void   // own autoscale margins; null uses the chart priceScale.margins
setMode('linear' | 'log' | 'percent', options?): void   // percent requires { base }
setSide('left' | 'right'): void
setInverted(inverted): void
setVisible(visible): void
setOverlay(enabled): void   // series are drawn in the pane without an axis column, grid, labels or last-value labels
isAutoScale(): boolean
mode, base, side, inverted, visible, overlay, autoScale, height, margins
```

Auto scale follows finite visible values of visible attached series. Hiding or showing a series immediately recomputes the scale; if no visible values remain, the last range is retained. Flat data gets a non-zero display padding without modifying data. Manual ranges survive new data until `setAutoScale(true)`. Log mode rejects non-positive ranges and non-positive price projection. Percent uses `100 * (price - base) / abs(base)` and inverse `base + percent * abs(base) / 100`; base must be finite and non-zero.

Price axis presentation: `priceScale.tickSpacing` turns the pane height into a label count (`round(height / tickSpacing)`, clamped to 2–20) shared by the horizontal grid and the axis labels, so a taller pane or a smaller spacing gives more labels on round values and none is dropped only because there are more than the default five. Margins are fractions of the pane height used by autoscale only: with `{ top: 0.2, bottom: 0.1 }` the highest data value sits at 20% of the height below the top and the lowest at 10% above the bottom. A scale's own margins replace the chart value, `null` removes the override, and unset margins keep 10% of the data span on each side. In log mode the margins apply to the logarithmic span; flat data keeps a non-zero range. Series `lastValueColorMode: 'direction'` paints the last-value label and the price line with the series up/down/equal colour of the last candle or bar (open versus close), or, for numeric series, by comparison with the previous present value; with one point or no comparable value the neutral colour stays. `countdown.placement: 'label'` draws only `m:ss` under the first last-value label of the first pane (right side preferred), and nothing when no label is drawn or no close time was set; `'corner'` keeps the earlier text.

Overlay scales (`setOverlay(true)`, off by default): series assigned to the scale (`priceScaleId`) are drawn in the plot of their pane against their own autoscaled range and optional margins, e.g. `{ top: 0.8, bottom: 0 }` puts a volume histogram into the bottom fifth. The scale takes no axis column, draws no ticks, grid lines or last-value labels, does not count as the pane's primary scale (crosshair price, axis gestures, double-click auto scale and drawing bindings use the first non-overlay scale) and appears neither in `getInteractionLayout().priceScales` nor in the axis columns. Its values never enter another scale's autoscale and vice versa; a manual range disables autoscale for that scale only. Values of overlay series are part of `crosshairMove.series`, the text readout (labels lead with the series id when there are several series) and the accessible table. `setVisible(false)` without `overlay` still leaves the scale undrawn. `getState().priceScales[]` carries `overlay` and `margins`; `restoreState` treats absent fields as unchanged and rejects a non-boolean `overlay` or invalid `margins` before any mutation.

Optional stylesheet: `vibecharts/styles.css` (`src/styles/charting.css`, listed in `exports` and the only entry in `sideEffects`) styles the package-created context menu, hidden price label list, readout and status regions through the custom properties `--charting-surface`, `--charting-text`, `--charting-muted`, `--charting-border`, `--charting-hover`, `--charting-accent`, `--charting-focus` and `--charting-error` (dark values by default, `data-theme="light"` on an ancestor for light). Importing JavaScript modules never loads or injects it, and it contains no `url()`, `@import`, fonts or executable code. The context menu lists only actions that can act on the clicked target (unavailable ones are omitted, not shown disabled); checkable entries use `menuitemcheckbox`. Focus uses a 2px outline; transitions are off under `prefers-reduced-motion`. The text readout formats prices with the series `priceStep` (as the axis labels do) unless `readout.priceDigits`, `readout.priceUnit` or `readout.priceFormatter(seriesId | null, value)` is set; without a step the number is printed as supplied.

## 8. Atomic operations

`chart.applyBatch(batch)` — one optional timeline change plus related series operations:

```js
chart.applyBatch({
  timeline: { op: 'append' | 'prepend', slots: Slot[] },   // `type` accepted as alias
  series: [
    { seriesId: 's1', points: OhlcPoint[], operation: 'append' | 'prepend' | 'update' | 'correct' | 'setData', metadata?: SeriesMetadata }
  ]
});
```

Derived views are calculated against candidate series and timeline data before a data commit. A calculation error rejects the transaction without changing the source, derived elements or success events; non-advancing Renko steps are rejected instead of looping.
Derived element IDs encode the transformation context and source lineage through SHA-256. With complete instrument, interval and source metadata, the same provenance and view ID restores the same element ID after recreating a view; without complete context, IDs are scoped to the view lifetime. Changes to input history leave existing selections unresolved until the same history returns. A digest collision detected in the current or preceding computation is an error. Derived rendering uses the source series' price scale. Non-advancing Point & Figure cells and non-finite derived results are rejected.
`DerivedView.hitTest({ x, y }, radius?)` uses the view's own index scale (Heikin Ashi uses the source scale) and the source series' price scale; it returns the nearest element within `radius` pixels (default 6) with its `sourceBarIds` and the source points, or `null` for hidden views, gaps, positions outside the plot or unresolvable scales. Invalid points or a negative radius throw.

**X axis per pane.** A derived view belongs to the pane of its source series. Renko, Kagi and Point & Figure are *independent* views: they own an element scale instead of the source timeline (Heikin Ashi stays on the source scale). Each pane has one x context:

| kind | condition | axis |
| --- | --- | --- |
| `source` | no visible independent view | `chart.indexScale()` (time) |
| `derived` | exactly one visible independent view, no visible ordinary series (indicator outputs included), no other visible view | that view's element scale |
| `conflict` | a visible independent view shares the pane with visible series or other views | source scale; the independent view is **not drawn** |

A conflict emits one `error` event per state change and the pane shows the same message; the view is never drawn on a foreign axis. Resolve it by hiding the source series and giving the independent view a pane of its own (`addPane`, `addSeries(type, options, pane)`, then `addDerivedView`). `source` panes share the main scale; each `derived` pane scrolls and zooms independently. A `derived` pane reserves an axis strip at its bottom edge labelled with element ordinals; timestamps are never invented for element positions, and the time readout is omitted there. The bottom time axis follows the source scale and is blank when every visible pane is `derived`.

`crosshairMove` and `chart.getCrosshair()` always expose the source bar as `barId` (for an element, its `completionBarId`) and add `derivedElementId` inside a `derived` pane. Inside a `derived` pane `chart.setCrosshair(id, price, pane)` and `setCrosshairAnchor` accept a source bar id or an element id; a source bar maps to the last element completed at or before it, and `UNKNOWN_BAR_ID` is thrown when none exists. `chart.indexScale()` remains the source timeline scale. The source crosshair vertical spans every `source` pane; a `derived` crosshair stays inside its own pane. Range synchronisation between panes of different kinds is not defined; drawings on a `derived` pane anchor to element ids, and regression channel and anchored VWAP are unavailable there.
Validation covers slot shape/uniqueness, host order, point shape/OHLC, existing refs and log-scale constraints before any mutation. On error: no timeline, points, scales, crosshair, anchors or success events change. On success: one commit, then one `datachange` with `kind: 'batch'`. If `operation` is omitted it defaults to `prepend` for a prepend batch, `append` for an append batch, and `update` without a timeline.

`chart.replaceData({ slots, series: [{ seriesId, points }] })` — atomic full replacement. `slots` is the complete next timeline. Listed series get exactly `points`; omitted series are cleared. Series objects, panes, drawings and options survive. Validation/module hooks run before mutation. Success emits one `datachange` with `kind: 'replace'`. This is the only supported replacement path for datafeed snapshots; do not combine `resetData()` with `applyBatch()`.

`chart.resetData()` clears timeline, every series point and the crosshair, keeps panes/series/drawings (anchors become unresolved), and emits `kind: 'reset'`.

`chart.restoreState(snapshot)` restores presentation state. It accepts `getState()` keys: `options`, `panes`, `visibleRange`, `crosshair`, `series`, `derived`, `priceScales`, `modules`, and informational `id`/`context`/`contexts`. Core fields and module hooks validate before mutation. A failed apply restores core and each attempted module in reverse order; chart and integrated drawing notifications are withheld until success. Modules can capture rollback-only state with the paired hooks below, or must accept their prior exported snapshot through `onRestoreState`. Rollback failure produces an `AggregateError`. External backend confirmations are independent and cannot be made atomic by this local rollback; rejection or uncertainty remains visible. Data/timeline is restored via `replaceData`, not `restoreState`. Unknown or mismatched descriptors are rejected; missing series must be pre-created.

## 9. Events

`chart.subscribe(event, handler)` returns an idempotent unsubscribe. Each subscription is independent, even when the same handler is registered more than once. Cancellation takes effect immediately, including during event delivery. Delivery happens after a successful commit only.

| Event | Payload |
| --- | --- |
| `datachange` | `{ chartId, kind: 'series'|'batch'|'replace'|'reset'|'timelineAppend'|'timelinePrepend'|'timelineReplace'|'historyRemove'|'seriesAdd'|'seriesRemove'|'seriesVisibility'|'paneAdd'|'paneRemove'|'paneLayout'|'derivedAdd'|'derivedRemove'|'derivedVisibility'|'derivedParameters'|'restore', seriesId?, operation?, barId?, barIds?, removedBarIds?, boundaryBarId?, range }` |
| `visibleRangeChange` | `{ chartId, range: {from,to}|null, priceScales?: PriceScaleDescriptor[], derivedId? }` |
| `crosshairMove` | `{ chartId, barId: string|null, index, offset, logical, insideHistory, price, paneId, time?, sessionDate?, series: SeriesValueEntry[] }` |
| `resize` | `{ chartId, width, height, devicePixelRatio }` |
| `destroy` | `{ chartId }` |
| `render` | `{ chartId, revision }` (after canvas + module `onRender` completed) |
| `error` | `{ chartId, operation, error }` (module/listener/renderer failures) |

`time`/`sessionDate` appear only when provided and only for an exact slot (`offset === 0`). A fractional crosshair keeps `barId`, `offset`, `logical` and never rounds to a bar.

## 10. Integration facade (`chart.surface`, alias `chart.integration`)

Internal to package modules, not a substitute for public API. No DOM access at import time.

```ts
interface ChartSurface {
  container, canvas, overlay, status, alert, table, element; // DOM nodes (table is the a11y alternative)
  layout: InteractionLayout;                                  // rects, panes, price-scale columns
  panes: PaneDescriptor[];
  locale: string; timeZone: string;                          // current presentation settings
  requestRender(): void;
  subscribe(event, handler): () => void;
  emit(event, payload): void;
  resolveAnchor({ anchorBarId, offset }): number | null;      // logical x, null when unresolved
  anchorToX(anchor): number | null;
  xToAnchor(x): { anchorBarId, offset } | null;               // exact fractional, no rounding
  logicalToX(logical): number | null;
  xToLogical(x): number | null;
  priceToY(price, { paneId?, scaleId? }): number | null;      // absolute canvas y
  yToPrice(y, { paneId?, scaleId? }): number | null;
  getVisibleRect({ paneId? }): { x, y, width, height } | null;
  getStateSnapshot(): ChartState;
  getSeriesValues(barId): SeriesValueEntry[];
  onPointer(id, type, handler, options?): () => void;         // duplicate id throws
  onKeyboard(id, type, handler, options?): () => void;
  addOverlay(element): () => void;
  addControl(control): () => void;
  removeControl(id): void;
}
```

`InteractionLayout`:

```ts
{
  width, height, devicePixelRatio,
  rect: { x, y, width, height },
  panes: [{
    id, order, visible, height, minHeight,
    plot: { x, y, width, height },
    priceScales: [{ id, side: 'left'|'right', rect: {x,y,width,height}, inverted }],
    indexAxis: null
  }]
}
```

`getPanes()` returns `{ id, order, height?, minHeight, visible, seriesIds }`. `height` is omitted when the chart has no resolved pixel height (e.g. a 0-size container); `restoreState(getState())` accepts that unresolved height and falls back to the pane's own value, so zero-size snapshots remain restorable. `applyPaneLayout(panes)` accepts `{ id, order?, height?, minHeight?, visible?, seriesIds? }`, requires every pane, and refuses to hide the last visible pane. Pane layout validation is atomic.

## 11. Module attachment

```js
const detach = chart.attach({
  name: 'drawings',           // exposed as chart.drawings; reserved names rejected
  api: drawingStore,          // stable module facade
  hooks: {
    onDataChange(payload) {},
    onBeforeDataCommit(context) {},   // throw to veto; may return contributions
    onSeriesRemoved(series) {},
    onBeforeSeriesRemove(series) {},  // throw to veto removal; nothing mutated
    onReset() {},
    onTimelineChange({ kind, count?, paneId?, precommitted? }) {},
    onHistoryPreview(plan) { return { drawings: [], alerts: [], affectsIndicators, affectsDerived }; },
    onBeforeHistoryRemove(plan) {},   // throw to veto
    onHistoryRemoved({ removedBarIds, boundaryBarId, precommitted? }) {},
    onCrosshairMove(payload) {},
    onVisibleRangeChange(payload) {},
    onResize(payload) {},
    onRender({ ctx, chart, layout }) {}, // after canvas draw, same frame
    onExportState(state) { return moduleState; },   // merged into state.modules[name]
    onValidateRestore(snapshot) {},                  // throw to veto restore
    onCaptureRestore(snapshot) { return checkpoint; }, // optional, paired with rollback
    onRollbackRestore(checkpoint, previousSnapshot) {},
    onRestoreState(snapshot) {},
    onDestroy() {},
    onError(error) {}
  }
});
```

`onBeforeDataCommit` runs after core validation and before mutation for series mutations, direct timeline append/prepend and history removal, `applyBatch` and `replaceData`. It may return `{ series: [...] }` or an array of `{ series|seriesId, operation?, points|data, metadata? }`. Returned operations are validated against the candidate timeline and committed in the same transaction; duplicates of already-prepared series are rejected. Direct timeline mutations retain their events and set `precommitted: true` on the corresponding module hook. `onSeriesRemoved`/`onDataChange` errors are reported as `error` events and do not roll back a committed core change; use pre-commit hooks for vetoes. Restore checkpoint capture must be side-effect-free.

`chart.attach` registers the supplied API and hooks, but does not acquire ownership of or call `destroy()` on an arbitrary host-provided API. The registration's `onDestroy` hook releases resources allocated for that registration. Host objects and functions retained independently remain under host control. The library's built-in chart-facing feature handles are scoped to the chart; in particular, an externally supplied alert engine remains usable by its owner and other charts when one chart is destroyed, while that chart's `alerts` facade and subscriptions are closed.

## 12. Drawings anchors

A horizontal anchor is always `{ anchorBarId: string, offset: number }`, resolved as `index(anchorBarId) + offset`. `offset` is finite and fractional; it may be negative, between bars, or beyond the last bar. There is no rounding to a slot and no synthetic bar/time. `chart.surface.resolveAnchor` returns `null` for a missing anchor and retains the stored anchor unchanged. Derived elements use the stable element id as `anchorBarId`; `DerivedView.elementToBarId`/`barIdToElement` provide explicit source mapping, and no neighbour substitution occurs.
Drawing types include line and channel geometry, rectangles and ellipses, Fibonacci tools, text and price annotations, measurement, arrows, angles, triangles, polylines, Bézier curves, brush and marker strokes, regression channels, pitchforks and anchored VWAP. Missing anchor IDs remain unresolved until the same ID returns in the same context.
Drawing edits preserve pane and scale bindings. Grouping, z-order, visibility, locking, named styles and favorites are explicit operations; interval changes never infer anchor mappings from indices or time. A host transferring a drawing to another interval must explicitly map its anchors and context.
Confirmed drawing creation, edits, deletion and clearing are undoable transactions. The host sets a nonnegative history limit; zero disables history, and a new change after undo discards redo. Locked objects and failed guarded operations do not partially alter the drawing set.
Drawing exports are versioned data documents, not storage operations. Import validates the complete document and instrument, interval, source, view, pane and scale bindings before replacement; missing anchor IDs remain unresolved rather than invalidating a compatible document.

Backend drawing alerts require an explicit `drawingId`. The integrated drawing store uses the chart's alert engine to reconcile geometry edits and deletion; shared-engine hosts should provide `drawingChartId` and matching alert-source `chartId`. Multiple dependent backend confirmations are independent; if they diverge, the renderer marks confirmed active geometries separately while retaining the prior drawing. See `src/alerts/CONTRACT.md`.

`interaction.armDrawing(type, { paneId?, scaleId?, props? })` activates chart construction. Arrow keys move the construction cursor, Enter places an anchor, F completes variable-length drawings, and Escape cancels. `setDrawingSnap` configures free/weak/strong price snapping, optional OHLC source, magnet, thresholds, explicit price-step rounding and `modifier` (`alt` default, `ctrl`, `meta` or `null`; Shift is reserved): while held during drawing or handle drag the snap is strong with the bar-centre magnet, the source defaulting to the pane's first visible candlestick/bar series (Ctrl+click is a context menu on macOS); invalid patches do not change settings. The drawing controls expose selection, anchors, styles, groups and history through the same store.
Dragging an existing multi-selection commits its distinct anchor changes through `drawings.updateBatch([{ id, patch }, ...])` as one guarded undo command; a locked or unresolved member prevents the whole move. Crosshair readouts use chart theme colors.
Drawing geometry and hit testing use the drawing's bound pane and scale, including Fibonacci spans and pane clipping.
Selection changes notify drawing-store subscribers with a `selection` event and render selected drawings with highlighted geometry and handles. `removeSelected()` removes only the current selection as one guarded undoable operation; clearing all drawings is a separate operation.
Construction and drag previews use the same geometry builders as committed drawings and do not create a drawing or undo command. `drawings.previewLayout(drawing)` computes a normalized preview without changing the store.
Standalone drawing-store hosts may provide `deferNotifications(deliver)`: return `true` only after taking responsibility for invoking the callback once on commit, or discarding it on rollback; return `false` for immediate delivery.
Drawing control drafts survive unrelated store updates; successful actions clear the fields they committed while preserving focus where possible.

## 13. Indicators

Input: only the explicitly named source series, ordered by `chart.timeline`; missing points are missing inputs, never zero. Outputs: named arrays of `{ barId, value: number | null }`; `null` is an explicit absent value. Output series are ordinary chart series (`line`/`histogram`) created by the host/integration, updated through `applyBatch` or precommit contributions. Time is optional and preserved only when the source slot provides it. Deleting a source series must remove dependent indicators through `onBeforeSeriesRemove`/`onSeriesRemoved`; deleting an indicator never deletes the source. Custom indicator functions are trusted application code, not sandboxed.

SMA, EMA, RSI, MACD and Bollinger require an explicit `sourceField` parameter; the library does not choose a price field on the host's behalf.
`source` and `pane` are required chart-owned objects or IDs. `style` and `setStyle` accept `color`, `lineWidth`, `upColor` and `downColor`; histogram outputs use `color`, `upColor` and `downColor` (line outputs ignore `upColor`/`downColor`). Removing a source series removes its dependent indicators and their output series.
Built-in `delta` (no parameters; inputs `buyVolume`, `sellVolume`; output `value`, units `volume`) is `buyVolume - sellVolume` per bar and is rendered as a histogram; it is `null` when either input is missing. Added with no `color`/`upColor`/`downColor` it colours bars with the theme rise/fall colours at creation time (it does not follow later theme changes; pass explicit colours or call `setStyle` to override).
Multiple indicators may independently use different sources and either share a pane or use separate panes. Source replacement, updates, appended or prepended slots, history corrections and explicit history removal recalculate affected outputs in timeline order; the output changes are validated with the source transaction before commit.
`indicator.setParameters(patch)` validates and recalculates before replacing its outputs and parameters. Invalid patches leave both unchanged; locked or removed indicators reject the operation.
`indicator.getErrors()` returns computation diagnostics without copying full output series. Failed calculations remain distinct from missing values, emit an indicator-specific chart error, appear in the UI, and suspend dependent local alerts until a successful recalculation. Removal while failed keeps those alerts unavailable. Initial UI data status is unknown until the host reports loading, available, empty or an error.
Rolling means use compensated summation to retain small contributions when large values enter or leave the window; no display rounding is applied to calculations.
Stochastic computes rolling high and low without spreading the window into function arguments; valid large lookback periods do not depend on the JavaScript engine's argument-count limit.
Custom indicator registration exposes typed parameter, input, output and calculation contracts. Declared inputs are finite numbers (`volume`, `buyVolume` and `sellVolume` must also be nonnegative), except `sessionDate`, which is a valid Gregorian date; missing inputs break the segment and invalid inputs report an error.
Histogram series accept the options `color`, `upColor` and `downColor`: when both `upColor` and `downColor` are set, values `>= 0` use `upColor` and values `< 0` use `downColor`; otherwise every bar uses `color` (theme volume colour by default). Bars are anchored at zero, negative values render below the zero line, and the autoscaled range of a histogram on a non-logarithmic scale always includes `0`.
Indicator output metadata follows the source and selected output units, including source metadata changes and `sourceField` updates. Volume outputs never inherit currency; incompatible declared units require separate scales. `applyBatch` accepts metadata on `setData` entries and validates the resulting scale assignments before committing.

## 14. Datafeed

The library never performs network I/O. The host supplies an `IndexDatafeed` (`capabilities`, `loadHistory`, `subscribe`, `observe`, optional `requestSnapshot`). Initial history and snapshots apply through `chart.replaceData`; older pages and stream appends apply through `chart.applyBatch` with `prepend`/`append`. `chart.series(seriesId)` returns the series adapter used by the datafeed. Context changes and `destroy` must abort requests and ignore late results. No synthetic bars, times, volumes, freshness or notifications.
OHLCV and numeric points refer to host-provided slots. Optional observation streams can deliver numeric alert inputs without a bar or timestamp. `disconnect()` is idempotent: it releases declared subscriptions at most once and ignores late events.
History cursors and snapshot boundaries belong to their source context; opaque versions are compared by equality and chained predecessor links, not sorted. Repeated identical versions are deduplicated; conflicting versions or gaps retain the last consistent data and require host-supplied reconciliation. The library does not silently repeat mutations.

Datafeed replacement rejects `ambiguous-replacement` when the new timeline drops a slot referenced by existing points; a complete change requires an explicit reset or new context. Cancellation of an obsolete older-page request does not set a loading error.
While a chart stream is inconsistent or awaiting a snapshot, datafeed completeness is `unconfirmed` and previously loaded data is reported as stale.
Providers can report `{ type: 'gap', context, gapId, range: { fromBarId, toBarId } }`; endpoints are opaque, inclusive and host-ordered. Pending ranges are exposed in `state.chart.missingRanges`. They clear only when a versioned history explicitly lists every pending ID in `reconciledGapIds` at a new boundary; reconnecting the same context retains them. Snapshot requests are coalesced and existing data remains stale until reconciliation.

## 15. Expected module exports

These are the documented factories composed by `attachChartFeatures`; they must remain named ESM exports:

- `src/interaction/index.js`: `attachInteraction(chart, options?)`
- `src/ui/index.js`: `createChartUI(chart, options?)` (optional layer; requires an attached interaction for the controls that need it)
- `src/integration/index.js`: `attachChartFeatures(chart, options?)`, `createWorkspaceChartFactory({ createChart, context, chartOptions, features })`
- `src/drawings/index.js`: `createDrawingStore({ context, geometry, historyLimit })`
- `src/indicators/engine.js`: `computeIndicator(type, parameters, rows)`, `registerIndicatorType(spec)`, `listIndicatorTypes()`
  Registration returns an unregister function; listing returns metadata objects containing `id`, `semanticVersion`, `parameters`, `inputs`, and `outputs`.
- `src/datafeed/index.js`: `createDatafeedController(options)`, `validateDatafeed(feed)`, `validateHistoryResult(result, request)`, `validateFeedEvent(event, context)`, `validateObservationEvent(event, context)`, `DatafeedError`
- `src/extensions/registry.js`: `createExtensionRegistry({ chartContext, onError })`
- `src/alerts/engine.js`: `createAlertEngine(options)`
- `src/replay/session.js`: `createReplaySession(options)`
- `src/workspaces/index.js`: workspace factories (see its contract)

`attachChartFeatures(chart, { context, drawings, alerts, alertEngine, drawingChartId, datafeed, interaction, ui, onExtensionError })` attaches drawings, indicators, alerts, extensions, datafeed, replay, and optionally interaction/UI; it returns the chart and unwinds every attachment if any step throws.
`chart.extensions` is the integrated extension registry. The extensions entry point exports typed definitions, contexts, instance handles, error events and serialized documents; `importState` returns the created instances. Version 2 extension documents require instrument, interval, source and view identity; import rejects a different context and version 1 documents. Hosts performing a deliberate mapping must transform the document and its anchors before import. Extension code remains trusted host code, not a sandbox.
`SeriesExtensionDefinition`, `DrawingExtensionDefinition` and `IndicatorExtensionDefinition` describe the corresponding configuration and calculation shapes; registrations and instances have separate lifetimes. Unregistering a type disposes its instances and their owned resources. `registerIndicatorType` likewise registers a trusted calculation function and returns its unregister function; neither registration API executes source text.

Replay `step`, `seek`, and `restore` stop timed playback only after all linked views successfully apply the target state. If application fails, the previous state and pending playback timer remain in place.
Replay linked `views` apply silently and defer observer notifications until the session notification; each must roll back its own attempted application. The final `source.apply` is atomic and may notify only after it has applied its complete state; its observers see the matching replay cursor and all earlier linked views.
Replay session dates use the core Gregorian date validation, including leap years; invalid dates are rejected rather than normalized.
Replay source `streams`, when supplied, is an array of stream identifiers; `validateReplayInput` returns `true` after successful validation. The replay entry point publishes event, state, snapshot, simulation, view, and scheduler types.
Bar replay requires the host's complete `source.slots` order; an event's optional slot metadata must match it exactly. Only slots made available by the current event prefix are exposed, including after prepend or backward seek. Observation-only replay does not require slots. Timed play uses explicit host intervals and, unless a scheduler is injected, the platform timers; step and seek need neither.
`chart.replay.create` requires an explicit unique stream-to-series mapping, rejects unmapped bar streams before altering the chart, and initializes the linked chart to the empty prefix. The chart's live feed must be disconnected; replay does not update live alert evaluation, geometry availability, definitions or delivery. `stop` or destruction of the returned session releases the chart for another replay or live feed.
Simulation is explicitly enabled with copied threshold definitions and produces only `simulation: true` results from the available prefix. Missing observations and corrections interrupt continuity; the next value initializes quietly. Results make no claim that the source history is complete and are never sent to live alert authorities or notification adapters.
Replay snapshots use version 3, SHA-256 identities for the full source and configuration, the playback speed and copied simulation definitions. They contain only the current prefix, not future events or slots. Restore requires matching source and configuration, reconstructs simulation from that prefix and resumes paused; version 2 snapshots are rejected.

An alert's authority cannot be changed by a local update; backend-owned alerts require the backend adapter and its confirmation.
The integrated `alertUI` renders selectable constant levels against the explicitly bound visible series or indicator output, using that source's pane and scale. Workspace alert selection and the displayed level share this selection. Removed series or indicators stop affected local alert evaluation; changing indicator parameters blocks alerts tied to the previous parameters until the host reconciles them. Explicit chart IDs scope invalidation in shared engines; unscoped references are conservatively blocked. A level line can be dragged vertically with a mouse or pen (`alertUI.beginDrag`); release commits the price through the engine update and a rejected update is reported as an `error` event with the line returning to its stored price. Default chart hotkeys `f` (follow realtime), `r` (fit content), `l` (linear/log price scale) and `home` (price auto-scale) are rebindable; Shift pins the second point or dragged handle of `segment`/`ray`/`line`/`arrow`/`measure` drawings to the other anchor's price.
Alert observations and snapshot confirmations may identify a stream by `{ instrumentId, interval, sourceId }`. Version continuity and reconciliation are tracked per stream; `requestSnapshot(reason, stream)` identifies the affected stream (`null` for unscoped observations). Once a scoped boundary exists, subsequent observations must name their predecessor. Unscoped observations do not provide per-stream continuity guarantees.

## 15a. Chart UI layout (`createChartUI`)

`createChartUI(chart, { host, layout, parts, interaction, ...state })` builds the optional interface from parts placed in the regions `top`, `start`, `overlay`, `bottom` and `menu` around the chart container. The container must already be a direct child of `host`; it is never moved. Region elements (`data-region`) are inserted next to it, the host carries `data-chart-ui-shell`, `data-layout` (`regular`/`compact`) and `data-theme`, and `destroy()` removes everything it added and restores the previous attributes.

`layout` is a preset name (`'full'`, `'compact'`), an object with region arrays and `without`, or omitted (`DEFAULT_CHART_LAYOUT`, equal to `full`). It is validated as a whole before any DOM is created: unknown regions or parts, a part in a region it cannot occupy, a part placed twice and wrong types raise `InteractionError` (`INVALID_LAYOUT`) with the offending field (for example `layout.top[0]`). A built-in part without an available factory raises `PART_UNAVAILABLE`.

Accessibility invariant: every action must keep at least one way to be invoked without a pointer — a control in a mounted part, a keyboard binding that is still bound, or a context-menu entry (the keyboard-equivalent actions pan, price zoom, bar step and keyboard crosshair are controls of the settings menu only under `accessibleActions`; without it their keyboard bindings are the way to reach them, and `controller.actions()` lists the existing keyboard and menu equivalents). A layout that leaves an action without any is rejected with the list of actions, unless the host removes them on purpose with `layout.without` (control ids, or prefixes ending in `:` such as `tool:`); removed controls stay in the model, disabled with the reason «Снято хостом». The accessible table control is disabled when no `dataTable` part is mounted. `ui.layout.omitted` lists built-in parts that are not in the layout.

A part is a factory `(controller, { document, region, id, host, chartContainer, layout }) => { element, destroy? }` or `{ create, regions?, controls? }`. A host part with the id of a built-in replaces it; `controls` declares which control ids (or `prefix:`) it provides for the coverage check. `ui.replacePart(id, spec)` validates the new layout before changing anything, mounts the replacement in place and destroys the old part. Calls after `destroy()` reject with `UI_DESTROYED`; `destroy()` itself is idempotent and also runs when the chart is destroyed.

Built-in parts and their regions: `topBar` (`top`: title, optional interval select, chart type, indicator, undo/redo), `drawingRail` (`start`: tool icons with a single tab stop, tooltips on hover and focus, clear), `navCluster` (`overlay`: zoom, fit, to last bar, price auto-scale; hidden visually until the shell is hovered or focused, always visible on devices without hover, never removed from the tab order), `settingsMenu` (`menu` or `top`: «Тёмная тема», «Следование последнему бару», «Таблица данных», «Логарифмическая шкала» (active pane primary scale through `interaction.toggleLogScale`; disabled with a reason on a percent scale), «Привязка рисунков» (`interaction.setDrawingSnap` mode `free` ↔ `weak`; the OHLC source stays the interaction default), then dialogs «Панели…», «Настройки рисунков…» and, with a derived view, «Производный вид…»; with the UI option `accessibleActions: true` (boolean, default `false`, anything else is rejected with `INVALID_UI_OPTION`) it also lists the keyboard crosshair toggle and the pan, price zoom and previous/next bar actions, which otherwise stay available only through their keyboard bindings), `statusLine` (`bottom` or `top`: data state, source/time/delay, short `DEMO` label, `role="status"` and `role="alert"` regions) and `dataTable` (`bottom`: accessible table, opt-in through `tableVisible` or the menu). Every control is built from `controller.model()`, so a disabled control keeps its reason as text for assistive technology. Parts need no stylesheet; `vibecharts/ui.css` only arranges them and defines the `--chart-ui-*` tokens.

## 16. Known gaps in 0.1.0

- `attachChartFeatures` can only restore series that already exist; workspace factories must pre-create source and indicator series before `restoreState`.
- `timeScale.slotLabel` is trusted host code called during rendering; it must return a string and must not throw. A thrown formatter error is reported as a chart `error` event and the frame is skipped.
- `whenRendered` confirms canvas draw and module `onRender` completion, not compositor/physical display presentation. Failed frames reject waiters for the attempted revision; zero-sized charts defer drawing until a nonzero resize. Revisions requested during a draw wait for a later frame.
- Derived views render in the core renderer, but their independent scale does not yet have a dedicated axis column; the source pane axis is reused for price labels.
- Crosshair readout series values are only included at an exact slot (`offset === 0`); fractional anchors report geometry without interpolated values.
