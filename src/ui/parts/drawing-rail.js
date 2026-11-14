/**
 * drawingRail: icon column of drawing tools, a cursor button that drops the
 * active tool, and a separated "clear drawings" button. Tools are separated
 * by a thin rule wherever their `group` changes. Past `GRID_THRESHOLD` tools
 * the column becomes a two-column grid of compact buttons (still one toolbar
 * in DOM order) and scrolls vertically when it is taller than the chart.
 *
 * The rail is one Tab stop (roving tabindex) with arrow-key navigation. Buttons
 * that cannot act stay focusable (`aria-disabled`, not `disabled`) so their
 * reason can be read and activation is refused with an announced reason by the
 * controller. The tip is a single element moved between buttons; it is fixed
 * positioned so the rail's own scrolling cannot clip it.
 */
import { createElement, append, on, contains } from '../../interaction/dom.js';
import { createIcon, hasIcon } from '../icons.js';

// More tools than this switch the rail to the two-column grid.
const GRID_THRESHOLD = 12;

export function createDrawingRail(controller, context) {
  const doc = context.document;
  const host = context.host;
  const disposers = [];
  const initial = controller.model();
  const region = context.region;
  const tools = (initial.groups.find((group) => group.id === 'tools') || { controls: [] }).controls;
  const clearControl = initial.groups.flatMap((group) => group.controls).find((control) => control.id === 'clearDrawings') || null;

  const root = createElement(doc, 'div', {
    class: `chart-ui-bar chart-ui-rail${tools.length > GRID_THRESHOLD ? ' chart-ui-rail-grid' : ''}`,
    role: 'toolbar',
    'aria-orientation': 'vertical',
    'aria-label': controller.t('rail.label'),
  });
  const tip = createElement(doc, 'div', { class: 'chart-ui-tip chart-ui-rail-tip', 'aria-hidden': 'true', hidden: true });

  /** @type {Array<{ kind: 'cursor'|'tool'|'clear', controlId: string|null, group: string|null, button: HTMLElement, label: string, reason: HTMLElement }>} */
  const items = [];

  function addItem(kind, controlId, label, iconName, group = null) {
    const button = createElement(doc, 'button', {
      type: 'button',
      class: 'chart-ui-btn chart-ui-rail-btn',
      tabindex: '-1',
      'data-control': controlId || 'cursor',
    });
    // Without an icon the label is shown as text: the control is never nameless and an unknown tool never throws.
    if (hasIcon(iconName)) append(button, createIcon(doc, iconName, { size: 20 }), createElement(doc, 'span', { class: 'chart-ui-sr' }, label));
    else append(button, createElement(doc, 'span', { class: 'chart-ui-rail-text' }, label));
    const reason = createElement(doc, 'span', { class: 'chart-ui-sr' });
    append(button, reason);
    if (kind !== 'clear') button.setAttribute('aria-pressed', 'false');
    const item = { kind, controlId, group, button, label, reason };
    items.push(item);
    return item;
  }

  if (tools.length > 0) addItem('cursor', null, controller.t('rail.cursor'), 'cursor', 'cursor');
  for (const control of tools) addItem('tool', control.id, control.label, control.value, control.group ?? null);
  if (clearControl) addItem('clear', clearControl.id, clearControl.label, 'clear', 'clear');

  // A rule between groups; tools without a group (host-supplied sets) form one run and get no inner rules.
  items.forEach((item, index) => {
    if (index > 0 && item.group !== items[index - 1].group) append(root, createElement(doc, 'span', { class: 'chart-ui-sep', 'aria-hidden': 'true' }));
    append(root, item.button);
  });
  append(root, tip);

  /* ----------------------------------- tip ----------------------------------- */
  let tipTarget = null;
  function showTip(item) {
    const reason = item.button.getAttribute('aria-disabled') === 'true' ? item.reason.textContent : '';
    tip.textContent = `${item.label}${reason}`;
    tip.removeAttribute('hidden');
    tipTarget = item;
    const rect = item.button.getBoundingClientRect();
    const view = doc.defaultView;
    const viewportWidth = doc.documentElement.clientWidth || (view ? view.innerWidth : 0);
    const horizontal = root.getAttribute('aria-orientation') === 'horizontal';
    // The tip opens away from the chart edge the rail is attached to: left of an end rail, above a bottom rail.
    const left = horizontal ? rect.left : (region === 'end' ? rect.left - 6 - tip.offsetWidth : rect.right + 6);
    const top = horizontal ? (region === 'bottom' ? rect.top - 6 - tip.offsetHeight : rect.bottom + 6) : rect.top + (rect.height - tip.offsetHeight) / 2;
    tip.style.left = `${Math.max(4, Math.min(left, viewportWidth - tip.offsetWidth - 4))}px`;
    tip.style.top = `${Math.max(4, top)}px`;
  }
  function hideTip() {
    tipTarget = null;
    tip.setAttribute('hidden', '');
  }
  const itemOf = (node) => items.find((item) => contains(item.button, node)) || null;

  /* ------------------------------- roving focus ------------------------------- */
  function setTabStop(target) {
    for (const item of items) item.button.setAttribute('tabindex', item === target ? '0' : '-1');
  }
  function pressedItem() {
    return items.find((item) => item.button.getAttribute('aria-pressed') === 'true') || items[0];
  }

  disposers.push(on(root, 'focusin', (event) => {
    const item = itemOf(event.target);
    if (!item) return;
    setTabStop(item);
    showTip(item);
  }));
  disposers.push(on(root, 'focusout', (event) => {
    if (!event.relatedTarget || !contains(root, event.relatedTarget)) hideTip();
  }));
  disposers.push(on(root, 'pointerover', (event) => {
    if (event.pointerType === 'touch') return;
    const item = itemOf(event.target);
    if (item && tipTarget !== item) showTip(item);
  }));
  disposers.push(on(root, 'pointerout', (event) => {
    if (event.pointerType === 'touch') return;
    const item = itemOf(event.target);
    if (item && item === tipTarget && !(event.relatedTarget && contains(item.button, event.relatedTarget))) hideTip();
  }));
  disposers.push(on(root, 'keydown', (event) => {
    const item = itemOf(event.target);
    if (!item) return;
    if (event.key === 'Escape') {
      if (tipTarget) { event.preventDefault(); event.stopPropagation(); hideTip(); }
      return;
    }
    const index = items.indexOf(item);
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[(next + items.length) % items.length].button.focus();
  }));

  /* --------------------------------- actions ---------------------------------- */
  function activeToolControl() {
    const active = controller.get('tool');
    if (active === null) return null;
    const group = controller.model().groups.find((entry) => entry.id === 'tools');
    return (group ? group.controls : []).find((control) => control.value === active) || null;
  }

  /** The `tool` action toggles the chosen tool off, so dropping the tool means choosing it again. */
  function dropActiveTool() {
    if (controller.get('tool') === null) return;
    const control = activeToolControl();
    if (!control) {
      controller.announce(controller.t('rail.cannotDrop', { tool: controller.get('tool') }), { error: true });
      return;
    }
    controller.run(control.id);
  }

  for (const item of items) {
    disposers.push(on(item.button, 'click', () => {
      const hadFocus = doc.activeElement === item.button;
      if (item.kind === 'cursor') {
        dropActiveTool();
      } else {
        controller.run(item.controlId);
      }
      // Arming a tool hands focus to the plot; a keyboard user who chose a tool should not be moved without asking.
      if (hadFocus && doc.activeElement !== item.button) item.button.focus();
    }));
  }

  /* ---------------------------------- update ---------------------------------- */
  function paint(item, control) {
    const unavailable = control.enabled === false;
    const reason = unavailable ? (control.reason || controller.t('ui.actionUnavailable')) : '';
    if (unavailable) item.button.setAttribute('aria-disabled', 'true');
    else item.button.removeAttribute('aria-disabled');
    if (unavailable) item.button.setAttribute('title', reason);
    else item.button.removeAttribute('title');
    item.reason.textContent = unavailable ? controller.t('ui.unavailableSuffix', { reason }) : '';
    if (tipTarget === item) showTip(item);
  }

  function update() {
    const model = controller.model();
    const byId = new Map(model.groups.flatMap((group) => group.controls).map((control) => [control.id, control]));
    const active = controller.get('tool');
    for (const item of items) {
      if (item.kind === 'cursor') {
        item.button.setAttribute('aria-pressed', active === null ? 'true' : 'false');
        continue;
      }
      const control = byId.get(item.controlId);
      if (!control) continue;
      if (item.kind === 'tool') item.button.setAttribute('aria-pressed', control.pressed ? 'true' : 'false');
      paint(item, control);
    }
    // The single Tab stop follows the chosen tool while focus is elsewhere; it never jumps under the user's hands.
    if (!contains(root, doc.activeElement)) setTabStop(pressedItem());
  }
  update();
  disposers.push(controller.subscribe(['tool', 'capabilities', 'drawings'], update));

  /* ------------------------------- orientation ------------------------------- */
  // Along the top or bottom the rail is a row; at the sides or floating it is a column, which the shell turns into a
  // horizontal strip on narrow hosts (side regions only). The role must say which.
  function syncOrientation() {
    const strip = region === 'top' || region === 'bottom' || ((region === 'start' || region === 'end') && host && host.getAttribute('data-layout') === 'compact');
    root.setAttribute('aria-orientation', strip ? 'horizontal' : 'vertical');
    if (tipTarget) showTip(tipTarget);
  }
  syncOrientation();
  const view = doc.defaultView;
  if (host && view && typeof view.MutationObserver === 'function') {
    const observer = new view.MutationObserver(syncOrientation);
    observer.observe(host, { attributes: true, attributeFilter: ['data-layout'] });
    disposers.push(() => observer.disconnect());
  }
  disposers.push(() => hideTip());

  return {
    element: root,
    destroy() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
