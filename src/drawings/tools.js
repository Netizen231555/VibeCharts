import { fail, isObject, isNumber, normalizeZero, requireString, requireBoolean } from './values.js';

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
    if (!allowed.includes(key)) fail('invalid-props', `Unknown property ${key} for ${type}`, { field: 'props', property: key });
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
  fibFan: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_FAN) }),
  },
  fibArcs: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_ARCS, { positive: true }) }),
  },
  fibTimeZones: {
    allowed: ['levels'],
    normalize: props => ({ levels: normalizeLevels(props.levels, FIB_TIME_ZONES) }),
  },
  pitchfork: {
    allowed: ['variant'],
    normalize: props => {
      const variant = props.variant === undefined ? 'standard' : props.variant;
      if (!PITCHFORK_VARIANTS.includes(variant)) {
        fail('invalid-props', `variant must be one of ${PITCHFORK_VARIANTS.join(', ')}`, { field: 'props.variant' });
      }
      return { variant };
    },
  },
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
  anchoredVwap: {
    allowed: ['priceSeriesId', 'volumeSeriesId'],
    normalize: props => ({
      priceSeriesId: requireString(props.priceSeriesId, 'props.priceSeriesId'),
      volumeSeriesId: requireString(props.volumeSeriesId, 'props.volumeSeriesId'),
    }),
  },
};

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
