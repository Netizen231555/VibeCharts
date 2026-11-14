# Local alert extension contract

This directory is a pure, deterministic ESM module. It has no DOM access, no
timers, no storage, no network, and no `eval`. Values cross the boundary as
plain JSON-compatible data. The host owns persistence, transport, rendering,
and the bar/indicator caches.

The only repository dependency is `ChartError` from
`src/errors.js`. Alert-specific failures extend it as
`AlertError` (`code`, actionable `message`, frozen `fields: [{path, message}]`)
and are exported from `src/alerts/errors.js`.

## Engine

```js
const engine = createAlertEngine({
  clock,             // optional () => epochMilliseconds; trusted only if finite
  notify,            // optional (event) => delivery
  authority,         // default authority when a definition omits it ('local')
  requestSnapshot,   // optional (reason, stream | null) => void; host supplies reconciliation
  createRequestId,   // optional (operation, alertId) => globally unique mutation ID
  simulation,        // true means evaluate locally without notify()
  resolveSource,     // optional (source) => {available, units?} | false
  resolveBarIndex,   // optional (barId, chartId?) => absolute numeric index | null
  unitsCompatible    // optional (leftUnits, rightUnits) => boolean
});
```

`resolveSource` is validation-only. It never supplies numeric values.
`resolveBarIndex` must use the named chart's own timeline; there is no fallback
to an array index inferred from an observation and no matching by timestamp.
On a confirmed gap, conflict or version-chain break, the engine requests a
snapshot once per unresolved stream interruption via
`requestSnapshot('gap' | 'version-gap', stream | null)`. The second argument
identifies the affected stream. A conflict uses `version-gap` for the request
and reports `version-conflict` on affected alerts. Callback errors propagate;
the unresolved state remains in place.

Public methods (all state-changing methods validate before committing):

| Method | Result |
| --- | --- |
| `add(definition)` | immutable definition view, revision 1 |
| `get(id)` / `list()` | immutable views; `get` throws `ALERT_NOT_FOUND` |
| `update(id, patch, expectedRevision)` | new revision; conflict rejects before mutation |
| `prepareUpdates([{id, patch, expectedRevision}])` | validates a local batch and returns a single-use `commit()`; every revision is rechecked before any change |
| `pause(id, expectedRevision)` / `resume(id, expectedRevision)` | paused/active view, continuity reset |
| `remove(id)` | `{removed: true, alertId}`; retained for `events()`/`getRetired()` |
| `subscribe(listener)` | idempotent unsubscribe function |
| `observe(observation)` | `{evaluated, skipped, eventIds}` |
| `confirmSnapshot(snapshot)` | session view; validates snapshot values before resetting local continuity at a new boundary |
| `disconnectStream(stream)` | marks only the named scoped stream inconsistent until `confirmSnapshot` |
| `disconnect(reason?)` / `reconnect()` / `stopSession()` / `startSession()` | session view |
| `setSimulation(boolean)` | simulation flag |
| `markSourceRemoved(ref, reason?)` / `markSourceAvailable(ref)` / `setSourceAvailable(ref, available, reason?)` | blocked-source count |
| `exportDefinitions()` / `importDefinitions(document)` | versioned document / `{imported}` |
| `setBackendAdapter(adapter \| null)` | `{attached}` |
| `backendCreate/Update/Pause/Resume/Delete(...)` | adapter outcome (`confirmed` or `unknown`) or throws |
| `backendRead(id)` | `confirmed`, `error`, or `unknown` |
| `getBackendState()` / `getSession()` / `getDiagnostics()` | read-only status snapshots |
| `getPendingBackendDefinitions()` | immutable definitions for uncertain creates and in-flight mutations |

A failed operation emits no success or state event. All validation problems and
revision conflicts are thrown before mutation. `update`, `pause`, `resume`, and
`remove` operate only on local revisions; backend revisions must go through the
adapter methods below.
The chart integration marks local sources unavailable when their series or indicator is explicitly removed. Destroying a chart does not invalidate sources in a host-owned shared engine: the host must mark a source unavailable when its actual feed or computation ends. Indicator parameter changes invalidate alerts referencing the old parameters, without blocking alerts for different parameters. An explicit `chartId` on a removal reference scopes matching to that chart while still conservatively matching source definitions without a `chartId`. Reinstatement after removal requires an explicit host availability decision. Indicator computation errors temporarily block dependent local alerts and clear automatically after successful recalculation; other outstanding source blocks remain in force.
When a chart using a shared engine reports a datafeed interruption, only its
scoped stream is interrupted; the host must reconcile that stream independently.
Drawing source availability references match `drawingId` when supplied; omitting it intentionally matches all drawings of the specified type and scope.
When a referenced local drawing moves, its alert definition is revised
atomically with the drawing and reinitializes quietly. Deletion marks the source
unavailable; restoring the same drawing identity and geometry clears that block.
`setGeometryResolved(id, boolean)` reports host-confirmed drawing-anchor availability for a local alert. Losing an anchor pauses evaluation and resets continuity; restoring it permits fresh initialization without a historical event. A user pause remains in force. Integrated chart history previews include affected local drawing alerts; backend alert state remains independent.
`evaluation.sourceError` remains visible independently of the primary status, including while an alert is paused; the workspace presents both without silently resuming it.

All injected callbacks (`clock`, `notify`, `resolveSource`, `resolveBarIndex`,
`unitsCompatible`, and every adapter method) are synchronous. The engine never
awaits a promise; an async adapter result is treated as an untyped/unknown
outcome.

## Definition

Normalized, deeply frozen shape:

```js
{
  id, revision, name,             // name: string | null
  left, right,                    // source, see below
  operation,                      // 'above' | 'below' | 'crossUp' | 'crossDown'
  mode,                           // 'once' | 'repeating'
  hysteresis,                     // finite number >= 0, default 0
  observationMode,                // 'closed' | 'partial', default 'closed'
  authority,                      // 'local' | 'backend'
  expiresAt,                      // finite epoch ms | null
  mapping                        // null | {kind: 'host', id: string}
}
```

Exactly one authority is stored per revision. Backend revisions evaluate only
from confirmed backend events. Local revisions evaluate only while the session
is alive, consolidated, and the trusted clock permits. Unknown backend
confirmation is represented as status `unknown`, never as active.

A `mapping` is mandatory when the two sources carry different `chartId` values.
The host owns the meaning of `mapping.id`; it is an explicit cross-interval
mapping, not an inferred timestamp/index match.

### Source

```js
{kind:'series', seriesId, field, units?, chartId?}
// field: open | high | low | close | volume | value

{kind:'indicator', indicatorId, formula, params, output, semanticVersion, units?, chartId?}
// params: JSON object; output is the named output, not a display label

{kind:'constant', value, units?}

{kind:'drawing', drawingId?, drawingType:'horizontal', price, units?, chartId?}
{kind:'drawing', drawingId?, drawingType:'segment'|'ray', scale:'linear'|'log',
 points:[{anchorBarId, offset, price}, {anchorBarId, offset, price}], units?, chartId?}
```

Backend drawing sources require `drawingId`, identifying the actual drawing.
The drawing store must receive the same alert engine as `alertEngine`. For a
shared engine, hosts should supply stable `drawingChartId` and the same
`chartId` on drawing sources; without an explicit chart ID, matching drawing
IDs are conservatively treated as dependencies. A standalone store without an
engine has no knowledge of backend alerts.

The store requests updates or pauses before publishing a geometry change or
deletion, including transaction steps, cancellation, history and import. Each
dependent alert is confirmed independently; a later rejection can leave earlier
alerts at their confirmed new revisions while the drawing stays at its previous
geometry. The integrated renderer shows each confirmed active geometry with an
alert label, drawing divergent geometry with a dashed stroke. The thrown drawing
error identifies the failing alert. Unknown outcomes require `backendRead`
before another explicit attempt; no mutation is retried automatically. An
unknown reassignment protects both the previously confirmed drawing and the
proposed drawing until reconciliation. An import or history operation can fail
without publishing its proposed drawings. Chart binding changes of a referenced
drawing are rejected because a new binding cannot be inferred safely.
The chart also exposes active alert IDs, confirmed revisions, synchronization
status and anchor coordinates in a polite text status region for non-visual access.

Drawing x-position is `index(anchorBarId) + offset`; it is absolute chart
position, not a bar count guessed from the observation. Segment thresholds
require `0 <= t <= 1`; ray thresholds require `t >= 0`. Thresholds are:

```txt
linear: p0 + t * (p1 - p0)
log:    exp(log(p0) + t * (log(p1) - log(p0)))
```

Log anchors and observed values must be strictly positive. Coincident anchors
after host mapping, non-finite positions, and non-positive log thresholds are
geometry errors. Unresolved anchors pause the alert. Out-of-range or future
areas skip evaluation and reset continuity; no synthetic bar, time, or price is
created.
Inclined geometry always resolves the observed `barId` through the host's
timeline; a supplied index that disagrees with that identity is rejected.
When both anchor IDs are currently resolvable, creation and revision changes
reject coincident or non-finite resolved positions before committing.

Use `sourceKey(source)` to construct observation value-map keys; do not build
them manually. Dynamic source keys include `chartId` when provided, and indicator
keys also include formula, parameters, output and semantic version. This avoids
collisions between identically named sources on independent charts or revisions.

At least one side must be dynamic (series, indicator, or inclined drawing).

## Observation

```js
{
  stream?,                 // {instrumentId, interval, sourceId}: host stream identity
  version,                 // required opaque identity
  prevVersion?,            // optional predecessor for chain checking
  barId?,                  // optional; if present, state is required
  state?,                  // 'closed' | 'partial'
  time?,                   // safe integer epoch ms, optional
  index?,                  // finite absolute position, optional
  values?,                 // sourceKey -> finite number | null
  error?,                  // {message, sourceKey?}; exclusive with values
  correct?, gap?, snapshot? // optional booleans
}
```

`closed` mode evaluates only an explicit `state: 'closed'` observation. A
`partial` update advances the version chain but does not evaluate in `closed`
mode. In `partial` mode each accepted ordered update evaluates.

A missing value (`null` or absent key for a dynamic side), an unresolved
anchor, or an out-of-area drawing resets rearm/previous continuity, so the next
available value only initializes. A reported observation error is distinct from
a missing value and sets status `error`.
An accepted bar observation with no source values resets previously associated
local rules for that stream. Rules not yet associated are quietly initialized
when they next receive values on that stream. For a source-specific missing
value amid unrelated updates, the host includes that source key with `null`;
unrelated source keys do not imply a missing value.

Without `barId`, the observation may compare a dynamic value with a constant or
horizontal level. Two dynamic sides, or an inclined drawing, require `barId`.

Versions are opaque and checked once for the complete stream, before any
alert is evaluated. A stream is scoped by the host-provided instrument,
interval and source; unrelated values in the same chain still advance its
boundary. A scoped stream requires a confirmed snapshot boundary before its
first observation, and each subsequent observation must name the preceding
version. A repeated version with identical canonical content is
ignored, including after intervening versions; conflicting content reports
`version-conflict` and requires reconciliation. A mismatched or missing
predecessor makes the affected stream inconsistent (`version-gap`), requests
one snapshot, and emits no alert event. `confirmSnapshot({stream, version,
values?, ...})` validates the entire snapshot before replacing that stream's
boundary; affected alerts initialize quietly. Independently scoped streams do
not share version identities. Inputs without `stream` remain unscoped and
cannot claim the guaranteed stream contract; missing predecessor metadata
cannot prove completeness. `correct: true` starts a new evaluation continuity
boundary and never emits or retracts historical events.

## Evaluation

`d = left - right` using JavaScript numbers. Non-finite inputs are rejected at
validation; infinite subtraction is a runtime error (`non-finite-result`) with
no event.

- True side: `above`/`crossUp` require strictly `d > 0`; `below`/`crossDown`
  require strictly `d < 0`. Equality is never a true side.
- `above`/`below` fire on their first reliable observation if already on the
  true side.
- `crossUp` initializes armed when `d <= 0`; `crossDown` initializes armed when
  `d >= 0`. Neither fires during initialization.
- After a fire, `above`/`crossUp` rearm when `d <= -h`; `below`/`crossDown`
  rearm when `d >= h`. A fire then requires a strict true-side crossing.
- First observation after definition change, resume, reconnect, gap,
  correction, missing data, or a confirmed snapshot only initializes (quiet
  initialization suppresses an immediate event for `above`/`below`).
- `once` marks the revision completed atomically before delivery. Delivery
  failure never rearms or repeats it.
- Simulation mode marks events `simulated: true` and never calls `notify`.

For a backend `once` revision, the first confirmed event completes that revision
even if delivery fails. A second distinct event or a status attempting to
reactivate the same completed revision is reported as a backend error.

## Events

```js
{
  eventId, alertId, revision, authority:'local', operation, observationMode,
  observationVersion, stream?, transition, left, right, d,
  sources: {left: sourceKey, right: sourceKey},
  simulated, delivery: {status, error},
  barId?, state?, time?       // present only when supplied by the observation
}
```

`eventId` is derived from alert id, revision, stream identity when provided,
observation version, and transition. Re-delivery of the same version/state is
deduplicated; matching identity with different content is an error. Local and backend authorities
never both emit a real event for one revision.

`notify` receives the event and may return:

```js
{status: 'pending' | 'delivered' | 'failed' | 'unknown', error?}
```

An absent, throwing, or unrecognized `notify` result is recorded as
`unavailable`, `failed`, or `unknown`; it never simulates delivery.

## Backend adapter

The host injects transport. The engine performs no network access and never
retries an unknown mutation automatically.

```js
adapter.create(definition, requestId)
adapter.read(alertId)
adapter.update(alertId, definition, expectedRevision, requestId)
adapter.pause(alertId, expectedRevision, requestId)
adapter.resume(alertId, expectedRevision, requestId)
adapter.delete(alertId, expectedRevision, requestId)
adapter.subscribe(listener) -> idempotent unsubscribe
```

An adapter MUST report `adapter.idempotency = {supported, scope}` where
`supported` is a boolean and `scope` is a non-empty string. This is validated and
exposed through `getBackendState().idempotency`; unknown mutations are never
automatically retried regardless of the declared support.
By default mutation IDs use `crypto.randomUUID()`. If secure UUID generation is
unavailable, the host must provide `createRequestId`; duplicate IDs from that
callback are rejected before contacting the adapter.

When a repeated backend event changes delivery status, the engine retains one
event and emits `alert-delivery` with its alert, revision, event ID and new
delivery status so subscribers can update the displayed delivery state.

Mutation results:

```js
{outcome:'confirmed', alertId, revision, status, definition?, confirmation?}
{outcome:'rejected', error:{message, fields?:[{path,message}]}}
{outcome:'conflict', currentRevision?}
{outcome:'unknown', error?, requestId?}
```

`read` returns the confirmed shape or `{outcome:'error', error}`. Accepted
status values are `active`, `paused`, `completed`, `expired`, `error`,
`unknown`. A create or update confirmation must identify the requested revision
and definition. A mismatching or invalid confirmation leaves the previous
definition intact and the outcome unknown. Pause/resume may confirm the same
revision, but pause succeeds only with status `paused` and unchanged definition.
Delete confirmations must identify the alert and a revision no older than the
one requested; otherwise the alert remains present with an unknown outcome.
Unknown results are not retried, and further mutations require a confirmed `backendRead`.
An uncertain creation, including an invalid confirmation, reserves its alert ID
until a confirmed `backendRead` reconciles it; another create for that ID is rejected.
Confirmed reads must identify the requested alert and cannot go backwards or
change its definition at the same revision; invalid reads cannot clear an
unresolved mutation.
Status-only messages for a different or unresolved revision cannot confirm a
definition; a confirmed read is required before the new state is trusted.

For an indicator alert, a confirmed revision is active only when the result
includes matching confirmation of formula, params, named output, and semantic
version for that revision:

```js
{
  confirmation: {
    indicators: [
      {formula, params, output, semanticVersion}  // one per indicator source
    ]
  }
}
```

A missing or mismatched confirmation keeps the revision non-active (`error`
status with an actionable reason), even if the adapter reports a status.
Matching the indicator name alone is never enough.

Subscription messages:

```js
{type:'event', event:{eventId, alertId, revision, operation, observationMode, observationVersion,
                      sources:{left, right}, left, right, d, barId?, time?, delivery?}}
{type:'status', alertId, revision, status}
{type:'error', error}
```

Backend events are accepted only for a backend-owned alert at its confirmed
revision, with matching source keys and rule, finite consistent values and a
strictly true comparison side. Duplicate `eventId`s dedupe; contradictory content is an error.
Delivery state is stored separately from event existence. Backend status
messages cannot activate an unconfirmed indicator revision.

## Definitions document

```js
{
  schemaVersion: 1,
  definitions: [/* full normalized definitions */]
}
```

`importDefinitions` validates schema version, field validity, unique ids,
source resolution, and unit compatibility for the complete document, then
replaces the set atomically. On any error the previous alerts are unchanged.
Imported local definitions require activation; imported backend definitions
remain unconfirmed. Events are not replayed and external engine state is never
claimed from a definition snapshot.

## UI model (`ui.js`)

`createAlertListModel({engine, selectedId?, scale?, labels?, onError?})` is a rendering
adapter, not a second engine. It exposes a frozen semantic list:

- `name`, rule, mode, observation mode, authority, status/reason, delivery
- left/right source descriptions
- actions `edit`, `pause`/`resume`, `delete`
- keyboard target metadata (`role`, `tabIndex`, accessible names)
- a level line for constant/horizontal thresholds, or a comparison record
- explicit `displayable: false` + reason for an unsafe log level, with the
  original value unchanged

All external strings are `{text, external: true}`. Renderers MUST insert them
with text-only APIs. The model never produces HTML, CSS, or executable strings.
`edit`, `pause`, and `resume` require the revision previously read by the caller.
Missing or stale revisions are rejected; the model never substitutes the latest revision.
`editorErrors(id)` returns `null` or a text-only error summary with `role:
'alert'` and per-field `path`, `message`, `errorId`, `ariaInvalid`, and
`ariaDescribedBy`. A renderer associates each field path with its control,
uses the ID on the text-only error element, and sets the corresponding ARIA
attributes. Failed edits still throw the original `AlertError` and keep the
committed definition; successful edits clear the stored errors. Subscribers
receive `edit-errors` when this presentation changes.
Subscriber failures do not undo a committed selection or prevent other listeners. They are reported through `onError` and retained in `getDiagnostics()`; the integrated chart forwards them to its `error` event.
Mouse and pen drag of a drawn constant-threshold level line (integrated `alertUI`, interaction `beginDrag`) previews the new price locally and commits it on release through `edit` (`engine.update` with the revision read at drag start; the constant source keeps its other fields and only `value` changes). A rejected update (stale revision, backend-authority alert, invalid value) is thrown by `edit`, reported by the interaction layer through its `error` event, and the line returns to the stored price; Escape cancels without calling the engine. No new alert events are emitted beyond the engine's `alert-updated`.
