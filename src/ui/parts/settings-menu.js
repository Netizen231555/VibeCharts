/**
 * Settings menu part: a trigger button with a popup menu of toggles and
 * openers of a modal dialog; with the UI option `accessibleActions` it also
 * lists the keyboard-equivalent navigation actions (they stay on the keyboard
 * bindings either way).
 *
 * Every entry is one persistent node updated in place from the controller
 * model, so focus survives state changes and nothing is rebuilt per open.
 * Activating a toggle keeps the menu open (the new state is read from
 * `aria-checked` without reopening and focus stays on the toggle); activating
 * an action or a dialog opener closes it. A control that cannot act stays in
 * the menu as `aria-disabled` with its reason shown and described, and
 * activating it still goes through `controller.run`, which announces the
 * refusal and keeps the menu open.
 *
 * The dialog is a native modal `<dialog>`: the browser traps focus, makes the
 * rest of the page inert and closes it on Escape. It is created once, lazily,
 * and its body content is built on open and destroyed on close.
 */
import { InteractionError } from '../../interaction/errors.js';
import { createElement, append, on, contains, focusElement } from '../../interaction/dom.js';
import { createIcon, hasIcon } from '../icons.js';
import { createDrawingControls } from '../drawings.js';
import { createPanesPanel } from './panes-panel.js';
import { createDerivedPanel } from './derived-panel.js';

const TOGGLES = Object.freeze(['theme', 'follow', 'accessibleTable', 'logScale', 'drawingSnap']);
// Keyboard equivalents, listed only under `accessibleActions`; the crosshair toggle keeps the menu open like the others.
const CROSSHAIR = 'crosshair';
const ACTIONS = Object.freeze(['panLeft', 'panRight', 'priceZoomIn', 'priceZoomOut', 'crosshairPrev', 'crosshairNext']);
const STATE_KEYS = Object.freeze(['theme', 'tableVisible', 'follow', 'crosshair', 'priceMode', 'snapMode', 'capabilities', 'derived']);
const VIEWPORT_MARGIN = 4;
const TYPEAHEAD_RESET_MS = 700;

// Several instances may live on one page; ids must stay unique.
let instanceCounter = 0;

function findControl(model, id) {
  for (const group of model.groups) {
    const control = group.controls.find((entry) => entry.id === id);
    if (control) return control;
  }
  throw new InteractionError(`Control "${id}" is missing from the UI model`, { code: 'UNKNOWN_CONTROL', field: 'id' });
}

export function createSettingsMenu(controller, context) {
  const doc = context.document;
  instanceCounter += 1;
  const prefix = `chart-ui-settings-${instanceCounter}`;
  const disposers = [];
  let destroyed = false;

  const element = createElement(doc, 'div', { class: 'chart-ui-settings' });
  if (context.layout?.compact) element.setAttribute('data-compact-settings', '');
  const trigger = createElement(doc, 'button', {
    type: 'button',
    id: `${prefix}-trigger`,
    class: 'chart-ui-btn chart-ui-surface-btn',
    'aria-label': controller.t('settings.label'),
    title: controller.t('settings.label'),
    'aria-haspopup': 'menu',
    'aria-expanded': 'false',
    'aria-controls': `${prefix}-menu`,
  });
  append(trigger, createIcon(doc, 'settings'));
  const menu = createElement(doc, 'div', {
    id: `${prefix}-menu`,
    class: 'chart-ui-menu chart-ui-settings-menu',
    role: 'menu',
    'aria-labelledby': trigger.getAttribute('id'),
    hidden: true,
  });
  append(element, trigger, menu);

  /* --------------------------------- entries --------------------------------- */
  const entries = [];

  function createEntry({ key, role, label, icon = null, withCheck = false, haspopup = null }) {
    const node = createElement(doc, 'button', {
      type: 'button',
      class: 'chart-ui-menu-item chart-ui-settings-item',
      role,
      tabindex: '-1',
      'data-menu-item': key,
      'aria-haspopup': haspopup,
    });
    const lead = createElement(doc, 'span', { class: 'chart-ui-settings-lead' });
    let check = null;
    if (withCheck) {
      check = createElement(doc, 'span', { class: 'chart-ui-settings-check' });
      append(check, createIcon(doc, 'check', { size: 16 }));
      append(lead, check);
    } else if (icon !== null && hasIcon(icon)) {
      append(lead, createIcon(doc, icon, { size: 16 }));
    }
    const text = createElement(doc, 'span', { class: 'chart-ui-settings-text' });
    const labelNode = createElement(doc, 'span', { class: 'chart-ui-settings-label' }, label);
    const reasonId = `${prefix}-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}-reason`;
    // Aria-hidden keeps the reason out of the item name; `aria-describedby` still exposes it.
    const reasonNode = createElement(doc, 'span', { class: 'chart-ui-settings-reason', id: reasonId, 'aria-hidden': 'true' });
    append(text, labelNode, reasonNode);
    append(node, lead, text);
    const entry = { key, node, labelNode, reasonNode, reasonId, check };
    entries.push(entry);
    return entry;
  }

  function separator() {
    return createElement(doc, 'div', { class: 'chart-ui-menu-sep', role: 'separator' });
  }

  const dialogItems = [
    { key: 'dialog:panes', get title() { return controller.t('settings.panesTitle'); }, label: controller.t('settings.panesItem'), icon: 'panes', mount: mountPanes },
    { key: 'dialog:drawings', get title() { return controller.t('settings.drawingsTitle'); }, label: controller.t('settings.drawingsItem'), icon: null, mount: mountDrawings },
    { key: 'dialog:derived', get title() { return controller.t('settings.derivedTitle'); }, label: controller.t('settings.derivedItem'), icon: null, mount: mountDerived },
  ];

  function addControl(id, role, extra = {}) {
    const entry = createEntry({ key: id, role, label: '', ...extra });
    entry.control = id;
    append(menu, entry.node);
  }
  for (const id of TOGGLES) addControl(id, 'menuitemcheckbox', { withCheck: true });
  append(menu, separator());
  if (controller.options.accessibleActions === true) {
    addControl(CROSSHAIR, 'menuitemcheckbox', { withCheck: true });
    for (const id of ACTIONS) addControl(id, 'menuitem', { icon: id });
    append(menu, separator());
  }
  for (const item of dialogItems) {
    const entry = createEntry({ key: item.key, role: 'menuitem', label: item.label, icon: item.icon, haspopup: 'dialog' });
    entry.dialog = item;
    // The derived opener is attached only while the controller has a derived view (see syncDerived).
    if (item.key !== 'dialog:derived') append(menu, entry.node);
  }
  const derivedEntry = entries.find((entry) => entry.dialog && entry.dialog.key === 'dialog:derived');

  const drawingsAvailable = () => {
    const store = controller.chart && controller.chart.drawings;
    return Boolean(store && typeof store.snapshot === 'function');
  };

  function applyState(entry, { enabled, reason, checked, label }) {
    if (label !== undefined && entry.labelNode.textContent !== label) entry.labelNode.textContent = label;
    if (entry.check) {
      entry.node.setAttribute('aria-checked', checked ? 'true' : 'false');
      if (checked) entry.check.removeAttribute('hidden');
      else entry.check.setAttribute('hidden', '');
    }
    const name = entry.labelNode.textContent;
    if (enabled) {
      entry.node.removeAttribute('aria-disabled');
      entry.node.removeAttribute('aria-describedby');
      entry.node.removeAttribute('title');
      if (entry.reasonNode.textContent !== '') entry.reasonNode.textContent = '';
    } else {
      const text = reason || controller.t('ui.actionUnavailable');
      entry.node.setAttribute('aria-disabled', 'true');
      entry.node.setAttribute('aria-describedby', entry.reasonId);
      entry.node.setAttribute('title', `${name}: ${text}`);
      if (entry.reasonNode.textContent !== text) entry.reasonNode.textContent = text;
    }
  }

  function syncDerived() {
    const wanted = Boolean(controller.derived);
    const present = derivedEntry.node.parentNode === menu;
    if (wanted === present) return;
    if (wanted) {
      append(menu, derivedEntry.node);
      return;
    }
    const hadFocus = doc.activeElement === derivedEntry.node;
    menu.removeChild(derivedEntry.node);
    if (hadFocus) focusElement(visibleEntries()[0]?.node ?? trigger);
  }

  function render() {
    const model = controller.model();
    for (const entry of entries) {
      if (entry.control) {
        const control = findControl(model, entry.control);
        applyState(entry, {
          enabled: control.enabled !== false,
          reason: control.reason,
          checked: control.pressed === true,
          label: control.label,
        });
      } else if (entry.dialog.key === 'dialog:drawings') {
        const available = drawingsAvailable();
        applyState(entry, { enabled: available, reason: available ? null : controller.t('settings.drawingsUnavailable') });
      } else {
        applyState(entry, { enabled: true });
      }
    }
    syncDerived();
  }

  const visibleEntries = () => entries.filter((entry) => entry.node.parentNode === menu);

  /* ------------------------------ open and close ------------------------------ */
  let open = false;
  let typeahead = { text: '', time: 0 };
  const openListeners = [];

  function place() {
    for (const name of ['data-align', 'data-placement']) menu.removeAttribute(name);
    // Offsets rather than a transform: a transform would still widen the page's scrollable area.
    for (const side of ['left', 'right', 'top', 'bottom']) menu.style.removeProperty(side);
    const view = doc.defaultView;
    // Without a stylesheet the menu is an ordinary list and needs no positioning.
    if (!view || view.getComputedStyle(menu).position !== 'absolute') return;
    const root = doc.documentElement;
    const width = root.clientWidth;
    const height = root.clientHeight;
    let rect = menu.getBoundingClientRect();
    if (rect.left < VIEWPORT_MARGIN) {
      menu.setAttribute('data-align', 'start');
      rect = menu.getBoundingClientRect();
    }
    if (rect.bottom > height - VIEWPORT_MARGIN) {
      const anchor = trigger.getBoundingClientRect();
      if (anchor.top > height - anchor.bottom) {
        menu.setAttribute('data-placement', 'top');
        rect = menu.getBoundingClientRect();
      }
    }
    let dx = 0;
    let dy = 0;
    if (rect.right > width - VIEWPORT_MARGIN) dx = width - VIEWPORT_MARGIN - rect.right;
    if (rect.left + dx < VIEWPORT_MARGIN) dx = VIEWPORT_MARGIN - rect.left;
    if (rect.bottom > height - VIEWPORT_MARGIN) dy = height - VIEWPORT_MARGIN - rect.bottom;
    if (rect.top + dy < VIEWPORT_MARGIN) dy = VIEWPORT_MARGIN - rect.top;
    if (dx !== 0 || dy !== 0) {
      const origin = (menu.offsetParent || element).getBoundingClientRect();
      if (dx !== 0) {
        menu.style.left = `${rect.left + dx - origin.left - (menu.offsetParent ? menu.offsetParent.clientLeft : 0)}px`;
        menu.style.right = 'auto';
      }
      if (dy !== 0) {
        menu.style.top = `${rect.top + dy - origin.top - (menu.offsetParent ? menu.offsetParent.clientTop : 0)}px`;
        menu.style.bottom = 'auto';
      }
    }
  }

  function openMenu(which = 'first') {
    if (open || destroyed) return;
    render();
    open = true;
    menu.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    place();
    const items = visibleEntries();
    focusElement((which === 'last' ? items[items.length - 1] : items[0]).node);

    const onPointerDown = (event) => {
      if (!contains(element, event.target)) closeMenu({ restoreFocus: false });
    };
    const onFocusIn = (event) => {
      if (!contains(element, event.target)) closeMenu({ restoreFocus: false });
    };
    const view = doc.defaultView;
    openListeners.push(on(doc, 'pointerdown', onPointerDown, true), on(doc, 'focusin', onFocusIn));
    // The computed position is stale after a resize; closing is simpler than recomputing under a moving user.
    if (view) openListeners.push(on(view, 'resize', () => closeMenu({ restoreFocus: false })));
  }

  function closeMenu({ restoreFocus }) {
    if (!open) return;
    open = false;
    for (const dispose of openListeners.splice(0)) dispose();
    menu.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    typeahead = { text: '', time: 0 };
    if (restoreFocus) focusElement(trigger);
  }

  function moveFocus(delta, absolute = null) {
    const items = visibleEntries();
    if (items.length === 0) return;
    const current = items.findIndex((entry) => entry.node === doc.activeElement);
    let next;
    if (absolute !== null) next = absolute === 'first' ? 0 : items.length - 1;
    else next = current === -1 ? 0 : (current + delta + items.length) % items.length;
    focusElement(items[next].node);
  }

  function matchTyped(event) {
    if (event.timeStamp - typeahead.time > TYPEAHEAD_RESET_MS) typeahead.text = '';
    typeahead = { text: typeahead.text + event.key.toLowerCase(), time: event.timeStamp };
    const items = visibleEntries();
    const current = items.findIndex((entry) => entry.node === doc.activeElement);
    for (let offset = 1; offset <= items.length; offset += 1) {
      const entry = items[(current + offset + items.length) % items.length];
      if (entry.labelNode.textContent.toLowerCase().startsWith(typeahead.text)) {
        focusElement(entry.node);
        return;
      }
    }
  }

  disposers.push(on(trigger, 'click', () => {
    if (open) closeMenu({ restoreFocus: false });
    else openMenu('first');
  }));
  disposers.push(on(trigger, 'keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (open) moveFocus(event.key === 'ArrowDown' ? 1 : -1);
      else openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
    }
  }));
  // Escape is handled on the whole part so it works from the trigger and from any item.
  disposers.push(on(element, 'keydown', (event) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu({ restoreFocus: true });
    }
  }));
  disposers.push(on(menu, 'keydown', (event) => {
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); moveFocus(1); break;
      case 'ArrowUp': event.preventDefault(); moveFocus(-1); break;
      case 'Home': event.preventDefault(); moveFocus(0, 'first'); break;
      case 'End': event.preventDefault(); moveFocus(0, 'last'); break;
      case 'Tab':
        // Focus goes back to the trigger first so the browser continues from there instead of from a hidden item.
        focusElement(trigger);
        closeMenu({ restoreFocus: false });
        break;
      default:
        if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) matchTyped(event);
    }
  }));

  /* ---------------------------------- dialog ---------------------------------- */
  let dialog = null;
  let titleNode = null;
  let bodyNode = null;
  let activePanel = null;

  function ensureDialog() {
    if (dialog) return;
    const candidate = createElement(doc, 'dialog', { class: 'chart-ui-dialog chart-ui-settings-dialog', 'aria-labelledby': `${prefix}-dialog-title` });
    if (typeof candidate.showModal !== 'function') {
      throw new InteractionError(controller.t('settings.dialogUnsupported'), { code: 'UNSUPPORTED_DOM', field: 'dialog' });
    }
    const frame = createElement(doc, 'div', { class: 'chart-ui-settings-dialog-frame' });
    const head = createElement(doc, 'div', { class: 'chart-ui-settings-dialog-head' });
    titleNode = createElement(doc, 'h2', { id: `${prefix}-dialog-title`, class: 'chart-ui-settings-dialog-title' });
    const closeButton = createElement(doc, 'button', { type: 'button', class: 'chart-ui-btn chart-ui-surface-btn chart-ui-settings-dialog-close' });
    append(closeButton, createIcon(doc, 'close', { size: 16 }), createElement(doc, 'span', {}, controller.t('settings.close')));
    append(head, titleNode, closeButton);
    bodyNode = createElement(doc, 'div', { class: 'chart-ui-settings-dialog-body' });
    append(frame, head, bodyNode);
    append(candidate, frame);
    append(element, candidate);
    dialog = candidate;
    disposers.push(on(closeButton, 'click', () => dialog.close()));
    // Backdrop clicks land on the dialog element itself; the frame fills the rest, so the target tells them apart.
    disposers.push(on(dialog, 'click', (event) => {
      if (event.target === dialog) dialog.close();
    }));
    // `close` fires for every way out (button, Escape, backdrop), so cleanup lives in one place.
    disposers.push(on(dialog, 'close', () => {
      releasePanel();
      focusElement(trigger);
    }));
  }

  function releasePanel() {
    if (!activePanel) return;
    const panel = activePanel;
    activePanel = null;
    panel.release();
  }

  function mountPanes() {
    const panel = createPanesPanel(controller, { document: doc, announce: (text, options) => controller.announce(text, options) });
    append(bodyNode, panel.element);
    return { release() { panel.destroy(); if (panel.element.parentNode) panel.element.parentNode.removeChild(panel.element); } };
  }

  function mountDerived() {
    const panel = createDerivedPanel(controller, { document: doc });
    append(bodyNode, panel.element);
    return { release() { panel.destroy(); if (panel.element.parentNode) panel.element.parentNode.removeChild(panel.element); } };
  }

  function mountDrawings() {
    const controls = createDrawingControls({
      chart: controller.chart,
      doc,
      host: bodyNode,
      interaction: controller.interaction,
      announce: (text, options) => controller.announce(text, options),
    });
    if (controls === null) {
      throw new InteractionError(controller.t('settings.formUnavailable'), { code: 'DRAWINGS_UNAVAILABLE', field: 'drawings' });
    }
    return { release() { controls.detach(); } };
  }

  function openDialog(item) {
    try {
      ensureDialog();
      releasePanel();
      titleNode.textContent = item.title;
      activePanel = item.mount();
      if (!dialog.open) dialog.showModal();
    } catch (error) {
      releasePanel();
      controller.announce(error.message, { error: true });
      throw error;
    }
  }

  /* -------------------------------- activation -------------------------------- */
  function activate(entry) {
    const disabled = entry.node.getAttribute('aria-disabled') === 'true';
    if (entry.dialog) {
      if (disabled) {
        controller.announce(entry.reasonNode.textContent);
        return;
      }
      closeMenu({ restoreFocus: false });
      openDialog(entry.dialog);
      return;
    }
    controller.run(entry.control);
    if (entry.control !== CROSSHAIR && !TOGGLES.includes(entry.control) && !disabled) closeMenu({ restoreFocus: true });
  }

  for (const entry of entries) {
    disposers.push(on(entry.node, 'click', () => activate(entry)));
  }

  render();
  disposers.push(controller.subscribe(STATE_KEYS, (changed) => {
    // Selection changes of a derived view arrive often; only its opener's presence matters here.
    if (changed.every((key) => key === 'derived')) {
      syncDerived();
      return;
    }
    if (open) render();
    else syncDerived();
  }));

  return {
    element,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const dispose of openListeners.splice(0)) dispose();
      for (const dispose of disposers.splice(0)) dispose();
      releasePanel();
      if (dialog && dialog.open) dialog.close();
    },
  };
}
