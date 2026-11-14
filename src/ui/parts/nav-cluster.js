/**
 * Navigation cluster part: zoom, fit, jump to the last bar and price
 * auto-scale as icon buttons placed over the chart.
 *
 * The group is always in the DOM and in the tab order; whether it is visible
 * is decided by the stylesheet alone (hover/focus of the shell, always on
 * devices without hover), so focus is never lost to a script toggle and
 * without a stylesheet the buttons are simply visible. Buttons are updated in
 * place when capabilities change; an unavailable action stays focusable with
 * its reason attached and still goes through `controller.run`, which
 * announces the refusal.
 */
import { InteractionError } from '../../interaction/errors.js';
import { createElement, append, on } from '../../interaction/dom.js';
import { createIcon } from '../icons.js';

const NAV_CONTROLS = Object.freeze([
  { id: 'zoomIn', icon: 'zoomIn' },
  { id: 'zoomOut', icon: 'zoomOut' },
  { id: 'fitContent', icon: 'fit' },
  { id: 'scrollToRealTime', icon: 'toLast' },
  { id: 'priceAuto', icon: 'priceAuto' },
]);

// Several instances may live on one page; reason nodes need distinct ids.
let instanceCounter = 0;

function findControl(model, id) {
  for (const group of model.groups) {
    const control = group.controls.find((entry) => entry.id === id);
    if (control) return control;
  }
  throw new InteractionError(`Control "${id}" is missing from the UI model`, { code: 'UNKNOWN_CONTROL', field: 'id' });
}

export function createNavCluster(controller, context) {
  const doc = context.document;
  instanceCounter += 1;
  const prefix = `chart-ui-nav-${instanceCounter}`;

  const element = createElement(doc, 'div', {
    class: 'chart-ui-bar chart-ui-nav',
    role: 'toolbar',
    'aria-label': 'Навигация по графику',
  });

  const entries = [];
  const disposers = [];

  for (const spec of NAV_CONTROLS) {
    const button = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn', 'data-control': spec.id });
    const reasonId = `${prefix}-${spec.id}-reason`;
    const reason = createElement(doc, 'span', { class: 'chart-ui-sr', id: reasonId });
    append(button, createIcon(doc, spec.icon), reason);
    append(element, button);
    entries.push({ spec, button, reason, reasonId });
    disposers.push(on(button, 'click', () => controller.run(spec.id)));
  }

  function render() {
    const model = controller.model();
    for (const entry of entries) {
      const control = findControl(model, entry.spec.id);
      const { button, reason, reasonId } = entry;
      // An explicit name keeps the reason out of the name; it is exposed as the description.
      button.setAttribute('aria-label', control.label);
      if (control.enabled) {
        button.removeAttribute('aria-disabled');
        button.removeAttribute('aria-describedby');
        button.setAttribute('title', control.label);
        if (reason.textContent !== '') reason.textContent = '';
      } else {
        const text = control.reason || 'Действие недоступно';
        button.setAttribute('aria-disabled', 'true');
        button.setAttribute('aria-describedby', reasonId);
        button.setAttribute('title', `${control.label}: ${text}`);
        if (reason.textContent !== text) reason.textContent = text;
      }
    }
  }

  render();
  disposers.push(controller.subscribe('capabilities', render));

  let destroyed = false;
  return {
    element,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of disposers.splice(0)) dispose();
    },
  };
}
