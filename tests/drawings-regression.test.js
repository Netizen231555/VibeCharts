import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { computeRegression } from '../src/drawings/analytics.js';
import { normalizeProps } from '../src/drawings/tools.js';

const series = values => values.map((value, index) => ({ index, value }));
const geometry = { hasBinding: () => true, getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }), resolveX: a => Number(a.anchorBarId.slice(1)) + a.offset, logicalToX: x => x * 10, priceToY: p => 150 - p, yToPrice: y => 150 - y, getPriceScaleMode: () => 'linear', getIndexCount: () => 10, getSlot: i => ({ time: i * 1000 }), indexOf: id => Number(id.slice(1)), getSeriesValues: () => series([10, 13, 14, 18]) };
const make = () => createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry, historyLimit: 10 });
const input = { type: 'regressionChannel', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b0', offset: 0, price: 10 }, { anchorBarId: 'b3', offset: 0, price: 18 }], props: { seriesId: 'price', upperK: 3, lowerK: 1, showR: true } };

test('regression correlation reports trends and unavailable cases', () => {
  for (const [values, expected] of [[[10,12,14,16], 1], [[16,14,12,10], -1]]) {
    const r = computeRegression({ x1: 0, x2: 3, series: series(values) });
    assert.ok(Math.abs(r.correlation.value - expected) < 1e-12);
  }
  const noisy = computeRegression({ x1: 0, x2: 3, series: series([10,13,14,18]) });
  assert.ok(Math.abs(noisy.correlation.value - 12.5 / Math.sqrt(5 * 32.75)) < 1e-12);
  assert.equal(computeRegression({ x1: 0, x2: 1, series: series([10,12]) }).correlation.reason, 'insufficient-points');
  // Inexact constants leave a ~1e-30 residual sum of squares, so equality must be tested on the values.
  for (const [value, count] of [[10, 4], [0.1, 3], [0.1, 7], [0.1, 10], [0.1, 50], [0.7, 10], [123.456, 10], [99.99, 10], [0.001, 10]]) {
    const r = computeRegression({ x1: 0, x2: count - 1, series: series(Array(count).fill(value)) });
    assert.deepEqual(r.correlation, { available: false, reason: 'zero-variance' }, `${value} x${count}`);
  }
});

test('asymmetric channel exposes lines and rejects old documents atomically', () => {
  const s = make(), id = s.add(input).id, layout = s.layout(id);
  for (const role of ['regression-middle','regression-upper','regression-lower','regression-fill']) assert.ok(layout.primitives.some(p => p.role === role), role);
  const byRole = Object.fromEntries(layout.primitives.map(p => [p.role, p]));
  assert.ok(Math.abs((byRole['regression-middle'].y1 - byRole['regression-upper'].y1) - 3 * layout.regression.sigma) < 1e-12);
  assert.ok(Math.abs((byRole['regression-lower'].y1 - byRole['regression-middle'].y1) - layout.regression.sigma) < 1e-12);
  assert.equal(byRole['regression-fill'].stroke, false);
  assert.ok(layout.labels.some(label => label.text.startsWith('r = ')));
  const before = s.export(), old = structuredClone(before); old.schemaVersion--; old.drawings[0].props.k = 2;
  assert.throws(() => s.import(old), /schemaVersion/); assert.deepEqual(s.export(), before);
  assert.throws(() => s.update(id, { props: { k: 2 } }), error => error.field === 'props.k');
  assert.deepEqual(s.export(), before);
});

test('regression prop validation names invalid fields', () => {
  const props = { seriesId: 'price', upperK: 2, lowerK: 1 };
  assert.deepEqual(normalizeProps('regressionChannel', props), { ...props, showR: false, extend: { left: false, right: false } });
  for (const [patch, field] of [[{ upperK: -1 }, 'props.upperK'], [{ lowerK: Infinity }, 'props.lowerK'], [{ showR: 1 }, 'props.showR'], [{ extend: {} }, 'props.extend'], [{ k: 2 }, 'props.k']]) {
    assert.throws(() => normalizeProps('regressionChannel', { ...props, ...patch }), error => error.field === field);
  }
});

test('correlation label stays inside the pane', () => {
  const labelFor = (props, rect = { x: 0, y: 0, width: 200, height: 200 }, last = 'b3', values = [10, 13, 14, 18]) => {
    const store = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, historyLimit: 10,
      geometry: { ...geometry, getVisibleRect: () => rect, getSeriesValues: () => series(values) } });
    const drawing = store.add({ ...input, anchors: [input.anchors[0], { ...input.anchors[1], anchorBarId: last }], props: { ...input.props, ...props } });
    return store.layout(drawing.id).labels[0];
  };
  // Band far above the pane: the baseline is clamped instead of leaving the label offscreen.
  const high = labelFor({ upperK: 1000 });
  assert.ok(high.y >= 12 && high.y <= 196);
  // Range end at the pane edge: the text is right-aligned and its anchor stays inside.
  const edge = labelFor({ extend: { left: true, right: false } }, { x: 0, y: 0, width: 100, height: 200 }, 'b9',
    [10, 11, 13, 12, 15, 14, 16, 18, 17, 19]);
  assert.equal(edge.align, 'right');
  assert.ok(edge.x <= 96 && edge.x - edge.text.length * 8 >= 0);
  // Range wholly left or right of the visible pane: no label is pinned to an unrelated spot.
  assert.equal(labelFor({}, { x: 100, y: 0, width: 100, height: 200 }), undefined);
  assert.equal(labelFor({}, { x: -200, y: 0, width: 100, height: 200 }), undefined);
});

test('regression fit is memoised per series array and range', () => {
  const values = series([10, 13, 14, 18]);
  const first = computeRegression({ x1: 0, x2: 3, series: values });
  assert.equal(computeRegression({ x1: 3, x2: 0, series: values }), first);
  assert.notEqual(computeRegression({ x1: 0, x2: 2, series: values }), first);
  // A host that rebuilds the array after a data change gets a fresh fit.
  const changed = computeRegression({ x1: 0, x2: 3, series: series([10, 13, 14, 40]) });
  assert.notEqual(changed, first);
  assert.notEqual(changed.b, first.b);
  assert.equal('points' in first, false);
});

test('dragging one channel never refits the others', () => {
  const values = series(Array.from({ length: 120 }, (_, i) => 100 + Math.sin(i / 7) * 10 + i * 0.1));
  let iterations = 0;
  const counted = new Proxy(values, { get(target, key, receiver) {
    if (key === Symbol.iterator) iterations += 1;
    return Reflect.get(target, key, receiver);
  } });
  const store = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, historyLimit: 10,
    geometry: { ...geometry, getIndexCount: () => 120, getSeriesValues: () => counted } });
  const ids = Array.from({ length: 50 }, (_, k) => store.add({ ...input,
    anchors: [{ anchorBarId: `b${k}`, offset: 0, price: 100 }, { anchorBarId: `b${60 + k}`, offset: 0, price: 100 }] }).id);
  for (const id of ids) store.layout(id);
  const perFit = iterations / ids.length;
  assert.ok(Number.isInteger(perFit) && perFit > 0);
  iterations = 0;
  for (let step = 0; step < 40; step += 1) {
    store.setDragPreview([{ id: ids[0], patch: { anchors: [input.anchors[0], { ...input.anchors[1], anchorBarId: `b${5 + step}` }] } }]);
    for (const id of ids) store.layout(id);
  }
  // Each step introduces one new range; the 49 untouched channels hit the cache.
  assert.equal(iterations, 40 * perFit);
});
