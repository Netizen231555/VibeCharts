import { fail } from '../errors.js';
import {
  assertBoolean,
  assertFiniteNumber,
  assertNonNegativeNumber,
  assertPlainObject,
  assertPositiveNumber,
  assertString,
  validateTimeZone
} from './validate.js';

const TOP_KEYS = new Set([
  'theme',
  'locale',
  'timeZone',
  'layout',
  'grid',
  'sessions',
  'watermark',
  'crosshair',
  'timeScale',
  'priceScale',
  'autoSize',
  'accessibilityLabel',
  'countdown'
]);

export const DEFAULT_OPTIONS = Object.freeze({
  theme: 'dark',
  locale: 'en-US',
  timeZone: 'UTC',
  layout: Object.freeze({
    background: null,
    textColor: null,
    fontSize: 12,
    fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif'
  }),
  grid: Object.freeze({ visible: true, color: null }),
  sessions: Object.freeze({ visible: true, color: null, starts: Object.freeze([]) }),
  watermark: Object.freeze({ visible: true, text: '', color: null, fontSize: 48 }),
  crosshair: Object.freeze({
    visible: true,
    color: null,
    labelBackground: null,
    labelTextColor: null,
    timeFormatter: null
  }),
  timeScale: Object.freeze({
    visible: true,
    barSpacing: 8,
    rightOffset: 2,
    borderColor: null,
    textColor: null,
    slotLabel: null,
    tickMode: 'index'
  }),
  priceScale: Object.freeze({ borderColor: null, textColor: null, tickSpacing: null, margins: null }),
  autoSize: true,
  accessibilityLabel: 'Price chart',
  countdown: Object.freeze({ visible: false, placement: 'corner' })
});

function validateLocale(locale) {
  assertString(locale, 'chart.applyOptions', 'locale', { nonEmpty: true });
  try {
    new Intl.DateTimeFormat(locale);
  } catch {
    fail('INVALID_ARGUMENT', 'chart.applyOptions', '"locale" must be a valid BCP 47 locale', {
      field: 'locale'
    });
  }
  return locale;
}

function mergeSection(baseSection, section, value, allowed) {
  assertPlainObject(value, 'chart.applyOptions', section);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      fail('UNKNOWN_OPTION', 'chart.applyOptions', `unknown option "${section}.${key}"`, {
        field: `${section}.${key}`
      });
    }
  }
  return { ...baseSection, ...value };
}

function optionalColor(value, field) {
  return value === null ? null : assertString(value, 'chart.applyOptions', field, { nonEmpty: true });
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    fail('INVALID_ARGUMENT', 'chart.applyOptions', `"${field}" must be one of ${allowed.map((item) => `"${item}"`).join(', ')}`, { field });
  }
  return value;
}

function optionalFunction(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'function') fail('INVALID_TYPE', 'chart.applyOptions', `"${field}" must be a function or null`, { field });
  return value;
}

/** Autoscale margins as fractions of the pane height; both sides are required. */
export function normalizeMargins(value, operation, field) {
  if (value === null || value === undefined) return null;
  assertPlainObject(value, operation, field);
  for (const key of Object.keys(value)) {
    if (key !== 'top' && key !== 'bottom') fail('UNKNOWN_OPTION', operation, `unknown option "${field}.${key}"`, { field: `${field}.${key}` });
  }
  const side = (name) => {
    const number = assertFiniteNumber(value[name], operation, `${field}.${name}`);
    if (number < 0 || number >= 1) fail('INVALID_ARGUMENT', operation, `"${field}.${name}" must be at least 0 and below 1`, { field: `${field}.${name}` });
    return number;
  };
  const margins = { top: side('top'), bottom: side('bottom') };
  if (margins.top + margins.bottom >= 1) fail('INVALID_ARGUMENT', operation, `"${field}" top and bottom must sum to less than 1`, { field });
  return Object.freeze(margins);
}

/**
 * Validates a partial options patch and returns a fully merged frozen object.
 * Nothing is applied unless the whole patch is valid.
 */
export function mergeChartOptions(base, patch) {
  assertPlainObject(patch, 'chart.applyOptions', 'options');
  for (const key of Object.keys(patch)) {
    if (!TOP_KEYS.has(key)) {
      fail('UNKNOWN_OPTION', 'chart.applyOptions', `unknown option "${key}"`, { field: key });
    }
  }
  const next = {
    ...base,
    layout: { ...base.layout },
    grid: { ...base.grid },
    sessions: { ...base.sessions, starts: [...base.sessions.starts] },
    watermark: { ...base.watermark },
    crosshair: { ...base.crosshair },
    timeScale: { ...base.timeScale },
    priceScale: { ...base.priceScale },
    countdown: { ...base.countdown }
  };

  if (patch.theme !== undefined) {
    if (patch.theme !== 'light' && patch.theme !== 'dark') {
      fail('INVALID_ARGUMENT', 'chart.applyOptions', '"theme" must be "light" or "dark"', {
        field: 'theme'
      });
    }
    next.theme = patch.theme;
  }
  if (patch.locale !== undefined) next.locale = validateLocale(patch.locale);
  if (patch.timeZone !== undefined) next.timeZone = validateTimeZone(patch.timeZone, 'chart.applyOptions');
  if (patch.accessibilityLabel !== undefined) {
    next.accessibilityLabel = assertString(
      patch.accessibilityLabel,
      'chart.applyOptions',
      'accessibilityLabel',
      { nonEmpty: true }
    );
  }
  if (patch.autoSize !== undefined) {
    next.autoSize = assertBoolean(patch.autoSize, 'chart.applyOptions', 'autoSize');
  }

  if (patch.layout !== undefined) {
    const layout = mergeSection(base.layout, 'layout', patch.layout, new Set(['background', 'textColor', 'fontSize', 'fontFamily']));
    layout.background = optionalColor(layout.background, 'layout.background');
    layout.textColor = optionalColor(layout.textColor, 'layout.textColor');
    layout.fontFamily = assertString(layout.fontFamily, 'chart.applyOptions', 'layout.fontFamily', {
      nonEmpty: true
    });
    layout.fontSize = assertPositiveNumber(layout.fontSize, 'chart.applyOptions', 'layout.fontSize');
    next.layout = layout;
  }

  if (patch.grid !== undefined) {
    const grid = mergeSection(base.grid, 'grid', patch.grid, new Set(['visible', 'color']));
    grid.visible = assertBoolean(grid.visible, 'chart.applyOptions', 'grid.visible');
    grid.color = optionalColor(grid.color, 'grid.color');
    next.grid = grid;
  }
  if (patch.sessions !== undefined) {
    const sessions = mergeSection(base.sessions, 'sessions', patch.sessions, new Set(['visible', 'color', 'starts']));
    sessions.visible = assertBoolean(sessions.visible, 'chart.applyOptions', 'sessions.visible');
    sessions.color = optionalColor(sessions.color, 'sessions.color');
    if (!Array.isArray(sessions.starts)) {
      fail('INVALID_TYPE', 'chart.applyOptions', '"sessions.starts" must be an array', { field: 'sessions.starts' });
    }
    const seen = new Set();
    sessions.starts = sessions.starts.map((id, index) => {
      const value = assertString(id, 'chart.applyOptions', `sessions.starts[${index}]`, { nonEmpty: true });
      if (seen.has(value)) fail('INVALID_ARGUMENT', 'chart.applyOptions', 'session start must be unique', { field: `sessions.starts[${index}]` });
      seen.add(value);
      return value;
    });
    Object.freeze(sessions.starts);
    next.sessions = sessions;
  }
  if (patch.watermark !== undefined) {
    const watermark = mergeSection(base.watermark, 'watermark', patch.watermark, new Set(['visible', 'text', 'color', 'fontSize']));
    watermark.visible = assertBoolean(watermark.visible, 'chart.applyOptions', 'watermark.visible');
    watermark.text = assertString(watermark.text, 'chart.applyOptions', 'watermark.text');
    watermark.color = optionalColor(watermark.color, 'watermark.color');
    watermark.fontSize = assertPositiveNumber(watermark.fontSize, 'chart.applyOptions', 'watermark.fontSize');
    next.watermark = watermark;
  }


  if (patch.crosshair !== undefined) {
    const crosshair = mergeSection(
      base.crosshair,
      'crosshair',
      patch.crosshair,
      new Set(['visible', 'color', 'labelBackground', 'labelTextColor', 'timeFormatter'])
    );
    crosshair.visible = assertBoolean(crosshair.visible, 'chart.applyOptions', 'crosshair.visible');
    crosshair.color = optionalColor(crosshair.color, 'crosshair.color');
    crosshair.labelBackground = optionalColor(crosshair.labelBackground, 'crosshair.labelBackground');
    crosshair.labelTextColor = optionalColor(crosshair.labelTextColor ?? null, 'crosshair.labelTextColor');
    crosshair.timeFormatter = optionalFunction(crosshair.timeFormatter, 'crosshair.timeFormatter');
    next.crosshair = crosshair;
  }

  if (patch.timeScale !== undefined) {
    const timeScale = mergeSection(
      base.timeScale,
      'timeScale',
      patch.timeScale,
      new Set(['visible', 'barSpacing', 'rightOffset', 'slotLabel', 'borderColor', 'textColor', 'tickMode'])
    );
    timeScale.visible = assertBoolean(timeScale.visible, 'chart.applyOptions', 'timeScale.visible');
    timeScale.borderColor = optionalColor(timeScale.borderColor, 'timeScale.borderColor');
    timeScale.textColor = optionalColor(timeScale.textColor, 'timeScale.textColor');
    timeScale.barSpacing = assertPositiveNumber(
      timeScale.barSpacing,
      'chart.applyOptions',
      'timeScale.barSpacing'
    );
    timeScale.rightOffset = assertNonNegativeNumber(
      timeScale.rightOffset,
      'chart.applyOptions',
      'timeScale.rightOffset'
    );
    if (timeScale.slotLabel !== null && timeScale.slotLabel !== undefined) {
      if (typeof timeScale.slotLabel !== 'function') {
        fail('INVALID_TYPE', 'chart.applyOptions', '"timeScale.slotLabel" must be a function or null', {
          field: 'timeScale.slotLabel'
        });
      }
    } else {
      timeScale.slotLabel = null;
    }
    timeScale.tickMode = oneOf(timeScale.tickMode, ['index', 'time'], 'timeScale.tickMode');
    next.timeScale = timeScale;
  }

  if (patch.priceScale !== undefined) {
    const priceScale = mergeSection(base.priceScale, 'priceScale', patch.priceScale, new Set(['borderColor', 'textColor', 'tickSpacing', 'margins']));
    priceScale.borderColor = optionalColor(priceScale.borderColor, 'priceScale.borderColor');
    priceScale.textColor = optionalColor(priceScale.textColor, 'priceScale.textColor');
    priceScale.tickSpacing = priceScale.tickSpacing === null || priceScale.tickSpacing === undefined
      ? null
      : assertPositiveNumber(priceScale.tickSpacing, 'chart.applyOptions', 'priceScale.tickSpacing');
    priceScale.margins = normalizeMargins(priceScale.margins, 'chart.applyOptions', 'priceScale.margins');
    next.priceScale = priceScale;
  }

  if (patch.countdown !== undefined) {
    const countdown = mergeSection(base.countdown, 'countdown', patch.countdown, new Set(['visible', 'placement']));
    countdown.visible = assertBoolean(countdown.visible, 'chart.applyOptions', 'countdown.visible');
    countdown.placement = oneOf(countdown.placement, ['corner', 'label'], 'countdown.placement');
    next.countdown = countdown;
  }

  return Object.freeze(next);
}

export function assertFiniteSize(value, operation, field) {
  return assertFiniteNumber(value, operation, field);
}
