// Chart settings of the terminal example: the schema, the defaults of the dark and the light theme, and a store that
// keeps the user's changes in localStorage. Colours, series looks and indicator colours belong to a theme (each theme
// is edited on its own); the default style of new drawings is shared. Labels are message keys (`settings.f.<key>`).

export const STORAGE_KEY = 'vibecharts-terminal-settings';
const VERSION = 1;

export const TABS = Object.freeze(['chart', 'candles', 'series', 'indicators', 'drawings']);

/** type: color | bool | number | select. `tab` places the field; `linked` fields hide while candle colours are linked. */
export const FIELDS = Object.freeze([
  { key: 'chart.background', tab: 'chart', type: 'color' },
  { key: 'chart.text', tab: 'chart', type: 'color' },
  { key: 'chart.fontSize', tab: 'chart', type: 'number', min: 9, max: 18, step: 1 },
  { key: 'grid.visible', tab: 'chart', type: 'bool' },
  { key: 'grid.color', tab: 'chart', type: 'color' },
  { key: 'crosshair.visible', tab: 'chart', type: 'bool' },
  { key: 'crosshair.color', tab: 'chart', type: 'color' },
  { key: 'crosshair.plate', tab: 'chart', type: 'color' },
  { key: 'crosshair.plateText', tab: 'chart', type: 'color' },
  { key: 'axis.border', tab: 'chart', type: 'color' },
  { key: 'axis.text', tab: 'chart', type: 'color' },

  { key: 'candle.up', tab: 'candles', type: 'color' },
  { key: 'candle.down', tab: 'candles', type: 'color' },
  { key: 'candle.equal', tab: 'candles', type: 'color' },
  { key: 'candle.borderVisible', tab: 'candles', type: 'bool' },
  { key: 'candle.wickVisible', tab: 'candles', type: 'bool' },
  { key: 'candle.linked', tab: 'candles', type: 'bool' },
  { key: 'candle.borderUp', tab: 'candles', type: 'color', unlessLinked: true },
  { key: 'candle.borderDown', tab: 'candles', type: 'color', unlessLinked: true },
  { key: 'candle.wickUp', tab: 'candles', type: 'color', unlessLinked: true },
  { key: 'candle.wickDown', tab: 'candles', type: 'color', unlessLinked: true },

  { key: 'volume.up', tab: 'series', type: 'color' },
  { key: 'volume.down', tab: 'series', type: 'color' },
  { key: 'volume.opacity', tab: 'series', type: 'number', min: 0.1, max: 1, step: 0.05 },
  { key: 'line.color', tab: 'series', type: 'color' },
  { key: 'area.opacity', tab: 'series', type: 'number', min: 0, max: 0.6, step: 0.02 },
  { key: 'priceLine.visible', tab: 'series', type: 'bool' },
  { key: 'priceLine.style', tab: 'series', type: 'select', options: ['solid', 'dashed', 'dotted'] },

  { key: 'ind.sma', tab: 'indicators', type: 'color' },
  { key: 'ind.ema', tab: 'indicators', type: 'color' },
  { key: 'ind.bollingerMiddle', tab: 'indicators', type: 'color' },
  { key: 'ind.bollingerBand', tab: 'indicators', type: 'color' },
  { key: 'ind.rsi', tab: 'indicators', type: 'color' },
  { key: 'ind.macd', tab: 'indicators', type: 'color' },
  { key: 'ind.macdSignal', tab: 'indicators', type: 'color' },
  { key: 'ind.macdHistogram', tab: 'indicators', type: 'color' },
]);

/** The default style of new drawings; every property the library knows, with the library's own defaults. */
export const DRAWING_FIELDS = Object.freeze([
  { key: 'color', type: 'color', default: '#4a9fd0' },
  { key: 'width', type: 'number', min: 1, max: 8, step: 1, default: 1 },
  { key: 'dash', type: 'select', options: ['solid', 'dashed', 'dotted'], default: 'solid' },
  { key: 'opacity', type: 'number', min: 0.1, max: 1, step: 0.05, default: 1 },
  { key: 'fill', type: 'bool', default: false },
  { key: 'fillColor', type: 'color', default: '#4a9fd0' },
]);

const SHARED = {
  'candle.up': '#3fa77f', 'candle.down': '#d9645a', 'candle.equal': '#8793a0',
  'candle.borderVisible': true, 'candle.wickVisible': true, 'candle.linked': true,
  'candle.borderUp': '#3fa77f', 'candle.borderDown': '#d9645a', 'candle.wickUp': '#3fa77f', 'candle.wickDown': '#d9645a',
  'volume.up': '#089981', 'volume.down': '#f23645', 'volume.opacity': 0.55, 'line.color': '#4a9fd0', 'area.opacity': 0.14,
  'priceLine.visible': true, 'priceLine.style': 'dashed',
  'ind.sma': '#4a9fd0', 'ind.ema': '#e0a84a', 'ind.bollingerMiddle': '#e0a84a', 'ind.bollingerBand': '#4a9fd0',
  'ind.rsi': '#9a7fd1', 'ind.macd': '#4a9fd0', 'ind.macdSignal': '#e0a84a', 'ind.macdHistogram': '#3fa77f',
  'chart.fontSize': 12, 'grid.visible': true, 'crosshair.visible': true,
};

export const DEFAULTS = Object.freeze({
  dark: Object.freeze({
    ...SHARED,
    'chart.background': '#10161c', 'chart.text': '#aeb8c3', 'grid.color': '#1b232b',
    'crosshair.color': '#7d8d9c', 'crosshair.plate': '#303b47', 'crosshair.plateText': '#ffffff',
    'axis.border': '#2b3540', 'axis.text': '#aeb8c3',
  }),
  light: Object.freeze({
    ...SHARED,
    'chart.background': '#ffffff', 'chart.text': '#1d2630', 'grid.color': '#ebeff2',
    'crosshair.color': '#8a97a4', 'crosshair.plate': '#d8dee4', 'crosshair.plateText': '#1d2630',
    'axis.border': '#d8dee4', 'axis.text': '#1d2630',
  }),
});

export const DRAWING_DEFAULTS = Object.freeze(Object.fromEntries(DRAWING_FIELDS.map((field) => [field.key, field.default])));

const HEX = /^#[0-9a-fA-F]{6}$/;
const fieldByKey = new Map(FIELDS.map((field) => [field.key, field]));
const drawingFieldByKey = new Map(DRAWING_FIELDS.map((field) => [field.key, field]));

/** Throws a descriptive error (naming the field) when `value` is not valid for `field`. */
function check(field, value) {
  const bad = (reason) => new Error(`${field.key}: ${reason}`);
  switch (field.type) {
    case 'color': if (typeof value !== 'string' || !HEX.test(value)) throw bad('expected a #rrggbb colour'); break;
    case 'bool': if (typeof value !== 'boolean') throw bad('expected true or false'); break;
    case 'number': if (typeof value !== 'number' || !Number.isFinite(value) || value < field.min || value > field.max) throw bad(`expected a number from ${field.min} to ${field.max}`); break;
    case 'select': if (!field.options.includes(value)) throw bad(`expected one of ${field.options.join(', ')}`); break;
    default: throw bad('unknown field type');
  }
  return value;
}

export function createSettings(storage = globalThis.localStorage) {
  let data = { theme: 'dark', themes: { dark: {}, light: {} }, drawings: {} };
  const listeners = new Set();

  function parse(text) {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || parsed.version !== VERSION) throw new Error(`settings: unsupported file (expected version ${VERSION})`);
    if (parsed.theme !== undefined && !Object.hasOwn(DEFAULTS, parsed.theme)) throw new Error(`settings: unknown theme "${parsed.theme}"`);
    const next = { theme: parsed.theme ?? 'dark', themes: { dark: {}, light: {} }, drawings: {} };
    for (const [theme, entries] of Object.entries(parsed.themes ?? {})) {
      if (!Object.hasOwn(next.themes, theme)) throw new Error(`settings: unknown theme "${theme}"`);
      for (const [key, value] of Object.entries(entries)) {
        const field = fieldByKey.get(key);
        if (!field) throw new Error(`settings: unknown setting "${key}"`);
        next.themes[theme][key] = check(field, value);
      }
    }
    for (const [key, value] of Object.entries(parsed.drawings ?? {})) {
      const field = drawingFieldByKey.get(key);
      if (!field) throw new Error(`settings: unknown drawing property "${key}"`);
      next.drawings[key] = check(field, value);
    }
    return next;
  }

  function persist() {
    if (!storage) throw new Error('settings: storage is unavailable, changes apply until the page is closed');
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, ...data }));
  }

  function changed() { for (const listener of [...listeners]) listener(); }
  // The change is applied first and then saved: when storage fails the page keeps working and the caller reports it.
  function commit() { changed(); persist(); }

  return {
    /** Reads the saved settings; a corrupt record throws (the caller reports it) and leaves the defaults in place. */
    load() {
      const text = storage?.getItem(STORAGE_KEY);
      if (text) data = parse(text);
    },
    values(theme) { return { ...DEFAULTS[theme], ...data.themes[theme] }; },
    drawingValues() { return { ...DRAWING_DEFAULTS, ...data.drawings }; },
    set(theme, key, value) {
      data.themes[theme][key] = check(fieldByKey.get(key), value);
      commit();
    },
    setDrawing(key, value) {
      data.drawings[key] = check(drawingFieldByKey.get(key), value);
      commit();
    },
    resetKeys(theme, keys) { for (const key of keys) delete data.themes[theme][key]; commit(); },
    resetDrawings() { data.drawings = {}; commit(); },
    resetAll() { data = { theme: data.theme, themes: { dark: {}, light: {} }, drawings: {} }; commit(); },
    activeTheme() { return data.theme; },
    setActiveTheme(name) {
      if (!Object.hasOwn(DEFAULTS, name)) throw new Error(`settings: unknown theme "${name}"`);
      data.theme = name;
      commit();
    },
    exportJson() { return JSON.stringify({ version: VERSION, ...data }, null, 2); },
    importJson(text) { data = parse(text); commit(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}
