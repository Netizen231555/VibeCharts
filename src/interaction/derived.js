/**
 * Accessible model for derived views (baseline, Heikin Ashi, Renko, Kagi,
 * point & figure).
 *
 * Every element exposes its own stable id, its ordered source barIds and the
 * source values separately from the computed values. Renko/Kagi/P&F elements
 * live on their own independent sequence, may be several per source bar, and
 * are navigable one by one. Removing an element after a correction clears the
 * selection with an announcement and never jumps to a neighbouring element.
 */
import { InteractionError } from './errors.js';
import { createEmitter } from './emitter.js';

export const ABSENT = 'нет данных';

export const DERIVED_VIEW_KINDS = Object.freeze({
  BASELINE: 'baseline',
  HEIKIN_ASHI: 'heikinAshi',
  RENKO: 'renko',
  KAGI: 'kagi',
  POINT_AND_FIGURE: 'pointAndFigure',
});

const OWN_SCALE = new Set([DERIVED_VIEW_KINDS.RENKO, DERIVED_VIEW_KINDS.KAGI, DERIVED_VIEW_KINDS.POINT_AND_FIGURE]);

export function normalizeDerivedView(view) {
  if (!view || typeof view !== 'object') {
    throw new InteractionError('Derived view is required', { code: 'INVALID_DERIVED_VIEW', field: 'view' });
  }
  if (typeof view.kind !== 'string' || !Object.values(DERIVED_VIEW_KINDS).includes(view.kind)) {
    throw new InteractionError('Unknown derived view kind', { code: 'INVALID_DERIVED_VIEW', field: 'view.kind' });
  }
  const elements = Array.isArray(view.elements) ? view.elements : [];
  const seen = new Set();
  const normalized = elements.map((element, index) => {
    if (!element || typeof element.id !== 'string' || element.id.length === 0) {
      throw new InteractionError('Derived element id is required', { code: 'INVALID_DERIVED_VIEW', field: `view.elements[${index}].id` });
    }
    if (seen.has(element.id)) {
      throw new InteractionError(`Duplicate derived element id ${element.id}`, { code: 'INVALID_DERIVED_VIEW', field: 'view.elements.id' });
    }
    seen.add(element.id);
    return {
      id: element.id,
      order: Number.isInteger(element.order) ? element.order : index,
      sourceBarIds: Array.isArray(element.sourceBarIds) ? element.sourceBarIds.slice() : [],
      sourceValues: Array.isArray(element.sourceValues) ? element.sourceValues.map((entry) => ({ ...entry })) : [],
      computed: element.computed ? { ...element.computed } : null,
      direction: element.direction || null,
      visible: element.visible !== false,
    };
  });
  normalized.sort((a, b) => a.order - b.order);
  return {
    kind: view.kind,
    name: view.name || view.kind,
    parameters: view.parameters ? { ...view.parameters } : {},
    parametersText: view.parametersText || describeParameters(view.parameters),
    scale: view.scale || (OWN_SCALE.has(view.kind) ? 'own' : 'source'),
    elements: normalized,
  };
}

export function describeParameters(parameters) {
  if (!parameters || typeof parameters !== 'object') return '';
  return Object.entries(parameters)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}

function elementText(element, { name, parametersText, absent = ABSENT } = {}) {
  const rows = [
    { field: 'view', label: 'Вид', value: name },
    { field: 'parameters', label: 'Параметры', value: parametersText || absent, absent: !parametersText },
    { field: 'id', label: 'Идентификатор элемента', value: element.id },
    { field: 'sourceBarIds', label: 'Исходные слоты', value: element.sourceBarIds.length > 0 ? element.sourceBarIds.join(', ') : absent, absent: element.sourceBarIds.length === 0 },
  ];
  if (element.sourceValues.length === 0) {
    rows.push({ field: 'sourceValues', label: 'Исходные значения', value: absent, absent: true });
  } else {
    for (const entry of element.sourceValues) {
      const fields = Object.entries(entry)
        .filter(([key]) => key !== 'barId')
        .map(([key, value]) => `${key}=${value}`)
        .join(' ');
      rows.push({ field: `source:${entry.barId}`, label: `Исходный слот ${entry.barId}`, value: fields || absent, absent: !fields });
    }
  }
  if (!element.computed) {
    rows.push({ field: 'computed', label: 'Вычисленные значения', value: absent, absent: true });
  } else {
    const fields = Object.entries(element.computed)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    rows.push({ field: 'computed', label: 'Вычисленные значения', value: fields || absent, absent: !fields });
  }
  if (element.direction) rows.push({ field: 'direction', label: 'Направление', value: element.direction });
  return { id: element.id, rows, text: rows.map((row) => `${row.label}: ${row.value}`).join('; ') };
}

/**
 * `validateParameters` is supplied by the view owner; an invalid update is
 * announced and the previous valid view stays in place.
 */
export function createDerivedViewAccessibility({ view, validateParameters = null, onAnnounce = () => {} } = {}) {
  const emitter = createEmitter();
  let current = normalizeDerivedView(view);
  let selectedId = null;
  let visible = true;
  let color = view && view.color ? view.color : null;

  function element(id) {
    return current.elements.find((entry) => entry.id === id) || null;
  }

  function announce(type, payload) {
    onAnnounce({ type, ...payload });
    emitter.emit(type, payload);
  }

  function describeSelected() {
    if (selectedId === null) return null;
    const found = element(selectedId);
    if (!found) return null;
    return elementText(found, { name: current.name, parametersText: current.parametersText });
  }

  const model = {
    get view() {
      return { ...current, elements: current.elements.map((entry) => ({ ...entry })) };
    },
    get selectedId() {
      return selectedId;
    },
    get scale() {
      return current.scale;
    },
    get visible() {
      return visible;
    },
    get color() {
      return color;
    },
    subscribe(event, handler) {
      return emitter.on(event, handler);
    },
    select(id) {
      const found = element(id);
      if (!found) return { ok: false, code: 'UNKNOWN_ELEMENT', id };
      selectedId = id;
      const description = describeSelected();
      announce('selection', { id, description });
      return { ok: true, id, description };
    },
    next() {
      if (current.elements.length === 0) return { ok: false, code: 'EMPTY_VIEW' };
      const index = current.elements.findIndex((entry) => entry.id === selectedId);
      if (index < 0) return model.select(current.elements[0].id);
      if (index >= current.elements.length - 1) return { ok: false, code: 'AT_END' };
      return model.select(current.elements[index + 1].id);
    },
    prev() {
      if (current.elements.length === 0) return { ok: false, code: 'EMPTY_VIEW' };
      const index = current.elements.findIndex((entry) => entry.id === selectedId);
      if (index < 0) return model.select(current.elements[current.elements.length - 1].id);
      if (index <= 0) return { ok: false, code: 'AT_START' };
      return model.select(current.elements[index - 1].id);
    },
    /** Source bar maps to the last element completed by it, if any. */
    selectBySourceBar(barId) {
      let candidate = null;
      for (const entry of current.elements) {
        if (entry.sourceBarIds.includes(barId)) candidate = entry;
      }
      if (!candidate) return { ok: false, code: 'NO_MAPPING', barId };
      return model.select(candidate.id);
    },
    describe(id = selectedId) {
      if (id === null) return null;
      const found = element(id);
      if (!found) return null;
      return elementText(found, { name: current.name, parametersText: current.parametersText });
    },
    /** Recompute after a correction; a vanished selection is never replaced. */
    sync(nextView) {
      const next = normalizeDerivedView(nextView);
      const previousSelection = selectedId;
      current = next;
      if (previousSelection !== null && !next.elements.some((entry) => entry.id === previousSelection)) {
        selectedId = null;
        announce('selectionRemoved', { id: previousSelection, hadSlotSelection: true });
      }
      announce('viewChanged', { kind: current.kind, elementCount: current.elements.length });
      return { ok: true, selection: selectedId };
    },
    setParameters(parameters) {
      if (typeof validateParameters === 'function') {
        let result;
        try {
          result = validateParameters(parameters || {});
        } catch (error) {
          const field = error && error.field ? error.field : 'parameters';
          announce('invalidParameters', { field, message: error.message });
          return { ok: false, code: 'INVALID_PARAMETERS', field, message: error.message };
        }
        if (result === false) {
          announce('invalidParameters', { field: 'parameters', message: 'Параметры отклонены' });
          return { ok: false, code: 'INVALID_PARAMETERS', field: 'parameters' };
        }
      }
      current = { ...current, parameters: { ...(parameters || {}) }, parametersText: describeParameters(parameters) };
      announce('parameters', { parameters: { ...current.parameters } });
      return { ok: true, parameters: { ...current.parameters } };
    },
    setVisible(next) {
      visible = next === true;
      announce('visibility', { visible, state: visible ? 'показано' : 'скрыто' });
      return { ok: true, visible };
    },
    setColor(next) {
      if (typeof next !== 'string' || next.length === 0) {
        return { ok: false, code: 'INVALID_COLOR', field: 'color' };
      }
      color = next;
      announce('color', { color });
      return { ok: true, color };
    },
    controls() {
      return [
        { id: 'view', label: 'Вид графика', value: current.name, state: current.kind },
        { id: 'parameters', label: 'Параметры вида', value: current.parametersText || ABSENT, state: JSON.stringify(current.parameters) },
        { id: 'visible', label: 'Видимость меток', value: visible ? 'показано' : 'скрыто', state: visible ? 'true' : 'false' },
        { id: 'color', label: 'Цвет элементов', value: color || ABSENT, state: color || 'none' },
      ];
    },
    textAlternative() {
      if (current.elements.length === 0) {
        return { name: current.name, parametersText: current.parametersText, rows: [], text: `${current.name}: элементов нет` };
      }
      const rows = current.elements.map((entry) => elementText(entry, { name: current.name, parametersText: current.parametersText }));
      return { name: current.name, parametersText: current.parametersText, rows, text: rows.map((row) => row.text).join('\n') };
    },
  };
  return model;
}
