import { fail, isObject, isNumber } from './values.js';
import { isPlainColor } from './color.js';

export const STYLE_FAMILIES = Object.freeze({
  line: ['color', 'width', 'dash', 'opacity'],
  filled: ['color', 'width', 'dash', 'opacity', 'fill', 'fillOpacity'],
  text: ['color', 'opacity'],
  marker: ['color', 'width', 'opacity'],
});

const DASHES = ['solid', 'dashed', 'dotted'];

function color(value, property) {
  if (!isPlainColor(value)) {
    fail('invalid-style', `${property} must be a plain color string`, { property });
  }
  return value;
}

const VALIDATORS = {
  color: value => color(value, 'color'),
  width: value => {
    if (!isNumber(value) || value <= 0 || value > 1000) {
      fail('invalid-style', 'width must be a finite number greater than 0 and at most 1000', { property: 'width' });
    }
    return value;
  },
  dash: value => {
    if (!DASHES.includes(value)) fail('invalid-style', `dash must be one of ${DASHES.join(', ')}`, { property: 'dash' });
    return value;
  },
  fill: value => {
    if (typeof value !== 'boolean') fail('invalid-style', 'fill must be a boolean', { property: 'fill' });
    return value;
  },
  fillOpacity: value => {
    if (!isNumber(value) || value < 0 || value > 1) {
      fail('invalid-style', 'fillOpacity must be a finite number between 0 and 1', { property: 'fillOpacity' });
    }
    return value;
  },
  opacity: value => {
    if (!isNumber(value) || value < 0 || value > 1) {
      fail('invalid-style', 'opacity must be a finite number between 0 and 1', { property: 'opacity' });
    }
    return value;
  },
};

export function defaultStyle(family) {
  const style = { color: '#4a9fd0', opacity: 1 };
  if (family !== 'text' && family !== 'marker') style.width = 1;
  if (family === 'marker') style.width = 12;
  if (family === 'filled') {
    style.width = 1;
    style.dash = 'solid';
    style.fill = false;
    style.fillOpacity = 0.18;
  }
  if (family === 'line') style.dash = 'solid';
  return style;
}

export function validateStyle(family, style = {}) {
  const allowed = STYLE_FAMILIES[family];
  if (!allowed) fail('unknown-style-family', `Unknown style family: ${String(family)}`);
  if (!isObject(style)) fail('invalid-style', 'style must be an object', { field: 'style' });
  const result = {};
  for (const key of Object.keys(style)) {
    if (!allowed.includes(key)) {
      fail('style-property-not-allowed', `Property ${key} is not allowed for a ${family} drawing`, {
        property: key,
        family,
      });
    }
    result[key] = VALIDATORS[key](style[key]);
  }
  return result;
}

export function completeStyle(family, style = {}) {
  return { ...defaultStyle(family), ...validateStyle(family, style) };
}
