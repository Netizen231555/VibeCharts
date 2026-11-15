# Writing your own interface part

The interface around a chart is a set of **parts** placed in **regions**. Every built-in part (top bar, drawing rail, navigation cluster, settings menu, status line, data table) can be left out or replaced by a part of your own that uses your markup. This guide shows how. The reference for every option is [contract.md](contract.md) §15a ("Chart UI layout" and "Headless interface layer").

Two complete, copyable parts live in [`examples/parts/`](../examples/parts/): a popup holding all drawing tools (`tool-popover.js`) and a native `<select>` (`tool-select.js`). The runnable page `examples/parts/index.html` switches between them and the built-in rail.

## A part is a factory

```js
function myPart(controller, { document, region, id, host, chartContainer, layout }) {
  const element = document.createElement('div');
  // ...build markup, subscribe to the controller...
  return { element, destroy() { /* undo everything you added */ } };
}
```

- `controller` is the headless interface layer: `controller.model()` (controls, labels, pressed state, refusal reasons), `controller.get(key)`, `controller.subscribe(keys, listener)`, `controller.run(controlId)`, `controller.announce(text)`, `controller.t(key)`, and `controller.icons`, the host's icon replacements from `chartUI.icons` (draw with `createIcon(doc, name, { icons: controller.icons })` from `vibecharts/ui` so a part follows them).
- `region` says where the part stands (`top`, `start`, `end`, `overlay`, `bottom`, `menu`); adapt to it if the markup depends on direction.
- `element` is inserted into the region for you. `destroy` runs when the UI is destroyed, the layout is swapped, or the part is replaced.

## Register it and place it

```js
import { createChart, attachChartFeatures } from 'vibecharts';

attachChartFeatures(chart, {
  context: { instrumentId: 'XYZ', interval: '1d', sourceId: 'my-feed' },
  interaction: {},
  chartUI: {
    host,
    parts: {
      // `controls` lists the control ids the part provides; a trailing `:` matches every id with that prefix.
      fitButton: { create: fitButton, regions: ['top'], controls: [] },
    },
    layout: { top: ['topBar', 'fitButton'], start: ['drawingRail'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine'] },
  },
});
```

- A part id equal to a built-in id **replaces** the built-in. A new id adds a part.
- Layout validation proves that every action can still be invoked without a pointer. If you leave out a built-in part, either mount a part that declares the same control ids in `controls` (as both recipes do) or list the ids in `layout.without`.
- Do **not** do both. `without` means "removed on purpose": the controls stay in the model but are disabled with a "removed by the host" reason, so a part that covers them could no longer run them.
- A rejected layout throws `INVALID_LAYOUT` naming the field (`layout.top[1]`) or the actions left without a way to be invoked.

## Read state, run actions

```js
function fitButton(controller, { document: doc }) {
  const button = doc.createElement('button');
  button.type = 'button';

  const control = () => controller.model().groups.flatMap((group) => group.controls).find((entry) => entry.id === 'fitContent');

  function paint() {
    const fit = control();
    button.textContent = fit.label;                       // already in the chart language
    if (fit.enabled) button.removeAttribute('aria-disabled'); else button.setAttribute('aria-disabled', 'true');
    button.title = fit.enabled ? '' : fit.reason;         // a disabled control explains itself
  }
  paint();

  const onClick = () => { controller.run('fitContent'); }; // a refusal is returned and announced, never thrown
  button.addEventListener('click', onClick);
  const unsubscribe = controller.subscribe(['capabilities'], paint);

  return {
    element: button,
    destroy() { button.removeEventListener('click', onClick); unsubscribe(); },
  };
}
```

`controller.run` returns `{ ok: true, ... }` or `{ ok: false, reason }`. An unknown id throws `UNKNOWN_CONTROL`. After the chart or the UI is destroyed, controller calls throw `UI_DESTROYED`, so unsubscribe in `destroy`.

Control ids: `tool:<name>` (29 drawing tools, with `group` and `groupLabel`), `chartType:<id>`, `indicator:<id>`, `interval`, and plain actions such as `undo`, `redo`, `clearDrawings`, `zoomIn`, `fitContent`, `follow`, `theme`. Print `controller.model()` once to see exactly what your chart offers.

## Clean up

Remove every listener you added (including document and window listeners), unsubscribe from the controller, and let `destroy` be safe to call after a partial failure. Anything you append outside `element` (a popup on `document.body`, for example) must be removed too; the recipes keep their panel inside `element` and position it with `position: fixed` so a scrolling bar cannot clip it.

## What stays your job: accessibility

The model gives you localized labels, pressed state, refusal reasons and the keyboard equivalents of every action (`controller.actions()`). It does not give you accessible markup. Check each part against this list:

- **Name and role.** Every control has an accessible name; toggles use `aria-pressed`; a popup trigger has `aria-haspopup` and `aria-expanded`.
- **Refusals.** A control that cannot act stays focusable (`aria-disabled`, not `disabled`) and its `reason` is readable (`aria-describedby` or a tooltip). Activating it calls `controller.run`, which announces the reason.
- **Keyboard.** Everything works without a pointer: Enter and Space activate, Escape closes a popup and returns focus to its trigger, arrow keys move inside a group.
- **Focus.** Do not move focus unexpectedly; restore it after a popup closes.
- **Narrow screens.** Nothing is clipped without a way to reach it: scroll, wrap, or reposition.

## Where to look

- `examples/parts/tool-popover.js`: trigger and panel, grouped entries, keyboard handling, fixed positioning that opens upward when there is no room below.
- `examples/parts/tool-select.js`: the smallest possible part, a labelled native element driven only by the model.
- `src/ui/parts/`: the built-in parts, written against the same controller.
