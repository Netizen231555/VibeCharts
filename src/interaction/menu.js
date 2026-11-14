/**
 * Context menu model for the chart, its axes and its panes.
 *
 * The menu offers navigation and presentation actions only: fitting content,
 * returning to real time, price auto-scale, price scale side/inversion/log
 * mode and pane visibility/order. What is offered depends on the target kind
 * and an action that cannot work there is omitted, not shown disabled: the
 * menu stays short and every entry it shows acts.
 */
import { InteractionError } from './errors.js';
import { createEmitter } from './emitter.js';
import { translate } from './messages.js';

export const MENU_ACTION_IDS = Object.freeze([
  'fitContent',
  'scrollToRealTime',
  'priceAutoScale',
  'priceScaleLeft',
  'priceScaleRight',
  'invertPriceScale',
  'toggleLogScale',
  'hidePane',
  'movePaneUp',
  'movePaneDown',
]);

function hasPane(target) {
  return target && typeof target.paneId === 'string' && target.paneId.length > 0;
}

/**
 * @returns {Array<{id:string,label:string,checked?:boolean}>} possibly empty: the caller shows no menu then
 */
export function buildMenuItems({ target, capabilities = {}, locale } = {}) {
  if (!target || typeof target !== 'object') {
    throw new InteractionError('Context menu requires a hit-test target', { code: 'INVALID_MENU_TARGET', field: 'target' });
  }
  const paneTarget = hasPane(target);
  const ids = [];
  switch (target.kind) {
    case 'priceAxis': {
      if (!paneTarget || typeof target.scaleId !== 'string') break;
      ids.push('priceAutoScale');
      if (capabilities.canSetPriceScale === true) {
        // Only the side the scale is not on: the current side needs no action.
        ids.push(target.side === 'left' ? 'priceScaleRight' : 'priceScaleLeft', 'invertPriceScale');
      }
      // A percent scale owns its base; the log toggle does not apply to it.
      if (capabilities.priceMode === 'linear' || capabilities.priceMode === 'log') ids.push('toggleLogScale');
      break;
    }
    case 'indexAxis':
      ids.push('fitContent', 'scrollToRealTime');
      break;
    case 'plot':
    case 'drawing':
      ids.push('fitContent', 'scrollToRealTime');
      if (paneTarget) ids.push('priceAutoScale');
      break;
    default:
      ids.push('fitContent', 'scrollToRealTime');
  }
  if (paneTarget && capabilities.visiblePaneCount > 1) {
    if (capabilities.canHidePane !== false) ids.push('hidePane');
    if (capabilities.canMoveUp === true) ids.push('movePaneUp');
    if (capabilities.canMoveDown === true) ids.push('movePaneDown');
  }
  return ids.map((id) => {
    const item = { id, label: translate(locale, `menu.${id}`) };
    if (id === 'invertPriceScale') item.checked = target.inverted === true;
    if (id === 'toggleLogScale') item.checked = capabilities.priceMode === 'log';
    return item;
  });
}

export function createContextMenu({ target, items, actions = {}, isAvailable = () => true, onClose = () => {}, locale } = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new InteractionError('Context menu requires items', { code: 'INVALID_MENU', field: 'items' });
  }
  const emitter = createEmitter();
  let open = true;
  let focusIndex = 0;
  let invokerId = null;

  function moveFocus(direction) {
    const next = Math.min(items.length - 1, Math.max(0, focusIndex + Math.sign(direction || 1)));
    focusIndex = next;
    emitter.emit('focus', { index: focusIndex, item: items[focusIndex] });
    return items[focusIndex];
  }

  function close({ reason = 'close', neighborId = null } = {}) {
    if (!open) return { closed: false };
    open = false;
    let focusId = null;
    if (invokerId && isAvailable(invokerId)) focusId = invokerId;
    else if (neighborId) focusId = neighborId;
    onClose({ reason, focusId });
    emitter.emit('close', { reason, focusId });
    return { closed: true, focusId };
  }

  const menu = {
    get open() {
      return open;
    },
    get target() {
      return target;
    },
    get items() {
      return items.map((item) => ({ ...item }));
    },
    get focusIndex() {
      return focusIndex;
    },
    get invokerId() {
      return invokerId;
    },
    setInvoker(id) {
      invokerId = id;
      return menu;
    },
    subscribe(event, handler) {
      return emitter.on(event, handler);
    },
    focus(index) {
      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        throw new InteractionError('Invalid menu focus index', { code: 'INVALID_MENU_FOCUS', field: 'index' });
      }
      focusIndex = index;
      emitter.emit('focus', { index, item: items[index] });
      return items[index];
    },
    moveFocus,
    first() {
      focusIndex = 0;
      return items[0];
    },
    last() {
      focusIndex = items.length - 1;
      return items[items.length - 1];
    },
    run(id) {
      const index = items.findIndex((item) => item.id === id);
      if (index < 0) throw new InteractionError(`Unknown menu action ${id}`, { code: 'UNKNOWN_MENU_ACTION', field: 'id', action: id });
      const item = items[index];
      const action = actions[id];
      if (typeof action !== 'function') {
        return { ok: false, code: 'ACTION_UNAVAILABLE', id, reason: translate(locale, 'menu.actionNotConnected') };
      }
      const result = action({ target, item });
      close({ reason: 'action' });
      return { ok: true, id, result };
    },
    activateFocused() {
      const item = items[focusIndex];
      return menu.run(item.id);
    },
    close({ reason = 'close', neighborId = null } = {}) {
      return close({ reason, neighborId });
    },
    handleKey(key) {
      switch (key) {
        case 'ArrowDown':
          menu.moveFocus(1);
          return { handled: true, focusIndex };
        case 'ArrowUp':
          menu.moveFocus(-1);
          return { handled: true, focusIndex };
        case 'Home':
          menu.first();
          return { handled: true, focusIndex };
        case 'End':
          menu.last();
          return { handled: true, focusIndex };
        case 'Enter':
        case ' ':
        case 'Space':
          return { handled: true, result: menu.activateFocused(), focusIndex };
        case 'Escape':
          return { handled: true, ...close({ reason: 'escape' }) };
        default:
          return { handled: false };
      }
    },
    targetRemoved(neighborId = null) {
      if (!open) return { closed: false };
      const result = close({ reason: 'target-removed', neighborId });
      return { ...result, actionApplied: false };
    },
  };
  return menu;
}
