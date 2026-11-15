import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { LINE_OPTIONS, normalizeProps } from '../src/drawings/tools.js';

const geometry = {
  hasBinding: () => true,
  getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  resolveX: anchor => Number(anchor.anchorBarId.slice(1)) + anchor.offset,
  logicalToX: value => value * 10,
  priceToY: price => 200 - price * 2,
  yToPrice: y => (200 - y) / 2,
  getIndexCount: () => 20,
  getSlot: () => 10,
  indexOf: id => Number(id.slice(1)),
  getSeriesValues: () => null,
};
const store = () => createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
const anchor = (index, price) => ({ anchorBarId: `b${index}`, offset: 0, price });
const add = (s, type, anchors, props = {}) => s.add({ paneId: 'main', scaleId: 'right', type, anchors, props }).id;

test('line option defaults and invalid values are normalized strictly', () => {
  for (const [type, defaults] of Object.entries(LINE_OPTIONS)) {
    const props = normalizeProps(type, type === 'anchoredVwap' ? { priceSeriesId: 'price', volumeSeriesId: 'volume' } : {});
    for (const [key, value] of Object.entries(defaults)) assert.deepEqual(props[key], value);
  }
  for (const [props, field] of [[{ extend: { right: true } }, 'props.extend.left'], [{ extend: { left: 1, right: true } }, 'props.extend.left'], [{ extend: { left: false, right: false, up: true } }, 'props.extend.up'], [{ midpoint: 'yes' }, 'props.midpoint'], [{ arrows: { start: 1, end: true } }, 'props.arrows.start']]) {
    assert.throws(() => normalizeProps('segment', props), error => error.field === field);
  }
  assert.throws(() => normalizeProps('rectangle', { arrows: { start: true, end: false } }), /arrows/);
});

test('extended geometry, heads, midpoint, handles and picking agree', () => {
  const s = store();
  const id = add(s, 'segment', [anchor(2, 50), anchor(8, 50)], { extend: { left: false, right: true }, arrows: { start: true, end: true }, midpoint: true });
  const layout = s.layout(id);
  const stroke = layout.primitives.find(p => p.kind === 'ray');
  assert.equal(stroke.x1, 20);
  assert.equal(stroke.x2, 200);
  assert.equal(layout.primitives.filter(p => p.role === 'arrowhead').length, 2);
  const marker = layout.primitives.find(p => p.role === 'midpoint');
  assert.equal(marker.cx, 50);
  assert.equal(layout.handles.length, 2);
  assert.equal(s.hitTest({ x: 150, y: 100 }).id, id);
  s.update(id, { props: { extend: { left: false, right: false } } });
  assert.equal(s.hitTest({ x: 150, y: 100 }), null);
  assert.equal(s.hitTest({ x: 50, y: 110 }), null);
});

test('degenerate extension is rejected without changing the drawing', () => {
  const s = store();
  const id = add(s, 'segment', [anchor(2, 50), anchor(2, 50)]);
  const before = s.get(id);
  assert.throws(() => s.update(id, { props: { extend: { left: false, right: true } } }), error => error.code === 'degenerate-direction');
  assert.deepEqual(s.get(id), before);
});
