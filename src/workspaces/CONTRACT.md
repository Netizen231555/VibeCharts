# Workspaces adapter contract

`createWorkspace(container, { createChart, theme?, onChange?, clusterDistance? })`
never renders market data itself. It calls the injected `createChart(factory)`
and drives each returned chart through the narrow adapter below. The workspace
owns layout, the object tree, templates, comparisons, markers and PNG export;
the chart owns canvas, panes, series, scales, drawings, alerts and rendering.

## Factory

```
createChart(container: HTMLElement, options): Chart
```

`options` are the host's `chartOptions` plus, during `restoreState`, the restored
`{ id, context, chartState, instrument, interval, settings, restore: true }`.
`chartState` is the full snapshot returned by `getState()`, passed before the
workspace calls `restoreState(chartState)` so the factory can stage required
panes/series/indicators without loading data. The factory applies them or
rejects; the workspace never loads data, opens sockets or reads storage.

## Required adapter members

| Member | Contract |
| --- | --- |
| `subscribe(event, handler) → unsubscribe` | Returns an idempotent unsubscribe. Events used: `crosshairMove`, `visibleRangeChange`. Payloads for `crosshairMove` include at least `{ chartId, barId?, offset?, logical?, price? }`; for `visibleRangeChange` include `{ range: { from, to } }` (logical coordinates). Delivery happens after commit. |
| `indexScale()` | Returns `{ barIdToIndex(barId) → index\|null, indexToBarId(index) → barId\|null, slots() → [{ barId, time?, sessionDate? }], getVisibleRange() → {from,to}\|null, setVisibleRange({from,to}) }`. Slots are the host timeline in host order; indexes are current positions and must change on `prepend` while `barId` stays stable. |
| `priceScale(pane?, scaleId?)` | Returns the pane price scale as defined by the core contract. The workspace only requires it to exist; comparison and crosshair price rules are expressed through `getState().instrument` and explicit units. |
| `applyOptions(options)` | Applies options atomically. Theme documents use a chart visual-options patch (`theme`, `layout`, `grid`, `sessions`, `crosshair`, `timeScale`, `priceScale`); cursor fallback uses `{ crosshair: { anchorBarId, offset, price? } \| null }`. Unknown options must be rejected, not partially applied. |
| `setCrosshairAnchor(anchor)` (optional) | Preferred cursor API. Accepts `{ anchorBarId, offset, price? }` including fractional and outside-history positions, or `null` to hide. |
| `setCrosshair(barId, price?)` (optional) | Fallback for adapters without `setCrosshairAnchor`. Only `offset === 0` can be represented; a fractional cursor is hidden and reported unsynchronized as `fractional-cursor-unsupported`. |
| `addIndicator(spec) → handle` | `spec` is `{ id?, type, source, pane, parameters, style }`; source and pane identify an existing series and pane. Returns a handle with a stable `id`; optional `setVisible(boolean)`, `setLocked(boolean)`, `remove()`. |
| `indicators.beginReplacement()` | Required for indicator-template import. Returns `{ commit(), rollback() }`; until commit, mutations and notifications are isolated, and rollback restores the original indicator handles, output series and dependent state even if an operation is vetoed. |
| `drawings` | Namespace: `list() → [{ id, type, paneId, scaleId, anchors, visible, locked, groupId }]`, optional `get(id)` (`get` may throw for an unknown id; the workspace probes with `list()`), `add(drawing)`, `update(id, {visible?, locked?})`, `remove(id)`, `setOrder(ids)` (z-order), optional `exportDocument()/importDocument(document)` — preferred — or `export()/import(document)` using the capability's own versioned document. Imports validate and apply atomically. `list`/`update`/`remove` are required for the object tree; `setOrder` is required for keyboard reordering. Drawings have no `name` property: workspace tree names are workspace labels and never sent to `update`. |
| `alerts` | Namespace: `list() → [{ id, name?, type?, status }]`, optional `select(alertId)`. Editing requires `get(id) → { revision, definition, evaluation }` and `update(id, patch, expectedRevision)`; backend-owned definitions also require `backendUpdate` with the same revision argument. Missing editing operations are reported as unavailable. |
| `exportPng() → Promise<Blob>` | Optional if the adapter exposes a readable canvas. Must resolve `image/png` for the visible canvas including drawings/overlays and never resolve a fake or empty image. |
| `getState()` | Returns a JSON-serializable snapshot. The workspace projects core-style `context.instrumentId`/`context.interval`, `options` (as settings), `modules.indicators` (as indicator rows) and `modules.drawings` when flat `instrument`/`interval`/`indicators`/`drawings` are absent, and also accepts the flat shape. No subscriptions, DOM nodes, functions or secrets. |
| `restoreState(state)` | Validates and atomically applies a snapshot returned by `getState()`. Must not load data. Missing slots leave anchors unresolved; interval rebinding requires an explicit host mapping. |
| `destroy()` | Idempotent; releases subscriptions, frames, observers, pointer capture and DOM handlers, and stops emitting events. |
| DOM canvas access | `chart.canvas`, `chart.element` or a `canvas` descendant of the mount is used only by the PNG fallback. The adapter's `exportPng` takes precedence. |

For markers, `indexScale().indexToCoordinate(index)` is required and returns a
CSS-pixel horizontal coordinate, or `null` when it cannot be resolved. When the
adapter exposes `surface.getVisibleRect()`, the coordinate is relative to that
plot rectangle; otherwise it must already be relative to the chart mount.
Camera, data and resize notifications must be emitted after changes so the
workspace can reposition and regroup markers.

## Optional adapter extensions

- `indicator(id) → handle` — resolve an existing indicator handle after `restoreState`; used by the object tree for visibility/lock/removal.
- `series = { list(), setVisible(id, boolean), remove(id), add?(snapshot) }` — series rows in the object tree. Without it, series rows are not created.
- `derivedScale = { lastCompletedElementFor(barId) → elementId\|null, completionBarFor(elementId) → barId\|null }` — required only for derived-view synchronisation (`mappings[].derived`). Selection returns the last element completed by the source bar; reverse returns that element's completion bar.
- `indicators` handle registry — an equivalent of `indicator(id)` when the host keeps handles in a map.
- `chart.canvas` / `chart.element` — canvas access for the PNG fallback.

## Synchronisation mapping

`createSyncController(workspace, { groups, mappings })` accepts only explicit
host mappings:

```
groups: [{ id, charts: [chartId, ...], range?: true, crosshair?: true, price?: false }]
mappings: [{
  from, to,
  bars?: { [sourceBarId]: targetBarId },
  timestamps?: true,          // exact UTC times, only when unique on both scales
  derived?: true,             // derivedScale on the mapping target
  anchors?: [{ from: {anchorBarId, offset}, to: {anchorBarId, offset} }],
  anchorDelta?: { fromAnchorBarId, toAnchorBarId, delta }
}]
```

Coordinates always travel as `{ anchorBarId, offset }`. A position outside
history requires `anchors`/`anchorDelta`; without it the receiver cursor is
hidden and the group reports `future-unmapped`. Missing/ambiguous bar or time
mappings hide the cursor, keep the receiver range and report the group
unsynchronized. No index or neighbour matching happens. Crosshair price is only
forwarded when the group sets `price: true` and both charts expose the same
instrument currency, price unit, scale mode and `priceScaleId`.

## Workspace-owned state

`getState()` returns `{ kind: 'workspace-state', version: 2, layout, theme,
charts, syncGroups, tree, comparisons, markers, preferences }`; chart settings,
instrument identity, intervals, drawings and visible ranges come from each
adapter's `getState()`/scale. Drawing anchors, tree nodes, comparisons and
markers are stored by identity (`barId` + fractional offset), never by index,
pixels, time or runtime object. `restoreState(state)` validates everything before
staging new charts; on failure the previous workspace is untouched.
Version 1 snapshots used logical viewport indices and are rejected; hosts must
create a new version 2 snapshot. Each viewport endpoint is now a bar identity
and fractional offset. After restore, the workspace announces loading or an
unavailable anchor until both saved identities resolve, then restores the range.
Crosshair coordinates are runtime state and are not restored.
Comparison display rows belong to their chart and are staged or reconnected by
ID before a workspace restore commits. A failed staging operation destroys the
staged charts and leaves the previous workspace intact. Removing a chart or
destroying the workspace destroys its chart-owned display rows.
Comparison display series require the host-supplied `instrument` identity
(`instrumentId`, `interval`, `sourceId`). Absolute series carry provided
`units` and `currency`; normalized percentage series carry `percent` units.
Removing the chosen base slot makes percentage normalization unavailable until
the same slot identity returns; the selected base value is not silently replaced.
An optional `primary: { seriesId, field }` selects a live chart series for a
percentage comparison. `readPrimaryComparison(chart, primary)` reads its current
points by `barId` without mutating them; the selected field must match the series
type. On creation a separate percentage series is added on the comparison scale;
the primary source must have identity metadata. Source data, timeline and base
changes recalculate the display. The source is hidden while comparisons use it;
removing the last one restores its previous visibility, including after restore.
Snapshots contain no comparison price history; after restoring the chart data,
the host supplies comparison points again via `setComparisonData(id, points, mapping?)`.
Mappings may include source bar IDs whose values have not arrived yet; those
targets stay gaps until the host supplies the corresponding points. A removed
primary source is reported unavailable independently of the comparison and can
be restored without discarding the comparison's data.
Percentage comparisons sharing a chart use one explicit base slot; changing it
updates all corresponding display rows atomically. The comparison controls
provide a named base selector, removal action, and unavailable reasons for both
the comparison and its primary source.
`computePrimaryComparison(chart, primary, baseSlot)` returns percentage points
in timeline order, retaining gaps and reporting a missing or zero base as
unavailable; it does not alter the source series.
Marker clustering distance is measured in CSS pixels. Camera, data and resize
events refresh marker positions; keyboard focus follows the same marker, its
cluster, or the closest available marker control when regrouping.

Indicator and drawing templates are validated on detached charts created by the
host factory with `restore: true, validation: true`; it must isolate external
engines and must not load data or access storage. Drawing templates preserve the target's saved drawing styles, favorites
and repeat setting. Preferences and snapshots are stored only by the host:
`savePreferences(write)` invokes the supplied writer and reports failures, but
does not emit an event claiming that storage succeeded.

The object-tree alert editor captures the revision on opening and edits name, hysteresis and any constant comparison levels. It also exposes pause, resume and confirmed deletion; local deletion checks the captured revision before removal. Failed validation associates text errors with the corresponding controls; a stale revision never overwrites a newer definition. Backend changes are shown as successful only after confirmation; an unknown outcome is reported for reconciliation.

## Events (`subscribe`, `onChange`)

`chartAdded`, `chartRemoved`, `layout`, `theme`, `tree`, `alertSelect`,
`markerSelect` (`{ markerId, chartId, barId }`), `markers`, `comparison`,
`syncstate` (`{ groupId, synchronized, reason, chartId }`), `template`
(`{ kind, action, chartId? }`), `preferences`, `error` (`{ action, kind?, field?,
message, chartId? }`), `restore`, `destroy`. Success events are emitted only after
the change is committed; a failed import/save emits `error` and no success.

## Integrating an existing chart implementation

The injected factory is the only integration point, so a host that already owns a
chart class composes a workspace adapter around it instead of changing the
workspace:

1. Project `getState()`/`restoreState(state)` onto the chart's own snapshot and
   add the fields the workspace records (`instrument`, `interval`, `settings`,
   `drawings`, `visibleRange`). Workspace state stores that projection verbatim.
2. Forward `subscribe`, `indexScale`, `priceScale`, `applyOptions`, and
   `destroy` unchanged. Forward `setCrosshairAnchor` when available to retain
   fractional offsets; adapters exposing only `setCrosshair(barId, price)`
   cannot represent them and hide the cursor rather than rounding it.
3. Expose drawings, alerts and indicator handles through the namespaces above.
   The workspace never reads chart internals; missing methods surface as
   `chart-adapter`/`adapter-unsupported` errors instead of silently degrading.
4. `createWorkspace` requires an `alerts` object even when the host has no alert
   UI yet: `{ list: () => [], select: () => {} }` is enough. The same applies to
   `addIndicator`, `restoreState` and a canvas/`exportPng` for charts without
   those capabilities; the adapter must fail explicitly rather than omit them.

### Drawings document template

A drawings template is:

```
{ kind: 'drawings', version: 1, chartId, document: <exportDocument()> }
```

The workspace validates every drawing id, anchor, group reference and `order`
entry before applying, then calls `importDocument(document)` (or the
legacy-shaped `import(document)` when that is the only method). On failure it
re-imports the previous `exportDocument()` and reports an error. `schemaVersion`,
`format` and `context` validation stays with the drawing capability.

### Drawing groups and z-order (integration boundary)

The workspace object tree owns group nesting, visibility, locks and undo for its
own nodes. To make those operations affect drawings drawn on the canvas, the
adapter must project them onto the drawing capability. The exact additional
methods needed are:

```
listGroups() -> [{ id, name, parentId, visible, locked }]
createGroup({ name, parentId }) -> { id, ... }
renameGroup(id, name)
setGroupParent(groupId, parentId | null)
addToGroup(groupId, drawingIds)
removeFromGroup(drawingIds)
setVisibility(targetId, visible)      // drawing or group id
setLocked(targetId, locked)           // drawing or group id
removeGroup(id, { confirm: true })
setOrder(ids)                         // bottom -> top, same order as list()
```

`createDrawingStore` now provides all of these. Native projection activates
automatically when `drawings.listGroups` is a function: group nodes, membership,
visibility, locks and z-order are read from and written to the store. Tree row
order follows the capability's `list()` order (index 0 bottom, last top), so
`setOrder(ids)` receives the filtered drawing-node order directly with no
reversal. Workspace tree undo snapshots the capability document
(`export()`/`exportDocument()`) before each native mutation and restores it on
undo.
