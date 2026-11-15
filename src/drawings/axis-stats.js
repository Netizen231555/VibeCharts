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

// Float noise (4.670005912000022) never reaches a badge: round to 12 significant digits, then to the requested decimals.
export function signed(value, text = String(Number(value.toPrecision(12)))) {
  return value >= 0 ? `+${text}` : text;
}

// A price difference is not a price: the host adapter may format it (no percent conversion, no unit); the
// fallback keeps a bounded precision.
export function formatPriceDelta(adapter, delta, binding) {
  if (typeof adapter?.formatPriceDelta === 'function') {
    const text = adapter.formatPriceDelta(delta, binding);
    if (typeof text === 'string') return signed(delta, text);
  }
  return signed(delta);
}

// Bar counts may be fractional when an anchor has an offset; two decimals are the most a reader can use.
export function formatIntervals(delta) {
  return signed(delta, String(Number(delta.toFixed(2))));
}

const DURATION_UNITS = Object.freeze([['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]);

// The unit split of an elapsed time; the two largest non-zero units. Words are the caller's: the default is
// the unit letters, a localized adapter spells them out.
export function splitDuration(milliseconds) {
  let rest = Math.floor(Math.abs(milliseconds) / 1000);
  const parts = [];
  for (const [unit, size] of DURATION_UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push({ unit, count });
  }
  return parts.slice(0, 2);
}

// English defaults of the optional adapter text helpers, so a host store without them keeps the old badge words.
function defaultBars(count) {
  return `${count} bars`;
}

function defaultDuration(milliseconds) {
  const parts = splitDuration(milliseconds);
  return parts.length === 0 ? '0s' : parts.map(({ unit, count }) => `${count}${unit}`).join(' ');
}

function barsText(adapter, count) {
  if (typeof adapter?.formatBars === 'function') {
    const text = adapter.formatBars(count);
    if (typeof text === 'string') return text;
  }
  return defaultBars(count);
}

function durationText(adapter, milliseconds) {
  if (typeof adapter?.formatDuration === 'function') {
    const text = adapter.formatDuration(milliseconds);
    if (typeof text === 'string') return text;
  }
  return defaultDuration(milliseconds);
}

// The one badge of the measure tool and the line tools. `measure` is a `measureAnchors` result, `fields` the
// four figure flags of `props.stats`; the caller places the anchor point and picks the tone. Returns the
// `labels[0]` shape the renderer paints, or null when every figure is off or nothing is computable.
export function buildStatsBadge({ measure, anchorPoint, tone, fields, adapter, binding }) {
  const lines = [];
  const priceParts = [];
  if (fields.priceRange) priceParts.push(formatPriceDelta(adapter, measure.priceDelta, binding));
  if (fields.percent && measure.relativeChange !== null) {
    const percent = signed(measure.relativeChange * 100, (measure.relativeChange * 100).toFixed(2));
    priceParts.push(fields.priceRange ? `(${percent}%)` : `${percent}%`);
  }
  if (priceParts.length > 0) lines.push(priceParts.join(' '));
  const countParts = [];
  if (fields.bars && measure.indexDelta !== null) countParts.push(barsText(adapter, Number(Math.abs(measure.indexDelta).toFixed(2))));
  if (fields.time && measure.duration !== null) countParts.push(durationText(adapter, measure.duration));
  if (countParts.length > 0) lines.push(countParts.join(', '));
  if (lines.length === 0) return null;
  return {
    x: anchorPoint.x,
    y: anchorPoint.y,
    text: lines[0],
    lines,
    box: { tone },
    placement: tone === 'up' ? 'above' : 'below',
  };
}
