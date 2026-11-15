// Core style fields: what the library's four style families already have (colour, width, dash, opacity, fill).
import { ALL_FAMILIES, bool, color, number, select } from './helpers.js';

export const owner = 'style';

export const fields = [
  color('style.color', 'color', 'appearance', 10, ['style', 'color'], { families: ALL_FAMILIES }),
  number('style.opacity', 'opacity', 'appearance', 20, ['style', 'opacity'], { families: ALL_FAMILIES }, { min: 0, max: 1, step: 0.05 }),
  number('style.width', 'width', 'stroke', 10, ['style', 'width'], { families: ['line', 'filled'] }, { min: 1, max: 20, step: 1 }),
  // A marker keeps its size in `style.width`; the field has its own label so it never reads as a line width.
  number('style.size', 'markerSize', 'stroke', 10, ['style', 'width'], { families: ['marker'] }, { min: 4, max: 64, step: 1 }),
  select('style.dash', 'dash', 'stroke', 20, ['style', 'dash'], { families: ['line', 'filled'] }, ['solid', 'dashed', 'dotted']),
  bool('style.fill', 'fill', 'fill', 10, ['style', 'fill'], { families: ['filled'] }),
  number('style.fillOpacity', 'fillOpacity', 'fill', 20, ['style', 'fillOpacity'], { families: ['filled'] }, { min: 0, max: 1, step: 0.02 }),
];
