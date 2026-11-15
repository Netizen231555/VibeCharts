# Interaction layer integration contract

`src/interaction/**` and `src/ui/**` consume the public chart
API from the core and drawings modules and the additional hooks below. No core
internals are imported. A missing required hook makes `attachInteraction()`
throw `InteractionError` with code `MISSING_CHART_HOOK` and the exact field
name; there is no silent fallback for input routing. Two deliberate
accommodations keep mounting robust: the drawings module is optional, and an
index-axis rectangle is derived when the layout leaves `indexAxis` null.

## Documented API already used

- `chart.timeline` (`setTimeline`, `append`, `prepend`, `removeHistoryBefore`)
- `chart.indexScale()`: `coordinateToIndex`, `indexToBarId`, `barIdToIndex`,
  `indexToCoordinate`, `barIdToCoordinate`, `coordinateToLogical`,
  `logicalToCoordinate`, `getVisibleRange`, `setVisibleRange`, `fitContent`,
  `scrollToRealTime`
- `chart.priceScale(paneId, scaleId)`: `priceToCoordinate`,
  `coordinateToPrice`, `getVisibleRange`, `setVisibleRange`, `setAutoScale`
- `chart.subscribe(event, handler)` for `datachange`, `visibleRangeChange`,
  `destroy`
- `chart.drawings.list()` / `chart.drawings.get(id)` — when the drawings module
is not attached the interaction layer still mounts and simply has no drawing
targets; a store attached later is picked up on the next pointer query.


The adapter resolves the horizontal scale per pane, never globally:
`chart._paneXContext(paneId)` yields `{ kind: 'source' | 'derived' | 'conflict', view, scale }`
(see `docs/contract.md`, "X axis per pane"). `adapter.indexScaleFor(paneId)`,
`slotsFor(paneId)`, `paneKind(paneId)`, `sourceBarId(paneId, id)` and
`derivedElementId(paneId, id)` serve navigation, crosshair, hit testing and
drawings; a `null` pane id selects the source scale. Wheel, drag, keyboard,
fit, reset and follow act on the pane under the pointer or focus; `source` panes
share the main scale and `derived` panes scroll independently (follow-realtime
is never enabled for them). In a `derived` pane the crosshair carries the
element id internally, publishes `barId` of the completion bar plus
`derivedElementId`, and shows no time. Hidden series are omitted from value lists.

Crosshair positions are translated from container coordinates to the pane-local scales. Pointer, keyboard and stationary-data refreshes are published through the interaction controller and, when present, `chart.surface.emit('crosshairMove', ...)`; the chart event omits time and session date when unavailable. The interaction locale/time-zone options override the current chart surface settings. Outside supplied history the axis time plate is hidden: timestamps cannot be inferred from index spacing or an exchange calendar. The event retains its full-precision logical offset.

## Hooks beyond the written core/drawings specs (required by this layer)

The current `core` implementation provides these; the adapter validates each
one at attach time.

1. `chart.container: HTMLElement`
   The element passed to `createChart`. The interaction layer appends its
   overlay, live regions and context menu to it and restores the previous
   `position` style on detach.

2. `chart.getInteractionLayout(): Layout`
   Requested synchronously on every pointer/wheel/layout query. Geometry is in
   CSS pixels relative to `chart.container` content box, already adjusted for
   container scroll and canvas offset:
   ```ts
   type Rect = { x: number; y: number; width: number; height: number };
   type Layout = {
     width: number;
     height: number;
     devicePixelRatio: number;
     rect?: Rect;                       // default: {0,0,width,height}
     panes: Array<{
       id: string;
       plot: Rect;                      // data area, excludes axes
       priceScales: Array<{ id: string; side: 'left' | 'right'; rect: Rect; inverted?: boolean }>;
       indexAxis: Rect | null;
       visible?: boolean;               // default true
       height?: number;                 // default plot.height
       minHeight?: number;              // default 0 (finite, layout-defined)
       order?: number;                  // default array position
     }>;
   };
   ```
   Pane ids must be unique and non-empty. Invalid layout throws
   `INVALID_LAYOUT` with the offending field. If the last visible pane has
   `indexAxis: null`, the adapter derives a horizontal axis rectangle from
   `layout.height - sum(visible plot heights)` at the bottom of that pane, so
   index-axis drag/double-click keeps working with the renderer geometry.

3. `chart.getPanes(): PaneState[]`
   ```ts
   type PaneState = { id: string; order: number; height: number; minHeight: number; visible: boolean };
   ```
   Ids must match `getInteractionLayout()` panes. Used to seed the pane layout
   state machine; the shared index scale and series identity are never touched.
   A `height` of `null`, `0` or a missing `minHeight` before the first layout is
   tolerated: the visible pane height comes from `getInteractionLayout()`, and
   a finite placeholder of 1 is used for panes the layout does not contain.

4. `chart.applyPaneLayout(panes: PaneState[]): void`
   Atomically applies committed order/height/visibility. Called after a pane
   gesture commits or a keyboard action changes a pane. Invalid input must
   reject without changing the chart; the interaction layer reports the error
   through its `error` event and does not claim success.

5. `chart.getSeriesValues(barId: string | null): SeriesValues[]`
   ```ts
   type SeriesValues = {
     seriesId: string;
     paneId: string;
     type: string;                    // 'candlestick' | 'bar' | 'line' | ...
     values: { open: number; high: number; low: number; close: number; volume?: number | null }
           | { value: number } | null;
   };
   ```
   Must list every series in the chart. For a slot without a point, `values`
   is `null`. `barId === null` lists all series with `values: null`; when the
   core returns an empty array for `null`, the adapter synthesizes one absent
   entry per `getPanes()[].seriesIds` so outside-history absence stays explicit.
   Values are raw numbers: a missing volume is `null`/absent, never `0`.

6. `chart.timeline.listSlots(): Array<{ barId: string; time?: number; sessionDate?: {year:number;month:number;day:number} }>`
   Host order, current indices. `time` is Unix milliseconds UTC and only when
   the host provided it; no synthesized timestamps.

7. `chart.indexScale().isFollowingRealTime(): boolean`
   `chart.indexScale().setFollowRealTime(enabled: boolean): void`
   Follow starts enabled. Any manual horizontal move calls
   `setFollowRealTime(false)`; `scrollToRealTime()` re-enables it.

8. `chart.priceScale(paneId, scaleId).isAutoScale(): boolean`
   Needed to distinguish auto from a manual range. `setAutoScale(false)` on a
   manual Y gesture and `true` on explicit reset remain the documented calls.

9. Optional: `chart.setPriceScaleOptions(paneId, scaleId, { side?, inverted? }): void`
   Applies a price scale side or inversion atomically. When absent, the menu
   uses `priceScale(paneId, scaleId).setSide(...)` / `setInverted(...)` when the
   scale exposes them; with neither, those items are omitted from the menu.

## Drawing snapshot shape required by hit-testing

`chart.drawings.list()` returns every drawing (including hidden ones) as:
```ts
{
  id: string;
  type: string;                       // segment, ray, line, horizontalLevel,
                                      // horizontalRay, verticalLine, rectangle,
                                      // ellipse, fibRetracement, fibExtension,
                                      // fibFan, fibArcs, polyline,
                                      // bezier, brush, marker, arrow, measure,
                                      // angle, triangle, text,
                                      // priceLabel, callout, flag, anchoredVwap
  paneId: string;
  scaleId: string;
  order: number;                      // higher paints on top
  visible: boolean;
  locked: boolean;
  anchors: Array<{ anchorBarId: string; offset: number; price?: number }>;
  properties?: { levels?: number[] };
}
```
`get(id)` returns `null` for a removed id. Anchors that do not resolve (unknown
`barId`) make the drawing non-interactive; geometry is clipped to the pane plot
rect. Anchors on a derived (Renko/Kagi/P&F) sequence carry that element's stable
id in `anchorBarId`, exactly like source-bar anchors, and are resolved by the
chart's own index scale.

## Host-supplied options (not chart hooks)

- `options.container` — override for tests/embeds; defaults to `chart.container`.
- `options.hitRadius` — finite ≥ 4 CSS px, default 4; `handleRadius` ≥ 4.
- `options.initialBarSpacing` — finite > 0; overrides the index-axis reset step.
  Otherwise the initial chart scale's `barSpacing` is captured when interaction is attached; an adapter that supplies neither reports `no-initial-step`.
- `options.wheel = { enabled, invert, factor > 1, minBarSpacing > 0, maxBarSpacing > 0 }`; `factor` defaults to `1.15`. `enabled: false` leaves wheel events to the page. `altWheelPrice: false` similarly leaves Alt+wheel unhandled.
- Wheel zoom scales with the wheel delta: 100 CSS pixels produce one `wheel.factor` step, smaller deltas produce proportionally smaller exponential changes, and a single event is capped at one step. DOM line and page deltas are converted to pixels. The same rule applies to Alt+wheel price zoom.
- `options.keyboard = { panFraction, zoomFactor, priceZoomFactor }`
- `options.bindings` and `interaction.keyboard.setBindings(overrides)` replace the override set atomically against the defaults; use `null` to unbind an action. Unknown actions, duplicate chords, Tab, Space, Backspace, browser-navigation keys, Ctrl/Alt/Meta chords and F1–F12 are rejected. ContextMenu and Shift+F10 are reserved for `contextMenu`; a collision reports the conflicting action. Default screen-reader instructions follow successful changes; hosts supplying `options.instructions` own that text. Shortcuts act only on the focused chart and not from editable or interactive descendants. Toolbar buttons provide independent pan, zoom, price zoom and previous/next bar actions.
- Default rebindable chords (`DEFAULT_BINDINGS`): `home` `priceAuto` (auto-scale of the active pane's price scale; there is one chord per action and no alias mechanism, so Home is the only auto-scale key), `f` `follow` (toggles follow-realtime of the active pane: on scrolls to the latest bar and follows, off stops following; on a derived pane nothing changes and the live region reports that following is unavailable there), `r` `fitContent` (fits the active pane's x range), `l` `toggleLogScale` (toggles the primary price scale of the active pane between `linear` and `log` through `priceScale.setMode`; a `percent` scale is left unchanged and announced; a rejected switch such as non-positive data is reported through the `error` event and the error region, and the mode stays unchanged). Results are announced in the live region. All of them are ignored in editable targets and with Ctrl/Alt/Meta. `viewChange` is emitted with reason `follow`, `fit-content` or `price-mode`.
- `options.touch = false` — do not set `touch-action`, do not capture or
  preventDefault touch pointers; the page keeps scrolling and zooming.
  Accepted touch contacts are captured individually; cancellation or lost capture ends the whole touch gesture and releases every captured contact. Touch hit-testing gives armed tools, drawings and axes priority over plot panning; touches starting outside the plot or an interactive target are left to the page.
- `options.tool` / `interaction.setTool(tool)` — drawing-tool owner with
  `{ id, active, begin(point), move(point), end(point), cancel(reason) }`.
  `begin(point)` is called exactly once with the accepted pointer-down point
  (CSS px relative to the container) so a two-point drag and its preview have
  the start point immediately; returning `false` or `{ accepted: false }`
  declines the gesture and nothing is captured. An armed tool owns the gesture
  before hit-testing, so dragging through an axis does not zoom or pan.
  `cancel(reason)` is also called for Escape when no pointer capture is active,
  which cancels a multi-click construction between clicks. A tool that is
  waiting between clicks must expose `pending: true` (or `isPending()`);
  otherwise Escape with nothing in flight is left unprevented for the host page
  or dialog to handle.
  The `meta` argument of `move(point, meta)` / `end(point, meta)` is `{ shiftKey, altKey, ctrlKey, metaKey }` of the pointer event.
  Hold-a-modifier snapping: `setDrawingSnap({ modifier })` takes `'alt'`, `'ctrl'`, `'meta'`, a list of them (any listed key counts) or `null`; the default is `['alt', 'meta']` (Option or Cmd on a Mac). `'shift'` is rejected (error with `field: 'modifier'`) because Shift is the horizontal constraint. While a modifier is held at tool move/end and at handle-drag move/release the effective snap is `{ ...drawingSnap, mode: 'strong', magnet: true }` regardless of the persistent mode; otherwise `drawingSnap` applies unchanged. `drawingTool.effectiveSnap` is the single place that computes it. Without `sourceId` the source is the first visible candlestick, bar, line or area series of the pane (and price scale); line and area snap to their `value`; if there is none the announce path reports `snap-unavailable`. The crosshair itself is drawn at `drawingTool.snapCursor(...)` (the nearest bar and its nearest price candidate) whenever snapping is effective, with or without an armed tool, and is redrawn when a modifier is pressed or released with a still pointer. While a tool is armed or a pointer gesture is active and a modifier is held, `contextmenu` and `wheel` are `preventDefault`ed and ignored (no context menu, no Alt-wheel price zoom). On macOS Ctrl+click is a context-menu gesture and some browsers deliver it as a secondary-button pointerdown that the chart ignores, so Ctrl is not recommended there.
  Built-in two-point tools `segment`, `ray`, `line`, `arrow` and `measure` pin the second point to the first anchor's price while Shift is held (for a drag and for a click-click construction); other tools ignore Shift. The same holds for dragging an anchor handle of those drawing types: the dragged anchor takes the other anchor's price while Shift is held at the move or release event.
- `options.drawingController.begin({ drawingId, anchorIndex, locked, point })`
  — optional object-drag owner returning
  `{ move(point), commit(point), cancel(reason) }`. Without it an object drag
  selects and commits without geometry changes; locked drawings never receive
  a controller.
  `drawingController` owners receive `{ event }` as the second argument of `move` / `commit`.
- `options.metadata` — `{ priceUnit, volumeUnit }` for accessible values, only
  when explicitly provided by the host.
- Alert level lines (`chart.alertUI.hitTest`) are draggable with a mouse or pen: pointer down on a line selects the alert and starts a vertical drag (`chart.alertUI.beginDrag(id)` returns `{ move(point), commit(point), cancel() }`, or `null` when the line is not a constant-threshold level). A preview line follows the pointer; only a release after a real move commits the new price through `alertUI.edit` → `engine.update(id, { <constant side>: { ...source, value } }, revision)`. A rejected update (stale revision, backend-authority alert, invalid value) is reported through the `error` event and the error region, the preview is dropped and the line stays at the stored price. Escape, pointer cancel or lost capture cancels without touching the engine. A click without movement only selects. Touch keeps tap-to-select; a touch drag pans the chart.
- `options.locale`, `options.timeZone` — formatting for time labels and the
  accessible table; without `timeZone` labels are UTC and say `UTC`.
- Interface language: every user-visible string (instructions, aria-labels, menu labels, announcements, readout field names, errors) follows `options.locale ?? chart.locale` — any `ru` locale selects Russian, otherwise English — via `src/interaction/messages.js`; a missing key throws. The former constants are functions: `DEFAULT_INSTRUCTIONS` → `defaultInstructions(locale)`, `ABSENT` / `ABSENT_TEXT` → `absentText(locale)`, `keyboard.labels` → `keyboard.labels(locale)`, `actionLabel(action, locale)`. `createStatusModel`, `createDerivedViewAccessibility`, `createPaneLayout`, `createDrawingTool` accept `locale` (a string, or a function resolved at use time); `buildMenuItems`, `createContextMenu`, `buildReadout`, `buildTableModel` accept a string `locale`.

## Interaction-owned DOM

`attachInteraction` sets `tabindex="0"`, `role="group"` (when absent),
`aria-label`, `aria-describedby` (instructions) and `data-focus-visible` on the
container, appends an absolutely positioned overlay with crosshair lines and
labels, a readout (`aria-live="off"`), one `role="status"` region, one
`role="alert"` region, and restores the container style and removes its nodes
on detach/destroy. It never uses `innerHTML`; every external string is assigned
as text.

The visual crosshair readout shows the supplied instrument and interval plus
selected-series values, with OHLC captions or a numeric value caption. It omits
an unavailable optional volume and does not display slot IDs, timestamps or
session dates there. The crosshair time and price are displayed on their axes;
the accessible table retains slot IDs, time and trading date.

## Context menu

`buildMenuItems({ target, capabilities })` returns only the actions that can act on the target kind (`plot`/`drawing`: fit, return to last bar, price auto-scale; `priceAxis`: auto-scale, the opposite price-scale side, inversion, log toggle on the primary non-percent scale; `indexAxis` and `chart`: fit, return to last bar), plus hide/move-up/move-down of the pane while more than one pane is visible (move-up is omitted on the first pane, move-down on the last). Items carry no `enabled`/`reason`; checkable ones (`invertPriceScale`, `toggleLogScale`) carry `checked`. An empty list opens no menu: `menu.open()` returns `{ opened: false, reason: 'no-items' }`, and the keyboard `contextMenu` action announces the localized `menu.noActions` message through the live region. `interaction.toggleLogScale(paneId?)` / `getPriceScaleMode(paneId?)` give the UI the same primary-scale toggle as the `toggleLogScale` binding.

## Events

`interaction.subscribe(event, handler)` supports `crosshairMove`,
`crosshairSelection`, `selectionChange`, `commit`, `cancel`, `contextMenu`,
`menuRefused` (a menu item whose action is not wired), `menuClosed`, `viewChange`, `panesChange`, `announce`, `error`.
Commit events are emitted only after the gesture owner reports success;
cancellation emits `cancel` and never `commit`.
