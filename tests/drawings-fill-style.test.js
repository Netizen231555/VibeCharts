// Contract tests of the single-colour fill rule: families and validation, the fillable geometry
// (including the parallel channel quad and open paths), interior hit testing of filled paths,
// and the versioned export document. Run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore, DRAWINGS_SCHEMA_VERSION } from '../src/drawings/store.js';
import { completeStyle, validateStyle } from '../src/drawings/styles.js';
import { DRAWING_TOOLS } from '../src/drawings/tools.js';

// A geometry adapter with a deterministic linear mapping: 20 bars of width 10, price 0..100 on a 200px pane.
const BARS = Array.from({ length: 20 }, (_, i) => ({ barId: `b${i}` }));
const RECT = { x: 0, y: 0, width: 200, height: 200 };
const adapter = {
  hasBinding: () => true,
  getVisibleRect: () => RECT,
  resolveX: anchor => {
    const index = BARS.findIndex(bar => bar.barId === anchor.anchorBarId);
    return index < 0 ? null : index + anchor.offset;
  },
  logicalToX: logical => logical * 10,
  priceToY: price => 200 - price * 2,
  yToPrice: y => (200 - y) / 2,
  getIndexCount: () => BARS.length,
  getSlot: () => 10,
  indexOf: barId => BARS.findIndex(bar => bar.barId === barId),
  getSeriesValues: () => null,
};
const CONTEXT = { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' };
const makeStore = () => createDrawingStore({ context: CONTEXT, geometry: adapter, historyLimit: 20 });
const ANCHOR = (i, price) => ({ anchorBarId: `b${i}`, offset: 0, price });
const add = (store, type, anchors, style) => store.add({ paneId: 'main', scaleId: 'right', type, anchors, style }).id;

test('filled family defaults to fill false and fillOpacity 0.18', () => {
  const style = completeStyle('filled', {});
  assert.equal(style.fill, false);
  assert.equal(style.fillOpacity, 0.18);
});

test('fillColor is rejected everywhere it could return', () => {
  for (const family of ['line', 'filled', 'text', 'marker']) {
    assert.throws(() => validateStyle(family, { fillColor: '#ffffff' }), error => {
      assert.equal(error.code, 'style-property-not-allowed');
      assert.equal(error.property, 'fillColor');
      return true;
    });
  }
  const store = makeStore();
  assert.throws(() => add(store, 'rectangle', [ANCHOR(0, 10), ANCHOR(5, 20)], { fillColor: '#ffffff' }),
    error => error.code === 'style-property-not-allowed' && error.property === 'fillColor');
});

test('fillOpacity is a filled-family property validated in range', () => {
  assert.throws(() => validateStyle('line', { fillOpacity: 0.5 }), error => {
    assert.equal(error.code, 'style-property-not-allowed');
    assert.equal(error.property, 'fillOpacity');
    assert.equal(error.family, 'line');
    return true;
  });
  for (const value of [1.5, -0.1, '0.3']) {
    assert.throws(() => validateStyle('filled', { fillOpacity: value }), error => {
      assert.equal(error.code, 'invalid-style');
      assert.equal(error.property, 'fillOpacity');
      return true;
    });
  }
  assert.equal(validateStyle('filled', { fillOpacity: 0.4 }).fillOpacity, 0.4);
});

test('polyline, bezier and brush are filled-family tools', () => {
  for (const type of ['polyline', 'bezier', 'brush']) {
    assert.equal(DRAWING_TOOLS[type].family, 'filled');
  }
  const store = makeStore();
  const id = add(store, 'polyline', [ANCHOR(0, 10), ANCHOR(3, 80), ANCHOR(6, 30)], {});
  const style = store.get(id).style;
  assert.equal(style.fill, false);
  assert.equal(style.fillOpacity, 0.18);
});

test('interior-bearing primitives carry fillable, arrowheads and measure areas do not', () => {
  const store = makeStore();
  const rect = store.layout(add(store, 'rectangle', [ANCHOR(1, 20), ANCHOR(5, 60)], {}));
  assert.equal(rect.primitives[0].fillable, true);
  const ellipse = store.layout(add(store, 'ellipse', [ANCHOR(1, 20), ANCHOR(5, 60)], {}));
  assert.equal(ellipse.primitives[0].fillable, true);
  const arrow = store.layout(add(store, 'arrow', [ANCHOR(1, 20), ANCHOR(5, 60)], {}));
  assert.ok(arrow.primitives.some(p => p.role === 'arrowhead' && p.fillable !== true));
  const measure = store.layout(add(store, 'measure', [ANCHOR(1, 20), ANCHOR(5, 60)], {}));
  assert.ok(measure.primitives.some(p => p.role === 'measure-area' && p.fillable !== true));
});

test('the parallel channel fill is the quad between its two clipped lines', () => {
  const store = makeStore();
  const id = add(store, 'parallelChannel', [ANCHOR(0, 40), ANCHOR(10, 60), ANCHOR(0, 20)], { fill: true });
  const { primitives } = store.layout(id);
  const fill = primitives.find(p => p.role === 'channel-fill');
  const base = primitives.find(p => p.role === 'channel-base');
  const parallel = primitives.find(p => p.role === 'channel-parallel');
  assert.ok(fill, 'channel-fill polygon exists');
  assert.equal(fill.points.length, 4);
  assert.equal(fill.fillable, true);
  assert.equal(fill.stroke, false);
  assert.deepEqual(
    fill.points.map(point => [point.x, point.y]),
    [[base.x1, base.y1], [base.x2, base.y2], [parallel.x2, parallel.y2], [parallel.x1, parallel.y1]],
  );
});

test('a filled path is hit inside its interior, an unfilled one is not', () => {
  const store = makeStore();
  const filled = add(store, 'polyline', [ANCHOR(2, 20), ANCHOR(8, 90), ANCHOR(14, 20)], { fill: true });
  const point = { x: 100, y: 100 }; // inside the triangle (20,160)(80,20)(140,160): at x=100 the top edge is y≈67
  assert.equal(store.hitTest(point).id, filled);
  store.update(filled, { style: { fill: false } });
  assert.equal(store.hitTest(point), null);
});

test('a path with fewer than three distinct points has no interior and no error', () => {
  const store = makeStore();
  const id = add(store, 'polyline', [ANCHOR(2, 20), ANCHOR(8, 90)], { fill: true });
  const { primitives } = store.layout(id);
  assert.equal(primitives.length, 1);
  assert.equal(primitives[0].fillable, true);
});

test('the export document is version 2 and round-trips filled styles', () => {
  assert.equal(DRAWINGS_SCHEMA_VERSION, 2);
  const store = makeStore();
  const rect = add(store, 'rectangle', [ANCHOR(1, 20), ANCHOR(5, 60)], { fill: true, fillOpacity: 0.3 });
  add(store, 'polyline', [ANCHOR(2, 20), ANCHOR(8, 90), ANCHOR(14, 20)], { fill: true });
  store.saveStyle({ name: 'filled', type: 'rectangle', style: store.get(rect).style });
  const document = store.export();
  assert.equal(document.schemaVersion, 2);

  const fresh = makeStore();
  fresh.import(document);
  assert.deepEqual(fresh.get(rect).style, store.get(rect).style);
  assert.equal(fresh.get(rect).style.fillOpacity, 0.3);
});

test('a version 1 document is rejected naming fillColor and leaves the store unchanged', () => {
  const store = makeStore();
  const mine = add(store, 'rectangle', [ANCHOR(1, 20), ANCHOR(5, 60)], {});
  const document = { ...store.export(), schemaVersion: 1 };
  assert.throws(() => store.import(document), error => {
    assert.equal(error.code, 'unsupported-version');
    assert.equal(error.field, 'schemaVersion');
    assert.match(error.message, /fillColor/);
    return true;
  });
  assert.deepEqual(store.list().map(drawing => drawing.id), [mine]);
});

test('a version 2 document carrying fillColor is rejected and nothing is imported', () => {
  const store = makeStore();
  add(store, 'rectangle', [ANCHOR(1, 20), ANCHOR(5, 60)], {});
  const document = store.export();
  const withStray = {
    ...document,
    drawings: [{ ...document.drawings[0], style: { ...document.drawings[0].style, fillColor: '#ffffff' } }],
  };
  assert.throws(() => store.import(withStray), error => error.code === 'style-property-not-allowed' && error.property === 'fillColor');
  assert.equal(store.list().length, 1);
});

test('applying a saved filled style is one undo step', () => {
  const store = makeStore();
  const rect = add(store, 'rectangle', [ANCHOR(1, 20), ANCHOR(5, 60)], {});
  store.saveStyle({ name: 'filled', type: 'rectangle', style: { color: '#2962ff', fill: true, fillOpacity: 0.3 } });
  store.applyStyle([rect], { fill: true, fillOpacity: 0.3 });
  assert.equal(store.get(rect).style.fill, true);
  store.undo();
  assert.equal(store.get(rect).style.fill, false);
  assert.equal(store.get(rect).style.fillOpacity, 0.18);
});
