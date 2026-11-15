import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { computeRegression } from '../src/drawings/analytics.js';

const series = values => values.map((value, index) => ({ index, value }));
const geometry = { hasBinding: () => true, getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }), resolveX: a => Number(a.anchorBarId.slice(1)) + a.offset, logicalToX: x => x * 10, priceToY: p => 150 - p, yToPrice: y => 150 - y, getPriceScaleMode: () => 'linear', getIndexCount: () => 10, getSlot: i => ({ time: i * 1000 }), indexOf: id => Number(id.slice(1)), getSeriesValues: () => series([10, 13, 14, 18]) };
const make = () => createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry, historyLimit: 10 });
const input = { type: 'regressionChannel', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b0', offset: 0, price: 10 }, { anchorBarId: 'b3', offset: 0, price: 18 }], props: { seriesId: 'price', upperK: 3, lowerK: 1, showR: true } };

test('regression correlation reports trends and unavailable cases', () => {
  for (const [values, expected] of [[[10,12,14,16], 1], [[16,14,12,10], -1]]) {
    const r = computeRegression({ x1: 0, x2: 3, series: series(values) });
    assert.ok(Math.abs(r.correlation.value - expected) < 1e-12);
  }
  assert.equal(computeRegression({ x1: 0, x2: 1, series: series([10,12]) }).correlation.reason, 'insufficient-points');
  assert.equal(computeRegression({ x1: 0, x2: 3, series: series([10,10,10,10]) }).correlation.reason, 'zero-variance');
});

test('asymmetric channel exposes lines and rejects old documents atomically', () => {
  const s = make(), id = s.add(input).id, layout = s.layout(id);
  for (const role of ['regression-middle','regression-upper','regression-lower','regression-fill']) assert.ok(layout.primitives.some(p => p.role === role), role);
  assert.ok(layout.labels.some(label => label.text.startsWith('r = ')));
  const before = s.export(), old = structuredClone(before); old.schemaVersion--; old.drawings[0].props.k = 2;
  assert.throws(() => s.import(old), /schemaVersion/); assert.deepEqual(s.export(), before);
  assert.throws(() => s.update(id, { props: { k: 2 } }), error => error.field === 'props.k');
  assert.deepEqual(s.export(), before);
});
