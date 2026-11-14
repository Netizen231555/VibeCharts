/**
 * Pane management panel: order, visibility and height of the chart panes.
 *
 * Not a layout part: the settings menu mounts it in a modal dialog when the
 * dialog opens and calls `destroy()` when it closes. Pane data and actions come
 * only from the controller; every refusal is announced and the control that
 * cannot act says why.
 */
import { append, clearElement, createElement, focusElement } from '../../interaction/dom.js';

const KEYBOARD_STEP = 8;
const KEYBOARD_BIG_STEP_FACTOR = 4;
const KEYBOARD_END_DELTA = 320;

// Several panels may exist in one document (one per open dialog over time); ids of described-by text must not collide.
let instanceCounter = 0;

export function createPanesPanel(controller, { document: doc, announce } = {}) {
  const say = typeof announce === 'function' ? announce : (text, options) => controller.announce(text, options);
  instanceCounter += 1;
  const uid = `chart-ui-panes-${instanceCounter}`;

  const element = createElement(doc, 'section', {
    class: 'chart-ui-panel chart-ui-panel-panes',
    'aria-label': controller.t('panes.label'),
    tabindex: '-1',
  });
  const list = createElement(doc, 'div', { class: 'chart-ui-panel-list' });
  append(element, createElement(doc, 'h3', { class: 'chart-ui-panel-title' }, controller.t('panes.title')), list);

  // Controls of the current render by key; a rebuild keeps focus by looking the same key up again.
  const focusables = new Map();
  let lastFocusedPaneId = null;
  let destroyed = false;

  function paneApi() {
    return controller.panes.api();
  }

  function focusedKey() {
    const active = doc.activeElement;
    if (!active) return null;
    for (const [key, node] of focusables) {
      if (node === active) return key;
    }
    return null;
  }

  // Pane ids may contain ':', so the kind is always the part before the first one.
  function key(kind, id) {
    return `${kind}:${id}`;
  }

  function usable(node) {
    return Boolean(node) && !node.hasAttribute('disabled');
  }

  function restoreFocus(keys) {
    for (const key of keys) {
      const node = focusables.get(key);
      if (usable(node)) {
        focusElement(node);
        return;
      }
    }
    // The focused control vanished or became disabled; keep focus inside the panel instead of dropping it to the page.
    focusElement(element);
  }

  // A disabled button is skipped by assistive technology navigation, so its reason is also rendered as text.
  function disable(button, reasonId, reason) {
    button.setAttribute('disabled', '');
    button.setAttribute('title', reason);
    button.setAttribute('aria-describedby', reasonId);
    return createElement(doc, 'span', { id: reasonId, class: 'chart-ui-sr chart-ui-panel-reason' }, reason);
  }

  function render() {
    if (destroyed) return;
    const previousKey = focusedKey();
    clearElement(list);
    focusables.clear();
    const panes = controller.panes.list();
    if (panes.length === 0) {
      append(list, createElement(doc, 'p', {}, controller.t('panes.none')));
      element.removeAttribute('data-panes-scroll');
      return;
    }
    const api = paneApi();
    const needsScroll = Boolean(api && typeof api.needsScroll === 'function' && api.needsScroll());
    element.setAttribute('data-panes-scroll', needsScroll ? 'true' : 'false');
    const visible = panes.filter((pane) => pane.visible);
    for (let index = 0; index < panes.length; index += 1) {
      const pane = panes[index];
      append(list, buildRow(pane, index, panes.length, visible.length));
      if (pane.visible && visible[visible.length - 1].id !== pane.id) append(list, buildSeparator(pane));
    }
    if (previousKey) {
      // Moving a pane to a boundary disables the pressed arrow; the opposite one takes the focus.
      const split = previousKey.indexOf(':');
      const kind = previousKey.slice(0, split);
      const id = previousKey.slice(split + 1);
      const opposite = kind === 'up' ? key('down', id) : kind === 'down' ? key('up', id) : null;
      restoreFocus(opposite ? [previousKey, opposite] : [previousKey]);
    }
  }

  function buildRow(pane, index, count, visibleCount) {
    const row = createElement(doc, 'div', { class: 'chart-ui-panel-row', role: 'group', 'aria-label': controller.t('panes.rowAria', { id: pane.id }) });
    append(row, createElement(doc, 'span', { class: 'chart-ui-panel-name' }, pane.id));
    const buttonClass = 'chart-ui-btn chart-ui-surface-btn chart-ui-panel-btn';

    // Reason text follows its button so the reading order stays "control, why it is off".
    const reasons = [];
    const up = createElement(doc, 'button', { type: 'button', class: buttonClass, 'aria-label': controller.t('panes.moveUpAria', { id: pane.id }) }, controller.t('panes.up'));
    focusables.set(key('up', pane.id), up);
    if (index === 0) {
      reasons.push(disable(up, `${uid}-${index}-up`, controller.t('panes.alreadyFirst')));
    } else {
      up.addEventListener('click', () => paneApi().move(pane.id, -1));
    }
    const down = createElement(doc, 'button', { type: 'button', class: buttonClass, 'aria-label': controller.t('panes.moveDownAria', { id: pane.id }) }, controller.t('panes.down'));
    focusables.set(key('down', pane.id), down);
    if (index === count - 1) {
      reasons.push(disable(down, `${uid}-${index}-down`, controller.t('panes.alreadyLast')));
    } else {
      down.addEventListener('click', () => paneApi().move(pane.id, 1));
    }
    append(row, up, down, ...reasons.splice(0));

    const visibilityLabel = controller.t(pane.visible ? 'panes.hide' : 'panes.show', { id: pane.id });
    const visibility = createElement(
      doc,
      'button',
      { type: 'button', class: buttonClass, 'aria-pressed': pane.visible ? 'true' : 'false', 'aria-label': visibilityLabel },
      visibilityLabel,
    );
    focusables.set(key('vis', pane.id), visibility);
    if (pane.visible && visibleCount <= 1) {
      reasons.push(disable(visibility, `${uid}-${index}-vis`, controller.t('panes.lastVisible')));
    } else {
      visibility.addEventListener('click', () => toggleVisibility(pane, visibility));
    }
    append(row, visibility, ...reasons);

    if (!pane.visible) {
      const restoreLabel = controller.t('panes.restore', { id: pane.id });
      const restore = createElement(doc, 'button', {
        type: 'button',
        class: buttonClass,
        id: `pane-restore:${pane.id}`,
        'aria-label': restoreLabel,
      }, restoreLabel);
      restore.addEventListener('click', () => {
        const restoreApi = paneApi();
        if (restoreApi) restoreApi.show(pane.id);
        render();
        focusElement(element);
      });
      focusables.set(key('pane-restore', pane.id), restore);
      append(row, restore);
      const registering = paneApi();
      if (registering && typeof registering.registerRestoreControl === 'function') registering.registerRestoreControl(pane.id, restore);
    }
    row.addEventListener('focusin', () => {
      lastFocusedPaneId = pane.id;
    });
    return row;
  }

  function toggleVisibility(pane, button) {
    const restoreFocusAfter = doc.activeElement === button;
    lastFocusedPaneId = pane.id;
    const api = paneApi();
    if (!api) return;
    const result = pane.visible ? api.hide(pane.id) : api.show(pane.id);
    if (result && result.ok === false && result.reason) {
      say(result.reason);
    } else if (result && result.ok && !result.visible) {
      say(controller.t('panes.hidden', { id: pane.id }));
    } else if (result && result.ok && result.visible) {
      say(controller.t('panes.shown', { id: pane.id }));
    }
    render();
    if (result && (result.focusId || (result.ok && !result.visible && restoreFocusAfter))) {
      const target = focusables.get(result.focusId || `pane-restore:${pane.id}`);
      if (target) focusElement(target);
      else if (lastFocusedPaneId === pane.id) focusElement(element);
    }
  }

  function buildSeparator(pane) {
    const separator = createElement(doc, 'div', {
      role: 'separator',
      tabindex: '0',
      'aria-orientation': 'horizontal',
      'aria-label': controller.t('panes.resizeAria', { id: pane.id }),
      'aria-valuemin': String(pane.minHeight),
      'aria-valuenow': String(pane.height),
      'aria-valuetext': controller.t('panes.height', { height: pane.height }),
      class: 'chart-ui-panel-separator',
    });
    focusables.set(key('sep', pane.id), separator);
    attachSeparator(separator, pane);
    return separator;
  }

  function attachSeparator(separator, pane) {
    let dragging = null;
    const update = (height) => {
      separator.setAttribute('aria-valuenow', String(Math.round(height)));
      separator.setAttribute('aria-valuetext', controller.t('panes.heightMin', { height: Math.round(height), min: pane.minHeight }));
    };
    separator.addEventListener('pointerdown', (event) => {
      const api = paneApi();
      if (!api || typeof api.beginResize !== 'function') return;
      api.beginResize(pane.id);
      dragging = { startY: event.clientY || 0, startHeight: pane.height, pointerId: event.pointerId };
      if (typeof separator.setPointerCapture === 'function') separator.setPointerCapture(event.pointerId);
      if (typeof event.preventDefault === 'function') event.preventDefault();
    });
    separator.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const next = dragging.startHeight + ((event.clientY || 0) - dragging.startY);
      const result = paneApi().previewResize(pane.id, next);
      if (result.ok && typeof result.height === 'number') update(result.height);
      if (typeof event.preventDefault === 'function') event.preventDefault();
    });
    separator.addEventListener('pointerup', (event) => {
      if (!dragging) return;
      dragging = null;
      const api = paneApi();
      if (typeof separator.releasePointerCapture === 'function') separator.releasePointerCapture(event.pointerId);
      const result = api.commitResize();
      if (result && result.ok && result.panes) say(controller.t('panes.resized', { id: pane.id }));
      render();
    });
    const cancel = () => {
      if (!dragging) return;
      dragging = null;
      const api = paneApi();
      if (api) api.cancelResize();
      say(controller.t('panes.resizeCancelled'));
      render();
    };
    separator.addEventListener('pointercancel', cancel);
    separator.addEventListener('lostpointercapture', cancel);
    separator.addEventListener('keydown', (event) => {
      const api = paneApi();
      if (!api) return;
      if (event.key === 'Escape') {
        if (api.cancelResize) api.cancelResize();
        say(controller.t('panes.resizeCancelled'));
        render();
        if (typeof event.preventDefault === 'function') event.preventDefault();
        return;
      }
      let delta = null;
      if (event.key === 'ArrowUp') delta = -KEYBOARD_STEP * (event.shiftKey ? KEYBOARD_BIG_STEP_FACTOR : 1);
      if (event.key === 'ArrowDown') delta = KEYBOARD_STEP * (event.shiftKey ? KEYBOARD_BIG_STEP_FACTOR : 1);
      if (event.key === 'Home') delta = -pane.height;
      if (event.key === 'End') delta = KEYBOARD_END_DELTA;
      if (delta === null) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      const result = api.resizeByKeyboard(pane.id, delta);
      if (result.ok) {
        update(result.height);
        say(result.announcement && result.announcement.text ? result.announcement.text : controller.t('panes.heightAnnounce', { height: result.height }));
        render();
      } else {
        say(controller.t('panes.limit'));
      }
    });
    separator.addEventListener('focus', () => {
      lastFocusedPaneId = pane.id;
    });
  }

  render();
  const unsubscribe = controller.subscribe('panes', render);

  return {
    element,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      unsubscribe();
      focusables.clear();
      clearElement(list);
    },
  };
}
