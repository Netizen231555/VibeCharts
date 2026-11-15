// Axis-label and statistics props of drawing tools: the per-tool support tables, their normalizers and
// (below) the one badge builder the measure tool and the line tools share. Everything here is pure data
// work over the stored props; no layout, no locale.
import { fail, isObject } from './values.js';

// Which axis a tool has a coordinate on: a horizontal level has only a price, a vertical line only a bar,
// anchored VWAP only its anchor bar. `true` means the plate is supported; asking for the other axis is an error.
export const AXIS_LABEL_TOOLS = Object.freeze({
  horizontalLevel: Object.freeze({ price: true, time: false }),
  horizontalRay: Object.freeze({ price: true, time: false }),
  verticalLine: Object.freeze({ price: false, time: true }),
  segment: Object.freeze({ price: true, time: true }),
  ray: Object.freeze({ price: true, time: true }),
  line: Object.freeze({ price: true, time: true }),
  arrow: Object.freeze({ price: true, time: true }),
  anchoredVwap: Object.freeze({ price: false, time: true }),
});

// Tools that carry the statistics badge. `measure` keeps today's look as its default (every figure on,
// midpoint, always visible); the line tools are opt-in.
export const STATS_TOOLS = Object.freeze({
  segment: Object.freeze({ priceRange: false, percent: false, bars: false, time: false, position: 'center', always: false }),
  ray: Object.freeze({ priceRange: false, percent: false, bars: false, time: false, position: 'center', always: false }),
  line: Object.freeze({ priceRange: false, percent: false, bars: false, time: false, position: 'center', always: false }),
  arrow: Object.freeze({ priceRange: false, percent: false, bars: false, time: false, position: 'center', always: false }),
  measure: Object.freeze({ priceRange: true, percent: true, bars: true, time: true, position: 'center', always: true }),
});

const AXIS_KEYS = ['price', 'time'];
const STAT_FLAGS = ['priceRange', 'percent', 'bars', 'time', 'always'];
const STAT_POSITIONS = ['start', 'center', 'end'];

// A missing `axisLabels` normalizes to both flags false; a missing key inside normalizes to false. `true`
// for an axis the tool has no coordinate on, an unknown key or a non-boolean value is rejected naming the
// field, so `drawings.add`, `update` and `import` all fail identically.
export function normalizeAxisLabels(type, value) {
  const supported = AXIS_LABEL_TOOLS[type];
  if (!supported) fail('invalid-props', `${type} does not support props.axisLabels`, { field: 'props.axisLabels' });
  if (value === undefined) return { price: false, time: false };
  if (!isObject(value)) fail('invalid-props', 'props.axisLabels must be an object', { field: 'props.axisLabels' });
  for (const key of Object.keys(value)) {
    if (!AXIS_KEYS.includes(key)) fail('invalid-props', `Unknown property ${key} in props.axisLabels`, { field: `props.axisLabels.${key}` });
  }
  const result = {};
  for (const key of AXIS_KEYS) {
    if (value[key] === undefined) { result[key] = false; continue; }
    if (typeof value[key] !== 'boolean') fail('invalid-props', `props.axisLabels.${key} must be a boolean`, { field: `props.axisLabels.${key}` });
    if (value[key] && !supported[key]) {
      fail('invalid-props', `${type} has no ${key} coordinate for an axis label`, { field: `props.axisLabels.${key}` });
    }
    result[key] = value[key];
  }
  return result;
}

// Same shape for every tool, per-tool defaults. A missing key normalizes to the tool's default, so a partial
// update patch on top of stored props stays valid.
export function normalizeStats(type, value) {
  const defaults = STATS_TOOLS[type];
  if (!defaults) fail('invalid-props', `${type} does not support props.stats`, { field: 'props.stats' });
  if (value === undefined) return { ...defaults };
  if (!isObject(value)) fail('invalid-props', 'props.stats must be an object', { field: 'props.stats' });
  for (const key of Object.keys(value)) {
    if (![...STAT_FLAGS, 'position'].includes(key)) fail('invalid-props', `Unknown property ${key} in props.stats`, { field: `props.stats.${key}` });
  }
  const result = {};
  for (const key of STAT_FLAGS) {
    if (value[key] === undefined) { result[key] = defaults[key]; continue; }
    if (typeof value[key] !== 'boolean') fail('invalid-props', `props.stats.${key} must be a boolean`, { field: `props.stats.${key}` });
    result[key] = value[key];
  }
  const position = value.position === undefined ? defaults.position : value.position;
  if (!STAT_POSITIONS.includes(position)) {
    fail('invalid-props', `props.stats.position must be one of ${STAT_POSITIONS.join(', ')}`, { field: 'props.stats.position' });
  }
  result.position = position;
  return result;
}
