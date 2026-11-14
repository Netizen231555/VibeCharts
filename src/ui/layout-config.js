/**
 * Declarative chart UI layout: parts placed in regions, presets, and the
 * validation that runs before anything is mounted.
 *
 * `validateLayout` is pure. Beyond shape checks it proves the accessibility
 * invariant: every UI action keeps at least one way to be invoked without a
 * pointer (a control in a mounted part, a keyboard binding, a context-menu
 * entry) unless the host removes it on purpose with `without`.
 */
import { InteractionError } from '../interaction/errors.js';

export const REGIONS = Object.freeze(['top', 'start', 'overlay', 'bottom', 'menu']);

/**
 * Built-in parts: where each may be placed and which controls it contains.
 * A `controls` entry ending in `:` matches every control id with that prefix.
 * `accessibleControls` are contained only when the UI option `accessibleActions`
 * is on: the settings menu then lists keyboard-equivalent actions too.
 */
export const BUILTIN_PARTS = Object.freeze({
  topBar: Object.freeze({ regions: Object.freeze(['top']), controls: Object.freeze(['chartType:', 'indicator:', 'interval', 'undo', 'redo']) }),
  drawingRail: Object.freeze({ regions: Object.freeze(['start']), controls: Object.freeze(['tool:', 'clearDrawings']) }),
  navCluster: Object.freeze({ regions: Object.freeze(['overlay']), controls: Object.freeze(['zoomIn', 'zoomOut', 'fitContent', 'scrollToRealTime', 'priceAuto']) }),
  settingsMenu: Object.freeze({
    regions: Object.freeze(['menu', 'top']),
    controls: Object.freeze(['theme', 'accessibleTable', 'follow', 'logScale', 'drawingSnap']),
    accessibleControls: Object.freeze(['crosshair', 'panLeft', 'panRight', 'priceZoomIn', 'priceZoomOut', 'crosshairPrev', 'crosshairNext']),
  }),
  statusLine: Object.freeze({ regions: Object.freeze(['bottom', 'top']), controls: Object.freeze([]) }),
  dataTable: Object.freeze({ regions: Object.freeze(['bottom']), controls: Object.freeze([]) }),
});

function freezeLayout(layout) {
  for (const key of Object.keys(layout)) Object.freeze(layout[key]);
  return Object.freeze(layout);
}

export const PRESETS = Object.freeze({
  full: freezeLayout({
    top: ['topBar'],
    start: ['drawingRail'],
    overlay: ['navCluster'],
    menu: ['settingsMenu'],
    bottom: ['statusLine', 'dataTable'],
    without: [],
  }),
  // Tiles: status, a menu button and the chart itself. Controls that need a bigger surface are removed on purpose.
  compact: freezeLayout({
    top: [],
    start: [],
    overlay: [],
    menu: ['settingsMenu'],
    bottom: ['statusLine'],
    without: ['chartType:', 'indicator:', 'tool:', 'clearDrawings', 'undo', 'redo', 'interval', 'accessibleTable'],
  }),
});

export const DEFAULT_CHART_LAYOUT = PRESETS.full;

/** Controls that only exist for some hosts. */
const OPTIONAL_CONTROLS = Object.freeze(['interval']);

function invalid(message, field, details = {}) {
  return new InteractionError(message, { code: 'INVALID_LAYOUT', field, ...details });
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function matches(pattern, id) {
  return pattern.endsWith(':') ? id.startsWith(pattern) : id === pattern;
}

/**
 * Normalizes a custom part given as a factory function or `{ create, regions, controls }`.
 * @returns {{ id: string, create: Function, regions: readonly string[], controls: readonly string[], builtin: boolean }}
 */
export function normalizePart(id, spec, field) {
  if (typeof spec === 'function') return { id, create: spec, regions: REGIONS, controls: [], builtin: false };
  if (!isPlainObject(spec) || typeof spec.create !== 'function') {
    throw invalid(`Part "${id}" must be a function or an object with create()`, field);
  }
  const regions = spec.regions === undefined ? REGIONS : spec.regions;
  if (!Array.isArray(regions) || regions.some((region) => !REGIONS.includes(region))) {
    throw invalid(`Part "${id}" has invalid regions`, `${field}.regions`);
  }
  const controls = spec.controls === undefined ? [] : spec.controls;
  if (!Array.isArray(controls) || controls.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw invalid(`Part "${id}" has invalid controls`, `${field}.controls`);
  }
  return { id, create: spec.create, regions, controls, builtin: false };
}

/**
 * @param {string|object|undefined} input preset name, layout object or undefined for the default
 * @param {{ parts?: Record<string, Function|object>, access?: Array<{id:string,keyboard:any,menu:any}>, accessibleActions?: boolean }} context
 *   `parts` — host parts, replacing built-ins of the same id; `access` — `controller.actions()`;
 *   `accessibleActions` — the UI option that adds keyboard-equivalent actions to the settings menu
 * @returns {{ regions: Record<string, string[]>, parts: Map<string, object>, omitted: string[], without: string[], uncovered: string[] }}
 */
export function validateLayout(input, { parts = {}, access = [], accessibleActions = false } = {}) {
  let layout = input === undefined ? DEFAULT_CHART_LAYOUT : input;
  if (typeof layout === 'string') {
    if (!Object.prototype.hasOwnProperty.call(PRESETS, layout)) throw invalid(`Unknown layout preset "${layout}"`, 'layout');
    layout = PRESETS[layout];
  }
  if (!isPlainObject(layout)) throw invalid('layout must be a preset name or an object', 'layout');
  if (!isPlainObject(parts)) throw invalid('parts must be an object', 'parts');

  for (const key of Object.keys(layout)) {
    if (!REGIONS.includes(key) && key !== 'without') throw invalid(`Unknown layout region "${key}"`, `layout.${key}`);
  }

  const known = new Map(Object.entries(BUILTIN_PARTS).map(([id, meta]) => [id, {
    id,
    create: null,
    regions: meta.regions,
    controls: accessibleActions && meta.accessibleControls ? [...meta.controls, ...meta.accessibleControls] : meta.controls,
    builtin: true,
  }]));
  for (const [id, spec] of Object.entries(parts)) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)) throw invalid(`Invalid part id "${id}"`, `parts.${id}`);
    const normalized = normalizePart(id, spec, `parts.${id}`);
    const builtin = known.get(id);
    // Replacing a built-in keeps its placement rules unless the host declares its own.
    if (builtin && typeof spec === 'function') normalized.regions = builtin.regions;
    known.set(id, normalized);
  }

  const regions = {};
  const mounted = new Map();
  for (const region of REGIONS) {
    const list = layout[region] === undefined ? [] : layout[region];
    if (!Array.isArray(list)) throw invalid(`layout.${region} must be an array of part ids`, `layout.${region}`);
    regions[region] = [];
    list.forEach((partId, index) => {
      const field = `layout.${region}[${index}]`;
      if (typeof partId !== 'string') throw invalid('A part id must be a string', field);
      const part = known.get(partId);
      if (!part) throw invalid(`Unknown part "${partId}"`, field);
      if (!part.regions.includes(region)) throw invalid(`Part "${partId}" cannot be placed in "${region}"`, field);
      if (mounted.has(partId)) throw invalid(`Part "${partId}" is placed more than once`, field);
      mounted.set(partId, part);
      regions[region].push(partId);
    });
  }

  const without = layout.without === undefined ? [] : layout.without;
  if (!Array.isArray(without)) throw invalid('layout.without must be an array of control ids', 'layout.without');
  without.forEach((entry, index) => {
    const field = `layout.without[${index}]`;
    if (typeof entry !== 'string' || entry.length === 0) throw invalid('A removed control id must be a non-empty string', field);
    // `interval` exists only when the host supplied intervals; removing it in advance is legitimate.
    if (access.length > 0 && !OPTIONAL_CONTROLS.includes(entry) && !access.some((item) => matches(entry, item.id))) throw invalid(`Unknown control "${entry}"`, field);
  });

  const uncovered = access
    .filter((item) => item.keyboard === null && item.menu === null)
    .filter((item) => ![...mounted.values()].some((part) => part.controls.some((pattern) => matches(pattern, item.id))))
    .filter((item) => !without.some((pattern) => matches(pattern, item.id)))
    .map((item) => item.id);
  if (uncovered.length > 0) {
    throw invalid(`No way to invoke: ${uncovered.join(', ')}. Add a part that contains them or list them in layout.without`, 'layout', { detail: { actions: uncovered } });
  }

  const omitted = Object.keys(BUILTIN_PARTS).filter((id) => !mounted.has(id));
  const compact = REGIONS.every((region) => regions[region].length === PRESETS.compact[region].length
    && regions[region].every((id, index) => id === PRESETS.compact[region][index]))
    && without.length === PRESETS.compact.without.length
    && without.every((id, index) => id === PRESETS.compact.without[index]);
  return { regions, parts: mounted, omitted, without: [...without], uncovered, compact };
}

/** Whether a control id is removed by the host through `without`. */
export function isRemoved(without, id) {
  return without.some((pattern) => matches(pattern, id));
}
