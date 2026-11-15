/**
 * The registry of drawing settings fields.
 *
 * A field is a frozen descriptor that says what can be edited, for which drawings and where it lives in the
 * document. Every drawing change contributes descriptors by adding one module to `index.js`; the model and the
 * dialog read the registry and never name a tool. Descriptors are validated when they are registered, so a broken
 * contribution fails at import and not when a user opens a dialog, and `seal()` proves that every drawing tool is
 * reached by some field, so a new tool cannot silently lack settings.
 */
import { InteractionError } from '../../interaction/errors.js';

export const DRAWING_SETTINGS_TABS = Object.freeze(['style', 'text', 'coordinates']);
export const FIELD_TYPES = Object.freeze(['color', 'number', 'boolean', 'select', 'text', 'levels', 'anchors']);

const ID = /^[A-Za-z][A-Za-z0-9.]*$/;

function bad(id, member, message, code = 'INVALID_DRAWING_SETTING_FIELD') {
  return new InteractionError(`Drawing settings field ${id}: ${member} ${message}`, { code, field: id, detail: { member } });
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function validateLimits(descriptor, hasMessage) {
  const { id, type } = descriptor;
  const limits = descriptor.limits ?? {};
  if (type === 'number') {
    if (!isFiniteNumber(limits.min) || !isFiniteNumber(limits.max) || !(limits.min < limits.max)) {
      throw bad(id, 'limits', 'needs finite min below max');
    }
    if (!isFiniteNumber(limits.step) || !(limits.step > 0)) throw bad(id, 'limits.step', 'must be a positive number');
    if (limits.integer !== undefined && typeof limits.integer !== 'boolean') throw bad(id, 'limits.integer', 'must be a boolean');
  } else if (type === 'select') {
    if (!Array.isArray(limits.options) || limits.options.length === 0) throw bad(id, 'limits.options', 'must be a non-empty list');
    const seen = new Set();
    for (const option of limits.options) {
      if (option === null || typeof option !== 'object' || typeof option.labelKey !== 'string') {
        throw bad(id, 'limits.options', 'entries need a value and a labelKey');
      }
      if (seen.has(option.value)) throw bad(id, 'limits.options', `repeats the value ${String(option.value)}`);
      seen.add(option.value);
      if (!hasMessage(option.labelKey)) throw bad(id, 'limits.options', `uses the label key ${option.labelKey} that has no English and Russian text`);
    }
  } else if (type === 'text') {
    if (limits.maxLength !== undefined && !(Number.isInteger(limits.maxLength) && limits.maxLength > 0)) {
      throw bad(id, 'limits.maxLength', 'must be a positive integer');
    }
    if (limits.multiline !== undefined && typeof limits.multiline !== 'boolean') throw bad(id, 'limits.multiline', 'must be a boolean');
  } else if (Object.keys(limits).length > 0) {
    throw bad(id, 'limits', `is not accepted by the ${type} type`);
  }
}

/** Throws unless `descriptor` is complete; returns the frozen normalized descriptor. */
export function normalizeDescriptor(descriptor, { tools, families, hasMessage }) {
  if (descriptor === null || typeof descriptor !== 'object') throw bad('?', 'descriptor', 'must be an object');
  const id = descriptor.id;
  if (typeof id !== 'string' || !ID.test(id)) throw bad(String(id), 'id', 'must be letters, digits and dots, starting with a letter');
  if (!DRAWING_SETTINGS_TABS.includes(descriptor.tab)) throw bad(id, 'tab', `must be one of ${DRAWING_SETTINGS_TABS.join(', ')}`);
  if (typeof descriptor.group !== 'string' || descriptor.group === '') throw bad(id, 'group', 'must be a non-empty string');
  if (!hasMessage(`drawingSettings.group.${descriptor.group}`)) {
    throw bad(id, 'group', `needs the message drawingSettings.group.${descriptor.group} in English and Russian`);
  }
  if (!Number.isInteger(descriptor.order)) throw bad(id, 'order', 'must be an integer');
  if (!FIELD_TYPES.includes(descriptor.type)) throw bad(id, 'type', `must be one of ${FIELD_TYPES.join(', ')}`);
  if (typeof descriptor.labelKey !== 'string' || !hasMessage(descriptor.labelKey)) {
    throw bad(id, 'labelKey', `${String(descriptor.labelKey)} has no English and Russian text`);
  }
  const applies = descriptor.appliesTo;
  if (applies === null || typeof applies !== 'object') throw bad(id, 'appliesTo', 'must list tools or families');
  const toolList = applies.tools ?? [];
  const familyList = applies.families ?? [];
  if (!Array.isArray(toolList) || !Array.isArray(familyList) || toolList.length + familyList.length === 0) {
    throw bad(id, 'appliesTo', 'needs at least one tool or family');
  }
  for (const tool of toolList) if (!tools.has(tool)) throw bad(id, 'appliesTo.tools', `names the unknown tool ${String(tool)}`);
  for (const family of familyList) if (!families.has(family)) throw bad(id, 'appliesTo.families', `names the unknown family ${String(family)}`);
  const hasPath = descriptor.path !== undefined;
  const hasAccessors = descriptor.read !== undefined || descriptor.patch !== undefined;
  if (hasPath === hasAccessors) throw bad(id, 'path', 'or the pair read and patch must be given, exactly one of them');
  if (hasPath) {
    if (!Array.isArray(descriptor.path) || descriptor.path.length < 2 || descriptor.path.some((key) => typeof key !== 'string') ||
        !['style', 'props'].includes(descriptor.path[0])) {
      throw bad(id, 'path', 'must be an array of keys below style or props');
    }
  } else if (typeof descriptor.read !== 'function' || typeof descriptor.patch !== 'function') {
    throw bad(id, 'read', 'and patch must both be functions');
  }
  validateLimits(descriptor, hasMessage);
  for (const member of ['validate', 'visibleWhen', 'enabledWhen']) {
    if (descriptor[member] !== undefined && typeof descriptor[member] !== 'function') throw bad(id, member, 'must be a function');
  }
  if (descriptor.multi !== undefined && typeof descriptor.multi !== 'boolean') throw bad(id, 'multi', 'must be a boolean');
  const frozenOptions = descriptor.limits?.options ? Object.freeze(descriptor.limits.options.map((option) => Object.freeze({ ...option }))) : undefined;
  return Object.freeze({
    ...descriptor,
    multi: descriptor.multi ?? true,
    appliesTo: Object.freeze({ tools: Object.freeze([...toolList]), families: Object.freeze([...familyList]) }),
    ...(descriptor.path ? { path: Object.freeze([...descriptor.path]) } : {}),
    ...(descriptor.limits ? { limits: Object.freeze({ ...descriptor.limits, ...(frozenOptions ? { options: frozenOptions } : {}) }) } : {}),
  });
}

export function fieldApplies(descriptor, drawing, tools) {
  return descriptor.appliesTo.tools.includes(drawing.type) || descriptor.appliesTo.families.includes(tools[drawing.type]?.family);
}

/**
 * @param {{ tools: Record<string, {family: string}>, families: string[], hasMessage: (key: string) => boolean }} context
 */
export function createFieldRegistry({ tools, families, hasMessage }) {
  const context = { tools: new Set(Object.keys(tools)), families: new Set(families), hasMessage };
  const fields = new Map();
  const owners = new Map();
  let sorted = null;
  let sealed = false;

  function register(descriptor, owner = 'unknown') {
    if (sealed) throw bad(String(descriptor?.id), 'registration', 'comes after the registry was sealed', 'DRAWING_SETTINGS_SEALED');
    const normalized = normalizeDescriptor(descriptor, context);
    if (fields.has(normalized.id)) {
      throw bad(normalized.id, 'id', `is already registered by ${owners.get(normalized.id)} and again by ${owner}`, 'DUPLICATE_DRAWING_SETTING_FIELD');
    }
    fields.set(normalized.id, Object.freeze({ ...normalized, sequence: fields.size }));
    owners.set(normalized.id, owner);
    sorted = null;
    return normalized;
  }

  /** Tab, then group by the lowest `order` among its fields, then `order`, ties by registration order. */
  function list() {
    if (sorted) return sorted;
    const groupOrder = new Map();
    for (const field of fields.values()) {
      const key = `${field.tab}\u0000${field.group}`;
      groupOrder.set(key, Math.min(groupOrder.get(key) ?? Infinity, field.order));
    }
    const tabIndex = (tab) => DRAWING_SETTINGS_TABS.indexOf(tab);
    sorted = Object.freeze([...fields.values()].sort((a, b) =>
      tabIndex(a.tab) - tabIndex(b.tab)
      || groupOrder.get(`${a.tab}\u0000${a.group}`) - groupOrder.get(`${b.tab}\u0000${b.group}`)
      || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0)
      || a.order - b.order
      || a.sequence - b.sequence));
    return sorted;
  }

  /** Ends registration and proves that every tool has a covering field; runs once, at module load. */
  function seal() {
    const uncovered = Object.keys(tools).filter((tool) => ![...fields.values()].some((field) => fieldApplies(field, { type: tool }, tools)));
    if (uncovered.length > 0) {
      throw new InteractionError(`No drawing settings field covers: ${uncovered.join(', ')}`, {
        code: 'DRAWING_SETTINGS_COVERAGE', field: 'DRAWING_TOOLS', detail: { tools: uncovered },
      });
    }
    sealed = true;
  }

  return { register, list, seal, get: (id) => fields.get(id) ?? null, owner: (id) => owners.get(id) ?? null };
}
