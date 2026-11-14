/**
 * Keyboard bindings, conflict rejection and crosshair slot navigation.
 *
 * Tab and unbound browser chords are never intercepted. Chords do not fire
 * while focus is inside a text field or another form control; `attachInteraction`
 * also requires the chart region itself to hold focus or be hit by the pointer.
 */
import { InteractionError } from './errors.js';

export const ABSENT_TEXT = 'нет данных';

const RESERVED_KEYS = new Set(['tab', 'space', 'backspace', 'browserback', 'browserforward']);

function reservedChord(chord, action) {
  const parts = chord.split('+').filter(Boolean);
  const key = parts.at(-1);
  if (parts.some((part) => ['ctrl', 'alt', 'meta'].includes(part))) return true;
  if (RESERVED_KEYS.has(key)) return true;
  if (/^f(?:[1-9]|1[0-2])$/.test(key)) return !(chord === 'shift+f10' && action === 'contextMenu');
  return chord === 'shift+f10' && action !== 'contextMenu';
}

export const DEFAULT_BINDINGS = Object.freeze({
  panLeft: 'arrowleft',
  panRight: 'arrowright',
  zoomIn: '+',
  zoomOut: '-',
  priceZoomIn: 'shift+arrowup',
  priceZoomOut: 'shift+arrowdown',
  priceAuto: 'home',
  follow: 'f',
  fitContent: 'r',
  toggleLogScale: 'l',
  cancel: 'escape',
  contextMenu: 'contextmenu',
  toggleCrosshair: 'c',
  // Shift+F10 must map to the same action; bindings allow one chord per action
  // plus explicit aliases handled by the resolver.
});

const ACTION_LABELS = Object.freeze({
  panLeft: 'Шаг влево по времени',
  panRight: 'Шаг вправо по времени',
  zoomIn: 'Увеличить масштаб',
  zoomOut: 'Уменьшить масштаб',
  priceZoomIn: 'Увеличить ценовой масштаб',
  priceZoomOut: 'Уменьшить ценовой масштаб',
  priceAuto: 'Автомасштаб цены активной панели',
  follow: 'Следование за реальным временем',
  fitContent: 'Показать все данные активной панели',
  toggleLogScale: 'Логарифмическая шкала цены',
  cancel: 'Отменить жест или построение',
  contextMenu: 'Открыть меню графика',
  toggleCrosshair: 'Перекрестие с клавиатуры',
  crosshairPrev: 'Предыдущий слот',
  crosshairNext: 'Следующий слот',
});

export function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

export function normalizeKeyName(key) {
  if (key === undefined || key === null) return null;
  if (key === ' ' || key === 'Spacebar') return 'space';
  const lower = String(key).toLowerCase();
  if (lower === 'esc') return 'escape';
  if (lower === 'del') return 'delete';
  return lower;
}

export function normalizeChord(chord) {
  if (typeof chord !== 'string') {
    throw new InteractionError('Key binding must be a string', { code: 'INVALID_BINDING', field: 'bindings' });
  }
  const raw = chord.trim();
  if (raw.length === 0) throw new InteractionError('Key binding must not be empty', { code: 'INVALID_BINDING', field: 'bindings' });
  // '+' and '-' are keys on their own; splitting must not eat them.
  if (raw === '+' || raw === '-') return raw;
  const parts = raw.split('+').filter((part) => part.length > 0);
  const modifiers = [];
  let key = null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') modifiers.push('ctrl');
    else if (lower === 'alt' || lower === 'option') modifiers.push('alt');
    else if (lower === 'shift') modifiers.push('shift');
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers.push('meta');
    else if (key === null) key = normalizeKeyName(part);
    else throw new InteractionError(`Invalid key binding ${chord}`, { code: 'INVALID_BINDING', field: 'bindings' });
  }
  if (key === null) {
    if (parts.length === 1 && raw === '+') return '+';
    throw new InteractionError(`Invalid key binding ${chord}`, { code: 'INVALID_BINDING', field: 'bindings' });
  }
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const unique = order.filter((modifier) => modifiers.includes(modifier));
  return [...unique, key].join('+');
}

export function chordFromEvent(event) {
  if (!event || typeof event.key !== 'string') return null;
  const key = normalizeKeyName(event.key);
  if (key === null) return null;
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('ctrl');
  if (event.altKey) modifiers.push('alt');
  // Shift is part of the character for punctuation keys such as '+' and '_'.
  if (event.shiftKey && key !== '+' && key !== '-') modifiers.push('shift');
  if (event.metaKey) modifiers.push('meta');
  const order = ['ctrl', 'alt', 'shift', 'meta'];
  const unique = order.filter((modifier) => modifiers.includes(modifier));
  return [...unique, key].join('+');
}

export function isEditableTarget(target) {
  if (!target || typeof target !== 'object') return false;
  for (let node = target; node && typeof node === 'object'; node = node.parentElement) {
    const tag = (node.tagName || '').toUpperCase();
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'BUTTON', 'SUMMARY'].includes(tag)) return true;
    if (node.isContentEditable === true) return true;
    const role = node.getAttribute ? node.getAttribute('role') : null;
    if (role && ['button', 'textbox', 'searchbox', 'spinbutton', 'combobox', 'slider', 'listbox', 'menu', 'menuitem', 'gridcell', 'treeitem'].includes(role)) return true;
  }
  return false;
}


/**
 * Keyboard binding table. Actions are exposed as identifiers; the caller wires
 * them to camera commands, cancellation and the context menu.
 */
export function createKeyboard({ bindings = {}, crosshair = null } = {}) {
  let table = new Map();
  let actionToChord = new Map();
  let crosshairActive = false;

  function apply(next) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) {
      throw new InteractionError('Keyboard bindings must be an object', { code: 'INVALID_BINDING', field: 'bindings' });
    }
    table = new Map();
    actionToChord = new Map();
    for (const [action, chord] of Object.entries(DEFAULT_BINDINGS)) actionToChord.set(action, chord);
    for (const [action, chord] of Object.entries(next || {})) {
      if (!Object.hasOwn(ACTION_LABELS, action)) {
        throw new InteractionError(`Unknown keyboard action ${action}`, { code: 'INVALID_BINDING', field: 'bindings', action });
      }
      if (chord === null || chord === undefined) actionToChord.delete(action);
      else actionToChord.set(action, normalizeChord(chord));
    }
    for (const [action, chord] of actionToChord) {
      if ((chord === 'shift+f10' || chord === 'contextmenu') && action !== 'contextMenu') {
        throw new InteractionError(`Key ${chord} is reserved for contextMenu`, { code: 'BINDING_CONFLICT', field: 'bindings', action, detail: { chord, conflictAction: 'contextMenu' } });
      }
      if (reservedChord(chord, action)) {
        throw new InteractionError(`Key ${chord} is reserved by the browser`, { code: 'BINDING_RESERVED', field: 'bindings', action });
      }
      if (table.has(chord)) {
        throw new InteractionError(`Key ${chord} is already assigned to ${table.get(chord)}`, {
          code: 'BINDING_CONFLICT',
          field: 'bindings',
          action,
          detail: { chord, conflictAction: table.get(chord) },
        });
      }
      table.set(chord, action);
    }
  }

  apply(bindings);

  function actionForChord(chord) {
    if (!chord) return null;
    if (table.has(chord)) return table.get(chord);
    // Shift+F10 is the standard keyboard context-menu key.
    if (chord === 'shift+f10' && [...table.values()].includes('contextMenu')) return 'contextMenu';
    return null;
  }

  const keyboard = {
    get crosshairActive() {
      return crosshairActive;
    },
    getBindings() {
      return Object.fromEntries(actionToChord.entries());
    },
    setBindings(overrides) {
      const previousTable = table;
      const previousActions = actionToChord;
      try {
        apply(overrides);
      } catch (error) {
        table = previousTable;
        actionToChord = previousActions;
        throw error;
      }
      return keyboard.getBindings();
    },
    resolveChord(chord) {
      return actionForChord(chord);
    },
    /**
     * Map a keydown to an action. Returns null when the chart must not consume
     * the event (Tab, editable focus, unbound chord, browser modifier shortcut).
     */
    resolveEvent(event, { target = null } = {}) {
      if (!event || event.defaultPrevented) return null;
      if (event.ctrlKey || event.metaKey || event.altKey) return null;
      if (isEditableTarget(target || event.target)) return null;
      const chord = chordFromEvent(event);
      if (!chord) return null;
      const action = actionForChord(chord);
      if (!action) return null;
      if (crosshairActive && (action === 'panLeft' || action === 'panRight')) {
        if (!crosshair) return null;
        const crosshairAction = action === 'panLeft' ? 'crosshairPrev' : 'crosshairNext';
        const result = action === 'panLeft' ? crosshair.prev() : crosshair.next();
        return { action: crosshairAction, result };
      }
      if (action === 'toggleCrosshair') {
        crosshairActive = !crosshairActive;
        if (!crosshairActive && crosshair) crosshair.clear();
        return { action: 'crosshairToggled', active: crosshairActive };
      }
      if (action === 'crosshairPrev' || action === 'crosshairNext') {
        if (!crosshair) return null;
        const result = action === 'crosshairPrev' ? crosshair.prev() : crosshair.next();
        return { action, result };
      }
      return action;
    },
    exitCrosshair() {
      crosshairActive = false;
      if (crosshair) crosshair.clear();
    },
    setCrosshairActive(active) {
      crosshairActive = active === true;
      if (!crosshairActive && crosshair) crosshair.clear();
      return crosshairActive;
    },
    labels: ACTION_LABELS,
  };
  return keyboard;
}

/**
 * Sequential navigation over existing slots in host order, independent of
 * whether slots carry time. Descriptions list only provided values.
 */
export function createCrosshairNavigation({ getSlots, getValues, describe: describeValue = null, onSelect = () => {}, absent = ABSENT_TEXT, isDerived = () => false, sourceBarId = (id) => id }) {
  let selectedBarId = null;

  function slots() {
    return getSlots();
  }

  function indexOf(barId) {
    if (barId === null) return -1;
    return slots().findIndex((slot) => slot.barId === barId);
  }

  function select(barId) {
    const index = indexOf(barId);
    if (index < 0) return { ok: false, code: 'UNKNOWN_BAR_ID', barId };
    selectedBarId = barId;
    const description = describe(barId);
    onSelect(description);
    return { ok: true, barId, index, description };
  }

  function describe(barId) {
    const slot = slots().find((entry) => entry.barId === barId);
    const derived = isDerived();
    // A derived element is not a time slot: it reports its source completion bar and no time.
    const rows = derived
      ? [{ field: 'derivedElementId', label: 'element', value: barId }, { field: 'barId', label: 'barId', value: sourceBarId(barId) ?? absent }]
      : [{ field: 'barId', label: 'barId', value: barId }];
    if (!derived) {
      if (slot && typeof slot.time === 'number' && Number.isFinite(slot.time)) {
        rows.push({ field: 'time', label: 'time', value: new Date(slot.time).toISOString() });
      } else {
        rows.push({ field: 'time', label: 'time', value: absent, absent: true });
      }
      if (slot && slot.sessionDate) {
        const { year, month, day } = slot.sessionDate;
        rows.push({ field: 'sessionDate', label: 'sessionDate', value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
      } else {
        rows.push({ field: 'sessionDate', label: 'sessionDate', value: absent, absent: true });
      }
    }
    const series = getValues(barId) || [];
    for (const entry of series) {
      if (!entry.values) {
        rows.push({ field: `series:${entry.seriesId}`, label: entry.seriesId, value: absent, absent: true });
        continue;
      }
      if (describeValue) {
        rows.push(...describeValue(entry, absent));
      } else if (Object.prototype.hasOwnProperty.call(entry.values, 'close')) {
        for (const field of ['open', 'high', 'low', 'close', 'volume']) {
          const value = entry.values[field];
          const present = typeof value === 'number' && Number.isFinite(value);
          rows.push({ field: `series:${entry.seriesId}:${field}`, label: field, value: present ? String(value) : absent, absent: !present });
        }
      } else {
        const value = entry.values.value;
        const present = typeof value === 'number' && Number.isFinite(value);
        rows.push({ field: `series:${entry.seriesId}:value`, label: 'value', value: present ? String(value) : absent, absent: !present });
      }
    }
    return { barId, rows, text: rows.map((row) => `${row.label}: ${row.value}`).join('; ') };
  }

  return {
    get selection() {
      return selectedBarId;
    },
    getSlots: slots,
    indexOf,
    select,
    describe,
    next() {
      const list = slots();
      if (list.length === 0) return { ok: false, code: 'EMPTY_TIMELINE' };
      const index = indexOf(selectedBarId);
      const target = index < 0 ? 0 : Math.min(list.length - 1, index + 1);
      if (target === index && index >= 0) return { ok: false, code: 'AT_END' };
      return select(list[target].barId);
    },
    prev() {
      const list = slots();
      if (list.length === 0) return { ok: false, code: 'EMPTY_TIMELINE' };
      const index = indexOf(selectedBarId);
      const target = index < 0 ? list.length - 1 : Math.max(0, index - 1);
      if (target === index && index >= 0) return { ok: false, code: 'AT_START' };
      return select(list[target].barId);
    },
    first() {
      const list = slots();
      if (list.length === 0) return { ok: false, code: 'EMPTY_TIMELINE' };
      return select(list[0].barId);
    },
    last() {
      const list = slots();
      if (list.length === 0) return { ok: false, code: 'EMPTY_TIMELINE' };
      return select(list[list.length - 1].barId);
    },
    clear() {
      selectedBarId = null;
      onSelect(null);
      return { ok: true };
    },
  };
}
