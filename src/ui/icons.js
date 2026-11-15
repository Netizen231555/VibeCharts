/**
 * Icon set of the chart UI. Every icon is drawn for this package on one
 * 24×24 grid with a 1.5 stroke, round caps and joins, and is built as inline
 * SVG from the path data below (no markup parsing, no external resources).
 *
 * Icons are decorative: the SVG is `aria-hidden` and `currentColor`, the
 * control that contains it supplies the accessible name.
 */
import { InteractionError } from '../interaction/errors.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Circle of radius `r` as path data. */
const circle = (cx, cy, r) => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const ICONS = Object.freeze({
  // chart types (prefixed: a chart type and a drawing tool can share an id, e.g. `line`)
  'chartType.candles': ['M8 3v4M8 17v4M6 7h4v10H6z', 'M16 2v4M16 14v5M14 6h4v8h-4z'],
  'chartType.bars': ['M7 4v16M4 8h3M7 15h3', 'M17 4v16M14 11h3M17 6h3'],
  'chartType.line': ['M3 17l5-6 4 3 8-9'],
  'chartType.area': ['M3 18l5-7 4 3 8-9v13H3z'],
  // drawing tools: one icon per tool id of the drawings module (the rail uses the id as the icon name)
  cursor: ['M5 3l6 17 2.2-7.3L20.5 10.5z'],
  segment: ['M6.9 17.1L17.1 6.9', circle(5.5, 18.5, 2), circle(18.5, 5.5, 2)],
  ray: ['M6.4 17.6L20 4M15 4h5v5', circle(5, 19, 2)],
  line: ['M3 21L21 3', circle(9, 15, 1.5), circle(15, 9, 1.5)],
  horizontalLevel: ['M3 12h6M15 12h6', circle(12, 12, 2)],
  horizontalRay: ['M7 12h14M17 8l4 4-4 4', circle(5, 12, 2)],
  verticalLine: ['M12 3v6M12 15v6', circle(12, 12, 2)],
  arrow: ['M5 19L19 5M11 5h8v8'],
  angle: ['M4 19h16M4 19L16 6', 'M11 19A7 7 0 0 0 8.6 13.7'],
  polyline: ['M4 17l5-9 5 7 6-9', circle(4, 17, 1.5), circle(9, 8, 1.5), circle(14, 15, 1.5), circle(20, 6, 1.5)],
  brush: ['M4 15c2-7 4-7 5-2s3 5 5 0 3-6 6-3'],
  bezier: ['M5 18C7 6 17 18 19 6', circle(5, 18, 1.5), circle(19, 6, 1.5)],
  parallelChannel: ['M4 11L20 4M4 20L20 13'],
  regressionChannel: ['M4 11L20 3M4 21L20 13', 'M4 16l4-2M11 12.5l4-2M18 9l2-1'],
  pitchfork: ['M12 21V4M6 4v4.5a6 6 0 0 0 12 0V4'],
  fibRetracement: ['M4 5h16M4 10h16M4 15h16M4 20h16', 'M6 18L18 7'],
  fibExtension: ['M3 19L7 8l5 9', 'M14 6h7M14 11h7M14 16h7'],
  fibFan: ['M4 20L21 4M4 20L21 10M4 20L21 15', circle(4, 20, 1.5)],
  fibArcs: ['M10 20A6 6 0 0 0 4 14', 'M15 20A11 11 0 0 0 4 9', 'M20 20A16 16 0 0 0 4 4'],
  fibTimeZones: ['M5 4v16M8 4v16M13 4v16M21 4v16'],
  rectangle: ['M5 7h14v10H5z'],
  ellipse: ['M3 12a9 6 0 1 0 18 0a9 6 0 1 0-18 0'],
  triangle: ['M12 5L20 19H4z'],
  text: ['M6 6h12M12 6v13M9.5 19h5'],
  callout: ['M4 5h16v10h-8l-4 4v-4H4z'],
  flag: ['M6 21V4M6 5h12l-3 4 3 4H6'],
  priceLabel: ['M3 12l5-5h13v10H8z', circle(8.5, 12, 1)],
  marker: ['M15 4l5 5-8.5 8.5-5-5z', 'M6.5 12.5L4.5 19.5l7-2M13 20h7'],
  measure: ['M4 16L16 4l4 4L8 20z', 'M9 9l2 2M12 6l2 2M6 12l2 2'],
  anchoredVwap: ['M5 3v13.5', circle(5, 18.5, 2), 'M7 17c3 0 4-5 7-5s4 3 7 0'],
  // navigation
  zoomIn: [circle(10.5, 10.5, 6.5), 'M15.5 15.5L20 20M8 10.5h5M10.5 8v5'],
  zoomOut: [circle(10.5, 10.5, 6.5), 'M15.5 15.5L20 20M8 10.5h5'],
  fit: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  toLast: ['M5 6l6 6-6 6M13 6l6 6-6 6'],
  priceAuto: ['M12 4v16', 'M8.5 7.5L12 4l3.5 3.5M8.5 16.5L12 20l3.5-3.5'],
  priceZoomIn: ['M12 3v7M9 6l3-3 3 3M12 21v-7M9 18l3 3 3-3'],
  priceZoomOut: ['M12 3v6M9 6l3 3 3-3M12 21v-6M9 18l3-3 3 3'],
  panLeft: ['M14 6l-6 6 6 6'],
  panRight: ['M10 6l6 6-6 6'],
  crosshair: ['M12 3v6M12 15v6M3 12h6M15 12h6'],
  follow: ['M4 12h11M11 8l4 4-4 4', 'M20 5v14'],
  // history and drawings
  undo: ['M9 5L4 10l5 5', 'M4 10h9a5 5 0 0 1 0 10h-3'],
  redo: ['M15 5l5 5-5 5', 'M20 10h-9a5 5 0 0 0 0 10h3'],
  clear: ['M5 7h14M10 7V4h4v3', 'M7 7l1 13h8l1-13'],
  // chrome
  settings: [circle(5.5, 12, 1), circle(12, 12, 1), circle(18.5, 12, 1)],
  indicator: ['M3 16l4-5 4 3 5-7 5 4'],
  theme: [circle(12, 12, 8), 'M12 4v16M12 4a8 8 0 0 1 0 16'],
  table: ['M4 5h16v14H4z', 'M4 10h16M4 15h16M10 5v14'],
  panes: ['M4 4h16v7H4z', 'M4 14h16v6H4z'],
  chevronDown: ['M6 9l6 6 6-6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  close: ['M6 6l12 12M18 6L6 18'],
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

export function hasIcon(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, name);
}

/**
 * Validates host icon replacements: `{ [name]: pathData | pathData[] }` on the same 24×24 grid. A name must
 * be one the set already has (a typo would silently draw the default), and the data is only ever written to a
 * `d` attribute, never parsed as markup.
 * @param {unknown} input
 * @returns {Readonly<Record<string, readonly string[]>>}
 */
export function resolveIcons(input) {
  const fail = (message) => new InteractionError(message, { code: 'INVALID_UI_OPTION', field: 'icons' });
  if (input === undefined) return Object.freeze({});
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw fail('icons must be an object of icon name to path data');
  const out = {};
  for (const [name, value] of Object.entries(input)) {
    if (!hasIcon(name)) throw fail(`icons: unknown icon "${name}"`);
    const paths = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((data) => typeof data !== 'string' || data.trim() === '')) {
      throw fail(`icons.${name} must be a non-empty path data string or an array of them`);
    }
    out[name] = Object.freeze([...paths]);
  }
  return Object.freeze(out);
}

/**
 * @param {Document} doc
 * @param {string} name
 * @param {{ size?: number, icons?: Readonly<Record<string, readonly string[]>> }} [options] size in CSS px, 20 by
 *   default; `icons` is the host's replacement map (`controller.icons`)
 * @returns {SVGElement}
 */
export function createIcon(doc, name, { size = 20, icons } = {}) {
  if (!hasIcon(name)) {
    throw new InteractionError(`Unknown icon "${String(name)}"`, { code: 'UNKNOWN_ICON', field: 'icon' });
  }
  if (!doc || typeof doc.createElementNS !== 'function') {
    throw new InteractionError('A DOM document with createElementNS is required to draw icons', { code: 'MISSING_DOM', field: 'document' });
  }
  const svg = doc.createElementNS(SVG_NS, 'svg');
  const attributes = {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
    class: 'chart-ui-icon',
    'data-icon': name,
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const data of icons?.[name] ?? ICONS[name]) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data);
    svg.appendChild(path);
  }
  return svg;
}
