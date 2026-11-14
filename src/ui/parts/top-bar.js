/**
 * topBar: instrument title, interval, chart type, indicator, undo/redo.
 *
 * Chart type and indicator are menu buttons (one Tab stop each, arrow keys
 * inside the menu) so the bar stays short on narrow hosts. Every control is
 * created from `controller.model()` once and then only patched, so focus and
 * an open menu survive state changes. The model's shape is fixed for the life
 * of the controller (it follows the host options), which is why nodes are
 * never added or removed after creation.
 */
import { createElement, append, on, contains } from '../../interaction/dom.js';
import { createIcon, hasIcon } from '../icons.js';


let instances = 0;

function groupControls(model, groupId) {
  const group = model.groups.find((entry) => entry.id === groupId);
  return group ? { label: group.label, controls: group.controls } : { label: '', controls: [] };
}

function findControl(model, id) {
  for (const group of model.groups) {
    const control = group.controls.find((entry) => entry.id === id);
    if (control) return control;
  }
  return null;
}

/** Icon name of a control: chart types live under their own prefix because a tool can share their id. */
function controlIconName(control) {
  return control.action === 'chartType' ? `chartType.${control.value}` : control.value;
}

/** Icon node for a control, or `null` when the set has no such icon (the text label still names the control). */
function iconFor(doc, control, size) {
  const name = controlIconName(control);
  return hasIcon(name) ? createIcon(doc, name, { size }) : null;
}

/**
 * Availability is exposed three ways: `aria-disabled`, a tooltip with the reason
 * and visually hidden reason text inside the control. The native `disabled`
 * flag is applied too, except while the control holds focus: a focused control
 * that turns disabled would drop keyboard focus, so it keeps focus (and
 * refuses with an announced reason on activation) until it is left.
 */
function paintAvailability(doc, element, reasonNode, control, { native, t }) {
  const unavailable = control.enabled === false;
  const reason = unavailable ? (control.reason || t('ui.actionUnavailable')) : '';
  if (unavailable) element.setAttribute('aria-disabled', 'true');
  else element.removeAttribute('aria-disabled');
  element.setAttribute('title', unavailable ? `${control.label}: ${reason}` : control.label);
  reasonNode.textContent = unavailable ? t('ui.unavailableSuffix', { reason }) : '';
  if (!native) return;
  element.disabled = unavailable && doc.activeElement !== element;
}

function reasonSpan(doc) {
  return createElement(doc, 'span', { class: 'chart-ui-sr' });
}

/**
 * A button that opens a small menu of toggle controls.
 * @returns {{ element: HTMLElement, trigger: HTMLElement, menu: HTMLElement, items: Map<string, object>, close: Function, open: Function, isOpen: Function }}
 */
function createMenuButton(doc, { id, groupLabel, itemRole, controls, onSelect, onOpen, disposers }) {
  const menuId = `${id}-menu`;
  const wrapper = createElement(doc, 'div', { class: 'chart-ui-topbar-menu-wrap' });
  const trigger = createElement(doc, 'button', {
    type: 'button',
    class: 'chart-ui-btn chart-ui-surface-btn chart-ui-topbar-trigger',
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-controls': menuId,
  });
  const triggerIcon = createElement(doc, 'span', { class: 'chart-ui-topbar-icon' });
  const prefix = createElement(doc, 'span', { class: 'chart-ui-sr' }, `${groupLabel}: `);
  const value = createElement(doc, 'span', { class: 'chart-ui-topbar-value' });
  const triggerReason = reasonSpan(doc);
  append(trigger, triggerIcon, prefix, value, createIcon(doc, 'chevronDown', { size: 16 }), triggerReason);

  const menu = createElement(doc, 'div', {
    id: menuId,
    role: 'menu',
    'aria-label': groupLabel,
    class: 'chart-ui-menu chart-ui-topbar-menu',
    hidden: true,
  });
  const items = new Map();
  for (const control of controls) {
    const button = createElement(doc, 'button', {
      type: 'button',
      role: itemRole,
      tabindex: '-1',
      class: 'chart-ui-menu-item',
      'data-control': control.id,
      'aria-checked': 'false',
    });
    // The check mark is a shape, so the chosen entry is not told apart by colour alone.
    const check = createElement(doc, 'span', { class: 'chart-ui-topbar-check', hidden: true });
    append(check, createIcon(doc, 'check', { size: 16 }));
    const icon = iconFor(doc, control, 18);
    const text = createElement(doc, 'span', { class: 'chart-ui-topbar-item-text' }, control.label);
    const reason = reasonSpan(doc);
    append(button, check, icon, text, reason);
    append(menu, button);
    items.set(control.id, { button, check, text, reason });
  }
  append(wrapper, trigger, menu);

  let opened = false;
  let openDisposers = [];
  const buttons = () => [...items.values()].map((entry) => entry.button);

  function place() {
    const view = doc.defaultView;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = doc.documentElement.clientWidth || (view ? view.innerWidth : 0);
    const viewportHeight = doc.documentElement.clientHeight || (view ? view.innerHeight : 0);
    const left = Math.max(4, Math.min(rect.left, viewportWidth - menu.offsetWidth - 4));
    const top = rect.bottom + 2;
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    if (viewportHeight > 0) menu.style.maxHeight = `${Math.max(120, viewportHeight - top - 8)}px`;
  }

  function close({ restoreFocus = true } = {}) {
    if (!opened) return;
    opened = false;
    for (const dispose of openDisposers.splice(0)) dispose();
    menu.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }

  function open(which = 'selected') {
    if (opened) return;
    onOpen();
    opened = true;
    menu.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    place();
    const list = buttons();
    const selected = list.find((button) => button.getAttribute('aria-checked') === 'true');
    const target = which === 'last' ? list[list.length - 1] : (selected || list[0]);
    if (target) target.focus();
    // A fixed-position menu would drift away from its button when anything scrolls or resizes.
    const view = doc.defaultView;
    openDisposers.push(on(doc, 'pointerdown', (event) => { if (!contains(wrapper, event.target)) close({ restoreFocus: false }); }, true));
    openDisposers.push(on(doc, 'scroll', (event) => { if (!contains(menu, event.target)) close({ restoreFocus: false }); }, true));
    if (view) openDisposers.push(on(view, 'resize', () => close({ restoreFocus: false })));
  }

  disposers.push(on(trigger, 'click', () => { if (opened) close(); else open(); }));
  disposers.push(on(trigger, 'keydown', (event) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); open('selected'); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); open('last'); }
  }));
  disposers.push(on(menu, 'keydown', (event) => {
    const list = buttons();
    const index = list.indexOf(doc.activeElement);
    const focusAt = (next) => { event.preventDefault(); list[(next + list.length) % list.length].focus(); };
    switch (event.key) {
      case 'ArrowDown': focusAt(index + 1); break;
      case 'ArrowUp': focusAt(index < 0 ? list.length - 1 : index - 1); break;
      case 'Home': focusAt(0); break;
      case 'End': focusAt(list.length - 1); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); close(); break;
      // Focus goes back to the trigger first so the default Tab step continues from the bar, not from a hidden item.
      case 'Tab': close(); break;
      default: break;
    }
  }));
  disposers.push(on(wrapper, 'focusout', (event) => {
    if (event.relatedTarget && !contains(wrapper, event.relatedTarget)) close({ restoreFocus: false });
  }));
  for (const [controlId, entry] of items) {
    disposers.push(on(entry.button, 'click', () => {
      close();
      onSelect(controlId);
    }));
  }
  disposers.push(() => close({ restoreFocus: false }));

  return { element: wrapper, trigger, triggerIcon, value, triggerReason, items, close, isOpen: () => opened };
}

export function createTopBar(controller, context) {
  const doc = context.document;
  const uid = `chart-ui-topbar-${++instances}`;
  const disposers = [];
  const initial = controller.model();

  const root = createElement(doc, 'div', {
    class: 'chart-ui-bar chart-ui-topbar',
    role: 'toolbar',
    'aria-label': controller.t('top.label'),
  });

  const title = createElement(doc, 'span', { class: 'chart-ui-topbar-title' });
  append(root, title);

  /* -------------------------------- interval -------------------------------- */
  let interval = null;
  const intervalControl = findControl(initial, 'interval');
  if (intervalControl) {
    const field = createElement(doc, 'label', { class: 'chart-ui-group chart-ui-topbar-field' });
    const fieldLabel = createElement(doc, 'span', { class: 'chart-ui-sr' }, intervalControl.label);
    const select = createElement(doc, 'select', { class: 'chart-ui-select', 'data-control': 'interval' });
    for (const option of intervalControl.options || []) append(select, createElement(doc, 'option', { value: option.value }, option.label));
    const reason = reasonSpan(doc);
    const reasonId = `${uid}-interval-reason`;
    reason.setAttribute('id', reasonId);
    select.setAttribute('aria-describedby', reasonId);
    append(field, fieldLabel, select);
    append(root, field, reason);
    disposers.push(on(select, 'change', () => { controller.run('interval', select.value); }));
    interval = { select, reason };
  }

  /* --------------------- chart type and indicator menus --------------------- */
  let openMenu = null;
  const menus = [];
  function addMenu(key, groupId, itemRole, emptyText) {
    const { label, controls } = groupControls(initial, groupId);
    if (controls.length === 0) return;
    const menu = createMenuButton(doc, {
      id: `${uid}-${key}`,
      groupLabel: label,
      itemRole,
      controls,
      disposers,
      onOpen: () => { if (openMenu && openMenu !== menu) openMenu.close({ restoreFocus: false }); openMenu = menu; },
      onSelect: (controlId) => { controller.run(controlId); },
    });
    menu.groupId = groupId;
    menu.groupLabel = label;
    menu.emptyText = emptyText;
    menu.iconName = null;
    menus.push(menu);
    append(root, menu.element);
  }
  addMenu('type', 'chartType', 'menuitemradio', controller.t('top.notChosen'));
  addMenu('indicator', 'indicators', 'menuitemcheckbox', controller.t('top.noIndicator'));

  /* ----------------------------------- undo ----------------------------------- */
  const history = [];
  const historyGroup = createElement(doc, 'div', { class: 'chart-ui-group chart-ui-topbar-history', role: 'group', 'aria-label': controller.t('top.history') });
  for (const [id, icon] of [['undo', 'undo'], ['redo', 'redo']]) {
    const control = findControl(initial, id);
    if (!control) continue;
    const button = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn', 'data-control': id });
    const text = createElement(doc, 'span', { class: 'chart-ui-sr' }, control.label);
    const reason = reasonSpan(doc);
    append(button, createIcon(doc, icon, { size: 20 }), text, reason);
    disposers.push(on(button, 'click', () => { controller.run(id); }));
    // Natively disable only after focus has left: a control that disables itself under the keyboard would lose it.
    disposers.push(on(button, 'blur', () => { if (button.getAttribute('aria-disabled') === 'true') button.disabled = true; }));
    append(historyGroup, button);
    history.push({ id, button, text, reason });
  }
  if (history.length > 0) append(root, createElement(doc, 'span', { class: 'chart-ui-sep', 'aria-hidden': 'true' }), historyGroup);

  /* ---------------------------------- update ---------------------------------- */
  function updateMenu(menu, model) {
    const { controls } = groupControls(model, menu.groupId);
    const current = controls.find((control) => control.pressed === true);
    menu.value.textContent = current ? current.label : menu.emptyText;
    const iconName = current && hasIcon(controlIconName(current)) ? controlIconName(current) : null;
    if (iconName !== menu.iconName) {
      menu.iconName = iconName;
      while (menu.triggerIcon.firstChild) menu.triggerIcon.removeChild(menu.triggerIcon.firstChild);
      if (iconName) append(menu.triggerIcon, createIcon(doc, iconName, { size: 18 }));
    }
    for (const control of controls) {
      const entry = menu.items.get(control.id);
      if (!entry) continue;
      entry.button.setAttribute('aria-checked', control.pressed ? 'true' : 'false');
      if (control.pressed) entry.check.removeAttribute('hidden');
      else entry.check.setAttribute('hidden', '');
      paintAvailability(doc, entry.button, entry.reason, control, { native: false, t: controller.t });
    }
    // The trigger is unavailable only when no entry can act; the first reason explains it.
    const blocked = controls.length > 0 && controls.every((control) => control.enabled === false);
    if (blocked && menu.isOpen()) menu.close();
    paintAvailability(doc, menu.trigger, menu.triggerReason, {
      label: menu.groupLabel,
      enabled: !blocked,
      reason: blocked ? controls[0].reason : null,
    }, { native: true, t: controller.t });
  }

  function update() {
    const model = controller.model();
    const text = controller.options.title ?? controller.t('chart.title');
    if (title.textContent !== text) {
      title.textContent = text;
      title.setAttribute('title', text);
    }
    if (interval) {
      const control = findControl(model, 'interval');
      if (control) {
        const current = controller.get('interval');
        const index = [...interval.select.options].findIndex((option) => option.value === current);
        // No matching option leaves the select empty: an interval the host never chose is not invented.
        if (interval.select.selectedIndex !== index) interval.select.selectedIndex = index;
        paintAvailability(doc, interval.select, interval.reason, control, { native: true, t: controller.t });
      }
    }
    for (const menu of menus) updateMenu(menu, model);
    for (const entry of history) {
      const control = findControl(model, entry.id);
      if (control) paintAvailability(doc, entry.button, entry.reason, control, { native: true, t: controller.t });
    }
  }
  update();
  disposers.push(controller.subscribe(['chartType', 'indicator', 'interval', 'capabilities', 'drawings'], update));

  return {
    element: root,
    destroy() {
      for (const dispose of disposers.splice(0).reverse()) dispose();
    },
  };
}
