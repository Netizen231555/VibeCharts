/**
 * Compact drawing toolbar with one remembered tool per group. The rail is a
 * single roving Tab stop; each group opens a keyboard-accessible tool menu.
 * Unavailable actions remain focusable so their reasons can be announced.
 */
import { createElement, append, on, contains } from '../../interaction/dom.js';
import { createIcon, hasIcon } from '../icons.js';


export function createDrawingRail(controller, context) {
  const doc = context.document;
  const host = context.host;
  const disposers = [];
  const initial = controller.model();
  const region = context.region;
  const tools = (initial.groups.find((group) => group.id === 'tools') || { controls: [] }).controls;
  const allControls = initial.groups.flatMap((group) => group.controls);
  const clearControl = allControls.find((control) => control.id === 'clearDrawings') || null;
  // Hide and lock are toggles about the whole document, kept apart from the tools by a rule.
  const stateControls = ['hideDrawings', 'lockDrawings'].map((id) => allControls.find((control) => control.id === id)).filter(Boolean);

  const toolGroups = new Map();
  for (const control of tools) {
    const key = control.group ?? null;
    if (!toolGroups.has(key)) toolGroups.set(key, []);
    toolGroups.get(key).push(control);
  }

  const root = createElement(doc, 'div', {
    class: 'chart-ui-bar chart-ui-rail',
    role: 'toolbar',
    'aria-orientation': 'vertical',
    'aria-label': controller.t('rail.label'),
  });
  const tip = createElement(doc, 'div', { class: 'chart-ui-tip chart-ui-rail-tip', 'aria-hidden': 'true', hidden: true });

  /** @type {Array<{ kind: string, controlId: string|null, group: string|null, button: HTMLElement, label: string, reason: HTMLElement }>} */
  const items = [];

  function addItem(kind, controlId, label, iconName, group = null) {
    const button = createElement(doc, 'button', {
      type: 'button',
      class: 'chart-ui-btn chart-ui-rail-btn',
      tabindex: '-1',
      'data-control': controlId || 'cursor',
    });
    // Without an icon the label is shown as text: the control is never nameless and an unknown tool never throws.
    if (hasIcon(iconName)) append(button, createIcon(doc, iconName, { size: 20, icons: controller.icons }), createElement(doc, 'span', { class: 'chart-ui-sr' }, label));
    else append(button, createElement(doc, 'span', { class: 'chart-ui-rail-text' }, label));
    const reason = createElement(doc, 'span', { class: 'chart-ui-sr' });
    append(button, reason);
    if (kind !== 'clear') button.setAttribute('aria-pressed', 'false');
    const item = { kind, controlId, group, button, label, reason };
    items.push(item);
    return item;
  }

  if (tools.length > 0) addItem('cursor', null, controller.t('rail.cursor'), 'cursor', 'cursor');
  for (const controls of toolGroups.values()) {
    const selected = controls.find((control) => control.pressed) || controls[0];
    const item = addItem('tool', selected.id, selected.label, selected.value, 'tools');
    item.controls = controls;
    item.button.setAttribute('aria-haspopup', 'menu');
    item.button.setAttribute('aria-expanded', 'false');
  }
  if (clearControl) addItem('clear', clearControl.id, clearControl.label, 'clear', 'clear');
  for (const control of stateControls) addItem('toggle', control.id, control.label, control.id, 'state');

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

  /* ------------------------------- tool menus ------------------------------- */
  // The menu lives outside the scrolling rail, but inside the themed host.
  const menu = createElement(doc, 'div', {
    class: 'chart-ui-menu chart-ui-tool-group-menu',
    role: 'menu',
    hidden: true,
  });
  menu.style.position = 'fixed';
  append(host, menu);
  let openItem = null;
  let menuEntries = [];

  function closeMenu(restoreFocus = false) {
    if (!openItem) return;
    const button = openItem.button;
    openItem.button.setAttribute('aria-expanded', 'false');
    openItem = null;
    menu.setAttribute('hidden', '');
    if (restoreFocus) button.focus();
  }

  function positionMenu() {
    if (!openItem) return;
    const rect = openItem.button.getBoundingClientRect();
    const view = doc.defaultView;
    const width = doc.documentElement.clientWidth || (view ? view.innerWidth : 0);
    const height = doc.documentElement.clientHeight || (view ? view.innerHeight : 0);
    const horizontal = root.getAttribute('aria-orientation') === 'horizontal';
    let left = horizontal ? rect.left : (region === 'end' ? rect.left - menu.offsetWidth - 6 : rect.right + 6);
    let top = horizontal ? (region === 'bottom' ? rect.top - menu.offsetHeight - 6 : rect.bottom + 6) : rect.top;
    left = Math.max(4, Math.min(left, width - menu.offsetWidth - 4));
    top = Math.max(4, Math.min(top, height - menu.offsetHeight - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function openMenu(item) {
    if (openItem === item) {
      closeMenu(true);
      return;
    }
    closeMenu();
    hideTip();
    openItem = item;
    item.button.setAttribute('aria-expanded', 'true');
    menu.setAttribute('aria-label', item.controls[0].groupLabel || controller.t('group.tools'));
    while (menu.firstChild) menu.removeChild(menu.firstChild);
    const byId = new Map(controller.model().groups.flatMap((group) => group.controls).map((control) => [control.id, control]));
    menuEntries = item.controls.map((original) => {
      const control = byId.get(original.id) || original;
      const button = createElement(doc, 'button', {
        type: 'button', class: 'chart-ui-menu-item', role: 'menuitemradio',
        tabindex: '-1', 'aria-checked': control.pressed ? 'true' : 'false',
      });
      if (hasIcon(control.value)) append(button, createIcon(doc, control.value, { size: 20, icons: controller.icons }));
      append(button, createElement(doc, 'span', {}, control.label));
      const reason = createElement(doc, 'span', { class: 'chart-ui-sr' });
      append(button, reason);
      const entry = { button, reason, label: control.label, controlId: control.id };
      paint(entry, control);
      append(menu, button);
      return entry;
    });
    menu.removeAttribute('hidden');
    positionMenu();
    const selected = menuEntries.find((entry) => entry.controlId === item.controlId) || menuEntries[0];
    if (selected) selected.button.focus();
  }

  disposers.push(on(menu, 'click', (event) => {
    const entry = menuEntries.find((candidate) => contains(candidate.button, event.target));
    if (!entry || !openItem) return;
    const item = openItem;
    const control = controller.model().groups.flatMap((group) => group.controls).find((candidate) => candidate.id === entry.controlId);
    if (!control) return;
    if (control.enabled === false) {
      controller.run(control.id);
      return;
    }
    const result = control.pressed ? null : controller.run(control.id);
    item.controlId = control.id;
    setToolIcon(item, control);
    closeMenu(!result?.pendingText);
  }));
  disposers.push(on(menu, 'keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (event.key === 'Tab') return;
    const index = menuEntries.findIndex((entry) => contains(entry.button, event.target));
    let next = null;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = index + 1;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = menuEntries.length - 1;
    if (next === null || !menuEntries.length) return;
    event.preventDefault();
    menuEntries[(next + menuEntries.length) % menuEntries.length].button.focus();
  }));
  disposers.push(on(menu, 'focusout', (event) => {
    if ((!event.relatedTarget || !contains(menu, event.relatedTarget)) &&
        !(openItem && event.relatedTarget && contains(openItem.button, event.relatedTarget))) closeMenu();
  }));
  disposers.push(on(doc, 'pointerdown', (event) => {
    if (openItem && !contains(menu, event.target) && !contains(openItem.button, event.target)) closeMenu();
  }));
  disposers.push(() => {
    closeMenu();
    if (menu.parentNode) menu.parentNode.removeChild(menu);
  });

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
      if (openItem) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      } else if (tipTarget) { event.preventDefault(); event.stopPropagation(); hideTip(); }
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
      let result;
      if (item.kind === 'cursor') {
        closeMenu();
        dropActiveTool();
      } else if (item.kind === 'tool') {
        openMenu(item);
        return;
      } else {
        result = controller.run(item.controlId);
      }
      // A pending text editor owns focus until it is confirmed or cancelled.
      if (hadFocus && !result?.pendingText && doc.activeElement !== item.button) item.button.focus();
    }));
  }

  /* ---------------------------------- update ---------------------------------- */
  function setToolIcon(item, control) {
    item.controlId = control.id;
    item.label = control.label;
    item.button.setAttribute('data-control', control.id);
    while (item.button.firstChild) item.button.removeChild(item.button.firstChild);
    if (hasIcon(control.value)) append(item.button, createIcon(doc, control.value, { size: 20, icons: controller.icons }), createElement(doc, 'span', { class: 'chart-ui-sr' }, control.label));
    else append(item.button, createElement(doc, 'span', { class: 'chart-ui-rail-text' }, control.label));
    append(item.button, item.reason);
    if (tipTarget === item) showTip(item);
  }

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
      if (item.kind === 'tool') {
        const selected = item.controls.map((entry) => byId.get(entry.id)).find((entry) => entry && entry.pressed);
        if (selected && item.controlId !== selected.id) setToolIcon(item, selected);
        item.button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        continue;
      }
      const control = byId.get(item.controlId);
      if (!control) continue;
      if (item.kind === 'toggle') item.button.setAttribute('aria-pressed', control.pressed ? 'true' : 'false');
      paint(item, control);
    }
    if (openItem) {
      for (const entry of menuEntries) {
        const control = byId.get(entry.controlId);
        if (!control) continue;
        entry.button.setAttribute('aria-checked', control.pressed ? 'true' : 'false');
        paint(entry, control);
      }
    }
    // The single Tab stop follows the chosen tool while focus is elsewhere; it never jumps under the user's hands.
    if (!contains(root, doc.activeElement) && !contains(menu, doc.activeElement)) setTabStop(pressedItem());
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
    if (openItem) positionMenu();
  }
  syncOrientation();
  const view = doc.defaultView;
  if (view) {
    disposers.push(on(view, 'resize', positionMenu));
    disposers.push(on(doc, 'scroll', positionMenu, true));
  }
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
