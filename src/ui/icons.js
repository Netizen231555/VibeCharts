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
  // chart types
  candles: ['M8 3v4M8 17v4M6 7h4v10H6z', 'M16 2v4M16 14v5M14 6h4v8h-4z'],
  bars: ['M7 4v16M4 8h3M7 15h3', 'M17 4v16M14 11h3M17 6h3'],
  line: ['M3 17l5-6 4 3 8-9'],
  area: ['M3 18l5-7 4 3 8-9v13H3z'],
  // drawing tools (canonical ids of the drawings module)
  cursor: ['M5 3l6 17 2.2-7.3L20.5 10.5z'],
  segment: ['M6 18L18 6', 'M4 16h4v4H4zM16 4h4v4h-4z'],
  ray: ['M6 18L21 3', circle(5, 19, 2)],
  horizontalLevel: ['M3 12h18', 'M10 9.5h4v5h-4z'],
  verticalLine: ['M12 3v18', 'M9.5 10h5v4h-5z'],
  parallelChannel: ['M4 14L15 5M9 20L20 11', 'M4 14l5 6M15 5l5 6'],
  rectangle: ['M5 7h14v10H5z'],
  fibRetracement: ['M4 5h16M4 10h16M4 15h11M4 20h16'],
  text: ['M6 6h12M12 6v13M9.5 19h5'],
  measure: ['M4 16L16 4l4 4L8 20z', 'M9 9l2 2M12 6l2 2M6 12l2 2'],
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

/** Tool ids the host may use that name the same shape as a canonical drawing tool. */
export const ICON_ALIASES = Object.freeze({
  trendLine: 'segment',
  horizontalLine: 'horizontalLevel',
});

export const ICON_NAMES = Object.freeze(Object.keys(ICONS));

function resolveName(name) {
  return Object.prototype.hasOwnProperty.call(ICON_ALIASES, name) ? ICON_ALIASES[name] : name;
}

export function hasIcon(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ICONS, resolveName(name));
}

/**
 * @param {Document} doc
 * @param {string} name
 * @param {{ size?: number }} [options] size in CSS px, 20 by default
 * @returns {SVGElement}
 */
export function createIcon(doc, name, { size = 20 } = {}) {
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
    'data-icon': resolveName(name),
  };
  for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value);
  for (const data of ICONS[resolveName(name)]) {
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', data);
    svg.appendChild(path);
  }
  return svg;
}
