import { fail, isObject, isNumber, normalizeZero, requireString, requireBoolean } from './values.js';
import { AXIS_LABEL_TOOLS, STATS_TOOLS, normalizeAxisLabels, normalizeStats } from './axis-stats.js';
import { isPlainColor } from './color.js';

const xy = (count = 2) => ({ count, x: true, price: true });

export const DRAWING_TOOLS = Object.freeze({
  segment: { anchors: xy(2), family: 'line' },
  ray: { anchors: xy(2), family: 'line' },
  line: { anchors: xy(2), family: 'line' },
  horizontalLevel: { anchors: { count: 1, x: false, price: true }, family: 'line' },
  horizontalRay: { anchors: xy(1), family: 'line' },
  verticalLine: { anchors: { count: 1, x: true, price: false }, family: 'line' },
  parallelChannel: { anchors: xy(3), family: 'filled' },
  rectangle: { anchors: xy(2), family: 'filled' },
  ellipse: { anchors: xy(2), family: 'filled' },
  fibRetracement: { anchors: xy(2), family: 'line' },
  text: { anchors: xy(1), family: 'text' },
  measure: { anchors: xy(2), family: 'line' },
  arrow: { anchors: xy(2), family: 'line' },
  angle: { anchors: xy(3), family: 'line' },
  triangle: { anchors: xy(3), family: 'filled' },
  polyline: { anchors: { min: 2, x: true, price: true }, family: 'filled' },
  bezier: { anchors: xy(4), family: 'filled' },
  brush: { anchors: { min: 1, x: true, price: true }, family: 'filled' },
  marker: { anchors: { min: 1, x: true, price: true }, family: 'marker' },
  regressionChannel: { anchors: xy(2), family: 'filled' },
  fibExtension: { anchors: xy(3), family: 'line' },
  fibFan: { anchors: xy(2), family: 'line' },
  fibArcs: { anchors: xy(2), family: 'line' },
  fibTimeZones: { anchors: { count: 2, x: true, price: false }, family: 'line' },
  pitchfork: { anchors: xy(3), family: 'line' },
  priceLabel: { anchors: xy(1), family: 'text' },
  callout: { anchors: xy(2), family: 'text' },
  flag: { anchors: xy(1), family: 'text' },
  anchoredVwap: { anchors: { count: 1, x: true, price: false }, family: 'line' },
});

export const PITCHFORK_VARIANTS = ['standard', 'schiff', 'modifiedSchiff', 'inside'];

const FIB_RETRACEMENT = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_EXTENSION = [0, 0.618, 1, 1.618, 2.618];
const FIB_FAN = [0.236, 0.382, 0.5, 0.618, 0.786, 1];
const FIB_ARCS = [0.382, 0.5, 0.618, 1];
const FIB_TIME_ZONES = [0.382, 0.5, 0.618, 1];

// Reach, arrow heads and the midpoint marker are properties of a line-family drawing, not identities of the tool:
// this table holds, next to the tool table, the default that reproduces the behaviour each tool had before the
// options existed. `extend` defaults to the tool's former clip; `arrows`/`midpoint` exist only where they apply.
// A missing entry means the tool supports none of the options and its props are rejected as unknown.
const NONE = { left: false, right: false };
const RIGHT = { left: false, right: true };
const BOTH = { left: true, right: true };
const NO_ARROWS = { start: false, end: false };

export const LINE_OPTIONS = Object.freeze({
  segment: Object.freeze({ extend: Object.freeze(NONE), arrows: Object.freeze(NO_ARROWS), midpoint: false }),
  ray: Object.freeze({ extend: Object.freeze(RIGHT), arrows: Object.freeze(NO_ARROWS), midpoint: false }),
  line: Object.freeze({ extend: Object.freeze(BOTH), arrows: Object.freeze(NO_ARROWS), midpoint: false }),
  arrow: Object.freeze({ extend: Object.freeze(NONE), arrows: Object.freeze({ start: false, end: true }), midpoint: false }),
  angle: Object.freeze({ extend: Object.freeze(NONE), arrows: Object.freeze(NO_ARROWS), midpoint: false }),
  parallelChannel: Object.freeze({ extend: Object.freeze(BOTH) }),
  fibFan: Object.freeze({ extend: Object.freeze(RIGHT) }),
  rectangle: Object.freeze({ extend: Object.freeze(NONE) }),
  pitchfork: Object.freeze({ extend: Object.freeze(RIGHT) }),
  anchoredVwap: Object.freeze({ extend: Object.freeze(NONE) }),
});

// The stored prop is the effective value, so a partially given object is an error that names the missing member,
// never a silent borrow of the default (an update patch replaces the whole object at its key).
function normalizePair(value, defaults, field, members) {
  if (value === undefined) return { ...defaults };
  if (!isObject(value)) fail('invalid-props', `${field} must be an object`, { field });
  for (const key of Object.keys(value)) {
    if (!members.includes(key)) fail('invalid-props', `Unknown property ${key} in ${field}`, { field: `${field}.${key}` });
  }
  const result = {};
  for (const key of members) {
    if (typeof value[key] !== 'boolean') fail('invalid-props', `${field}.${key} must be a boolean`, { field: `${field}.${key}` });
    result[key] = value[key];
  }
  return result;
}

function normalizeMidpoint(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail('invalid-props', 'props.midpoint must be a boolean', { field: 'props.midpoint' });
  return value;
}

// Composes a tool's own props with the line options: `allowed` grows by the option keys, `normalize` fills
// the effective option values, so add, update and import validate them through the same normalizeProps path.
function withLineOptions(type, base = {}) {
  const options = LINE_OPTIONS[type];
  return {
    allowed: [...(base.allowed ?? []), 'extend', ...(options.arrows ? ['arrows'] : []), ...(options.midpoint !== undefined ? ['midpoint'] : [])],
    normalize: props => ({
      ...(base.normalize ? base.normalize(props) : {}),
      extend: normalizePair(props.extend, options.extend, 'props.extend', ['left', 'right']),
      ...(options.arrows ? { arrows: normalizePair(props.arrows, options.arrows, 'props.arrows', ['start', 'end']) } : {}),
      ...(options.midpoint !== undefined ? { midpoint: normalizeMidpoint(props.midpoint, options.midpoint) } : {}),
    }),
  };
}

// Axis plates and the statistics badge compose onto the same prop entries as the line options, so one
// update patch validates the whole effective prop set through `normalizeProps`.
function withAxisStats(type, base = {}) {
  return {
    allowed: [...(base.allowed ?? []), ...(AXIS_LABEL_TOOLS[type] ? ['axisLabels'] : []), ...(STATS_TOOLS[type] ? ['stats'] : [])],
    normalize: props => ({
      ...(base.normalize ? base.normalize(props) : {}),
      ...(AXIS_LABEL_TOOLS[type] ? { axisLabels: normalizeAxisLabels(type, props.axisLabels) } : {}),
      ...(STATS_TOOLS[type] ? { stats: normalizeStats(type, props.stats) } : {}),
    }),
  };
}

export function normalizeAnchor(raw, spec, index) {
  if (!isObject(raw)) fail('invalid-anchor', `Anchor ${index} must be an object`, { field: 'anchors', index });
  const allowed = ['anchorBarId', 'offset', 'price'];
  for (const key of Object.keys(raw)) {
    if (!allowed.includes(key)) fail('invalid-anchor', `Anchor ${index} has unknown property ${key}`, { field: 'anchors', index });
  }
  const result = {};
  if (spec.x) {
    if (typeof raw.anchorBarId !== 'string' || raw.anchorBarId.trim() === '') {
      fail('invalid-anchor', `Anchor ${index} requires a non-empty anchorBarId`, { field: 'anchors', index });
    }
    if (!isNumber(raw.offset)) {
      fail('invalid-anchor', `Anchor ${index} requires a finite offset`, { field: 'anchors', index });
    }
    result.anchorBarId = raw.anchorBarId;
    result.offset = normalizeZero(raw.offset);
  } else if (raw.anchorBarId !== undefined || raw.offset !== undefined) {
    fail('invalid-anchor', `Anchor ${index} must not carry an x coordinate for this tool`, { field: 'anchors', index });
  }
  if (spec.price) {
    if (!isNumber(raw.price)) {
      fail('invalid-anchor', `Anchor ${index} requires a finite price`, { field: 'anchors', index });
    }
    result.price = normalizeZero(raw.price);
  } else if (raw.price !== undefined) {
    fail('invalid-anchor', `Anchor ${index} must not carry a price for this tool`, { field: 'anchors', index });
  }
  return result;
}

function normalizeLevels(value, defaults, { positive = false } = {}) {
  const source = value === undefined ? defaults.map(coefficient => ({ coefficient })) : value;
  if (!Array.isArray(source) || source.length === 0) {
    fail('invalid-levels', 'levels must be a non-empty array', { field: 'props.levels' });
  }
  const seen = new Set();
  return source.map((level, index) => {
    if (!isObject(level)) fail('invalid-levels', `Level ${index} must be an object`, { field: 'props.levels', index });
    for (const key of Object.keys(level)) {
      if (!['coefficient', 'label', 'visible'].includes(key)) {
        fail('invalid-levels', `Level ${index} has unknown property ${key}`, { field: 'props.levels', index });
      }
    }
    if (!isNumber(level.coefficient)) {
      fail('invalid-levels', `Level ${index} requires a finite coefficient`, { field: 'props.levels', index });
    }
    if (positive && level.coefficient <= 0) {
      fail('invalid-levels', `Level ${index} coefficient must be positive`, { field: 'props.levels', index });
    }
    if (seen.has(level.coefficient)) {
      fail('invalid-levels', `Duplicate coefficient ${level.coefficient}`, { field: 'props.levels', index });
    }
    seen.add(level.coefficient);
    const result = { coefficient: normalizeZero(level.coefficient), visible: level.visible === undefined ? true : requireBoolean(level.visible, 'props.levels.visible') };
    if (level.label !== undefined) result.label = requireString(level.label, 'props.levels.label', { nonEmpty: false, max: 200 });
    return result;
  });
}

function textProp(props) {
  if (!Object.prototype.hasOwnProperty.call(props, 'text')) {
    fail('missing-text', 'props.text is required for this drawing type', { field: 'props.text' });
  }
  return requireString(props.text, 'props.text', { nonEmpty: false, max: 20000 });
}

function assertKnownProps(type, props, allowed) {
  if (!isObject(props)) fail('invalid-props', 'props must be an object', { field: 'props' });
  for (const key of Object.keys(props)) {
    if (!allowed.includes(key)) fail('invalid-props', `Unknown property ${key} for ${type}`, { field: `props.${key}`, property: key });
  }
}

const PROP_DEFINITIONS = {
  text: { allowed: ['text'], normalize: props => ({ text: textProp(props) }) },
  callout: { allowed: ['text'], normalize: props => ({ text: textProp(props) }) },
  flag: { allowed: ['text'], normalize: props => ({ text: textProp(props) }) },
  fibRetracement: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_RETRACEMENT) }),
  },
  fibExtension: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_EXTENSION) }),
  },
  fibFan: withLineOptions('fibFan', {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_FAN) }),
  }),
  fibArcs: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_ARCS, { positive: true }) }),
  },
  fibTimeZones: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_TIME_ZONES) }),
  },
  pitchfork: withLineOptions('pitchfork', {
    allowed: ['variant'],
    normalize: props => {
      const variant = props.variant === undefined ? 'standard' : props.variant;
      if (!PITCHFORK_VARIANTS.includes(variant)) {
        fail('invalid-props', `variant must be one of ${PITCHFORK_VARIANTS.join(', ')}`, { field: 'props.variant' });
      }
      return { variant };
    },
  }),
  regressionChannel: {
    allowed: ['seriesId', 'k'],
    normalize: props => {
      const seriesId = requireString(props.seriesId, 'props.seriesId');
      if (!isNumber(props.k) || props.k < 0) {
        fail('invalid-props', 'props.k must be a finite non-negative number', { field: 'props.k' });
      }
      return { seriesId, k: normalizeZero(props.k) };
    },
  },
  anchoredVwap: withAxisStats('anchoredVwap', withLineOptions('anchoredVwap', {
    allowed: ['priceSeriesId', 'volumeSeriesId'],
    normalize: props => ({
      priceSeriesId: requireString(props.priceSeriesId, 'props.priceSeriesId'),
      volumeSeriesId: requireString(props.volumeSeriesId, 'props.volumeSeriesId'),
    }),
  })),
  segment: withAxisStats('segment', withLineOptions('segment')),
  ray: withAxisStats('ray', withLineOptions('ray')),
  line: withAxisStats('line', withLineOptions('line')),
  arrow: withAxisStats('arrow', withLineOptions('arrow')),
  horizontalLevel: withAxisStats('horizontalLevel'),
  horizontalRay: withAxisStats('horizontalRay'),
  verticalLine: withAxisStats('verticalLine'),
  measure: withAxisStats('measure'),
  angle: withLineOptions('angle'),
  parallelChannel: withLineOptions('parallelChannel'),
  rectangle: withLineOptions('rectangle'),
};

const LABEL_TOOLS = ['segment', 'ray', 'line', 'horizontalLevel', 'horizontalRay', 'verticalLine', 'arrow', 'parallelChannel', 'regressionChannel', 'rectangle', 'ellipse', 'triangle'];
const TEXT_STYLE_TOOLS = ['text', 'callout', 'flag', 'priceLabel'];

function normalizeTypography(value, field, label) {
  if (!isObject(value)) fail('invalid-props', `${field} must be an object`, { field });
  const allowed = label ? ['text', 'color', 'size', 'bold', 'italic', 'align'] : ['size', 'bold', 'italic', 'align'];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('invalid-props', `Unknown ${field}.${key}`, { field: `${field}.${key}` });
  }
  const size = value.size === undefined ? 12 : value.size;
  if (!isNumber(size) || size < 8 || size > 72) fail('invalid-props', `${field}.size must be from 8 to 72`, { field: `${field}.size` });
  const bold = value.bold === undefined ? false : requireBoolean(value.bold, `${field}.bold`);
  const italic = value.italic === undefined ? false : requireBoolean(value.italic, `${field}.italic`);
  const align = value.align === undefined ? (label ? 'center' : 'start') : value.align;
  if (!['start', 'center', 'end'].includes(align)) fail('invalid-props', `${field}.align must be start, center or end`, { field: `${field}.align` });
  const result = { size, bold, italic, align };
  if (label) {
    const text = requireString(value.text, `${field}.text`, { nonEmpty: false, max: 200 });
    if (text.split('\n').length > 3) fail('invalid-props', `${field}.text must have at most 3 lines`, { field: `${field}.text` });
    result.text = text;
    if (value.color !== undefined) {
      if (!isPlainColor(value.color)) {
        fail('invalid-props', `${field}.color must be a plain color string`, { field: `${field}.color` });
      }
      result.color = value.color;
    }
  }
  return result;
}

for (const type of [...LABEL_TOOLS, ...TEXT_STYLE_TOOLS]) {
  const base = PROP_DEFINITIONS[type] ?? { allowed: [], normalize: () => ({}) };
  const key = LABEL_TOOLS.includes(type) ? 'label' : 'textStyle';
  PROP_DEFINITIONS[type] = {
    allowed: [...base.allowed, key],
    normalize: props => ({
      ...base.normalize(props),
      ...(props[key] === undefined || (key === 'label' && props[key] === null)
        ? {} : { [key]: normalizeTypography(props[key], `props.${key}`, key === 'label') }),
    }),
  };
}

export function normalizeProps(type, props = {}) {
  assertKnownProps(type, props, PROP_DEFINITIONS[type]?.allowed ?? []);
  return PROP_DEFINITIONS[type] ? PROP_DEFINITIONS[type].normalize(props) : {};
}

export function anchorCountCheck(type, count) {
  const spec = DRAWING_TOOLS[type].anchors;
  if (spec.count !== undefined && count !== spec.count) {
    fail('invalid-anchor-count', `${type} requires exactly ${spec.count} anchor(s)`, {
      field: 'anchors',
      expected: spec.count,
      actual: count,
    });
  }
  if (spec.min !== undefined && count < spec.min) {
    fail('invalid-anchor-count', `${type} requires at least ${spec.min} anchor(s)`, {
      field: 'anchors',
      minimum: spec.min,
      actual: count,
    });
  }
}
