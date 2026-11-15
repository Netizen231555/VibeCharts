import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore, FIB_TOOL_OPTIONS, fibDefaultLevels } from '../src/drawings/index.js';
import { drawLayout } from '../src/drawings/render.js';
import { drawingIntersectsRect } from '../src/integration/drawings.js';

let mode = 'linear';
const geometry = {
  hasBinding: () => true, getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 300 }),
  resolveX: a => Number(a.anchorBarId.slice(1)) + a.offset, logicalToX: x => x * 10,
  priceToY: price => mode === 'log' ? 250 - Math.log(price) * 20 : 250 - price,
  yToPrice: y => mode === 'log' ? Math.exp((250 - y) / 20) : 250 - y,
  getPriceScaleMode: () => mode, getIndexCount: () => 20, getSlot: i => ({ time: i * 1000 }),
  indexOf: id => Number(id.slice(1)), getSeriesValues: () => null,
};
const store = () => createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry, historyLimit: 20 });
const anchor = (n, price) => ({ anchorBarId: `b${n}`, offset: 0, price });
const add = (s, type, props = {}, anchors = [anchor(2, 100), anchor(10, 200)]) => s.add({ type, paneId: 'main', scaleId: 'right', anchors, props }).id;

test('Fibonacci options, fresh defaults and validation are tool-specific', () => {
  assert.ok(FIB_TOOL_OPTIONS.fibFan.includes('grid'));
  assert.ok(!FIB_TOOL_OPTIONS.fibArcs.includes('showPrices'));
  const one = fibDefaultLevels('fibRetracement'), two = fibDefaultLevels('fibRetracement');
  assert.equal(one.length, 7); one[0].coefficient = 999; assert.notEqual(two[0].coefficient, 999);
  assert.throws(() => fibDefaultLevels('segment'), /segment/);
  const s = store(), id = add(s, 'fibRetracement', { levels: [{ coefficient: .5, color: 'red', opacity: .6 }] });
  assert.deepEqual(s.get(id).props.levels[0], { coefficient: .5, visible: true, color: 'red', opacity: .6 });
  const before = s.export();
  for (const levels of [[], [{ coefficient: .5 }, { coefficient: .5 }], [{ coefficient: 1, color: 'notacolor' }], [{ coefficient: 1, opacity: 2 }], [{ coefficient: 1, bad: true }]]) {
    assert.throws(() => s.update(id, { props: { levels } })); assert.deepEqual(s.export(), before);
  }
  assert.throws(() => s.update(id, { props: { extend: { right: true } } }));
  s.update(id, { props: { showPrices: true } }); s.undo(); assert.equal(s.get(id).props.showPrices, false);
  assert.throws(() => add(s, 'fibArcs', { showPrices: true }), /showPrices/);
  assert.throws(() => add(s, 'fibArcs', { levels: [{ coefficient: 0 }] }));
});

test('current schema imports old level shapes and large lists without migration', () => {
  const s = store(), id = add(s, 'fibRetracement', { levels: Array.from({ length: 25 }, (_, i) => ({ coefficient: i * 100 })) });
  const doc = s.export(); delete doc.drawings[0].props.showPercent;
  for (const level of doc.drawings[0].props.levels) delete level.opacity;
  s.import(doc); assert.equal(s.get(id).props.levels.length, 25); assert.equal(s.get(id).props.levels[0].opacity, 1);
  const invalid = structuredClone(doc); invalid.drawings[0].props.labelPosition = 'middle'; const before = s.export();
  assert.throws(() => s.import(invalid)); assert.deepEqual(s.export(), before);
  invalid.schemaVersion--; assert.throws(() => s.import(invalid));
});

test('retracement and extension use bound scale space', () => {
  mode = 'linear'; const s = store();
  const r = add(s, 'fibRetracement', { levels: [{ coefficient: .5 }] });
  const e = add(s, 'fibExtension', { levels: [{ coefficient: .5 }] }, [anchor(2, 100), anchor(8, 200), anchor(12, 150)]);
  const price = id => s.layout(id).primitives.find(p => p.coefficient === .5)?.price;
  assert.equal(price(r), 150); assert.equal(price(e), 200);
  mode = 'log'; assert.ok(Math.abs(price(r) - Math.sqrt(20000)) < 1e-8); assert.ok(Math.abs(price(e) - 150 * Math.sqrt(2)) < 1e-8);
  mode = 'percent'; assert.equal(price(r), 150); mode = 'linear';
});

test('missing required scale mode method is rejected', () => {
  const { getPriceScaleMode, ...missing } = geometry;
  assert.throws(() => createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry: missing, historyLimit: 1 }), error => error.field === 'geometry.getPriceScaleMode');
});

test('fan extension follows anchor order including reversed and crossed anchors', () => {
  mode = 'linear'; const s = store();
  const anchors = [anchor(15, 100), anchor(5, 200)];
  const id = add(s, 'fibFan', { levels: [{ coefficient: .5 }] }, anchors);
  const ray = () => s.layout(id).primitives.find(p => p.coefficient === .5 && ['line', 'ray', 'segment'].includes(p.kind));
  const initial = ray(); assert.ok(initial); assert.ok(initial.x2 <= initial.x1);
  s.update(id, { props: { reverse: true, extend: { left: false, right: false } } });
  const reversed = ray(); assert.ok(reversed); assert.ok(reversed.x2 >= reversed.x1);
});

test('per-level color, visibility and opacity survive export and undo', () => {
  const s = store(), id = add(s, 'fibRetracement', { levels: [{ coefficient: 0, color: 'red', opacity: .5 }, { coefficient: .5, visible: false }, { coefficient: 1 }] });
  const before = s.export();
  assert.equal(s.get(id).props.levels[0].color, 'red');
  assert.equal(s.get(id).props.levels[0].opacity, .5);
  s.update(id, { props: { levels: [{ coefficient: 1 }] } });
  s.undo(); assert.deepEqual(s.get(id).props.levels, before.drawings[0].props.levels);
  s.import(before); assert.equal(s.get(id).props.levels[1].visible, false);
});

test('reverse retracement and logarithmic extension keep the third base', () => {
  mode = 'linear'; const s = store();
  const r = add(s, 'fibRetracement', { reverse: true, levels: [{ coefficient: .236 }] });
  const price = (id, coefficient) => s.layout(id).primitives.find(p => p.coefficient === coefficient)?.price;
  assert.ok(Math.abs(price(r, .236) - 176.4) < 1e-8);
  const e = add(s, 'fibExtension', { reverse: true, levels: [{ coefficient: 1 }] }, [anchor(2, 100), anchor(8, 200), anchor(12, 150)]);
  assert.equal(price(e, 1), 50);
  mode = 'log'; assert.ok(Math.abs(price(e, 1) - 75) < 1e-8);
  mode = 'linear';
});

test('style defaults do not mutate individually edited levels', () => {
  const s = store(), id = add(s, 'fibRetracement', { levels: [{ coefficient: 0, color: '#123456', opacity: .5 }, { coefficient: 1 }] });
  const levels = s.get(id).props.levels;
  s.applyStyle(id, { color: '#ff0000' });
  assert.deepEqual(s.get(id).props.levels, levels);
});

test('hidden levels merge filled bands and picking follows fill', () => {
  mode = 'linear'; const s = store();
  const id = add(s, 'fibRetracement', { fill: true, fillOpacity: .25, levels: [
    { coefficient: 0 }, { coefficient: .5, visible: false }, { coefficient: 1, color: 'red', opacity: .5 },
  ] });
  const layout = s.layout(id), zones = layout.primitives.filter(p => p.kind === 'zone');
  assert.equal(zones.length, 1);
  assert.equal(zones[0].color, 'red');
  assert.equal(zones[0].opacity, .125);
  assert.equal(s.hitTest({ x: 60, y: 90 }, { radius: 0 })?.id, id);
  s.update(id, { props: { fill: false } });
  assert.equal(s.hitTest({ x: 60, y: 90 }, { radius: 0 }), null);
});

test('arc ring interior is selectable only when filled', () => {
  mode = 'linear'; const s = store();
  const id = add(s, 'fibArcs', { fill: true, levels: [{ coefficient: .2 }, { coefficient: .5 }] });
  assert.equal(s.layout(id).primitives.filter(p => p.kind === 'ring').length, 1);
  assert.equal(s.hitTest({ x: 60, y: 150 }, { radius: 0 })?.id, id);
  s.update(id, { props: { fill: false } });
  assert.equal(s.hitTest({ x: 60, y: 150 }, { radius: 0 }), null);
});

test('visible half-arc labels remain inside the pane', () => {
  mode = 'linear'; const s = store();
  const id = add(s, 'fibArcs', { fullCircles: false, levels: [{ coefficient: .5 }, { coefficient: 1 }] });
  const rect = geometry.getVisibleRect();
  for (const label of s.layout(id).labels) {
    assert.ok(label.x >= rect.x && label.x <= rect.x + rect.width);
    assert.ok(label.y >= rect.y && label.y <= rect.y + rect.height);
  }
});

test('line extension reaches requested pane edges and fan grid follows visible levels', () => {
  mode = 'linear'; const s = store();
  const retracement = add(s, 'fibRetracement', { levels: [{ coefficient: .5 }], extend: { left: true, right: false } });
  let line = s.layout(retracement).primitives.find(p => p.role === 'fib-level');
  assert.equal(line.x1, 0); assert.equal(line.x2, 100);
  s.update(retracement, { props: { extend: { left: false, right: true } } });
  line = s.layout(retracement).primitives.find(p => p.role === 'fib-level');
  assert.equal(line.x1, 20); assert.equal(line.x2, 200);
  const fan = add(s, 'fibFan', { grid: true, levels: [{ coefficient: .5 }, { coefficient: 1, visible: false }] });
  assert.equal(s.layout(fan).primitives.filter(p => p.role === 'fib-fan-grid').length, 2);
});

test('arc full and half modes and reversed centers follow references', () => {
  mode = 'linear'; const s = store(), anchors = [anchor(2, 100), anchor(10, 200)];
  const id = add(s, 'fibArcs', { levels: [{ coefficient: .5 }], fullCircles: true }, anchors);
  let arc = s.layout(id).primitives.find(p => p.role === 'fib-arc');
  assert.equal(arc.kind, 'circle'); assert.equal(arc.cx, 20);
  s.update(id, { props: { fullCircles: false, reverse: true } });
  arc = s.layout(id).primitives.find(p => p.role === 'fib-arc');
  assert.equal(arc.kind, 'arc'); assert.equal(arc.cx, 100);
});

test('unrepresentable logarithmic levels are skipped without losing finite levels', () => {
  mode = 'log'; const s = store();
  const id = add(s, 'fibRetracement', { levels: [{ coefficient: .5 }, { coefficient: 1e308 }] });
  const lines = s.layout(id).primitives.filter(p => p.role === 'fib-level');
  assert.equal(lines.length, 1); assert.equal(lines[0].coefficient, .5);
  mode = 'linear';
});

test('fan extends either side in anchor order on crossed anchors', () => {
  mode = 'linear'; const s = store(), anchors = [anchor(15, 100), anchor(5, 200)];
  const id = add(s, 'fibFan', { levels: [{ coefficient: .5 }], extend: { left: false, right: true } }, anchors);
  let ray = s.layout(id).primitives.find(p => p.role === 'fib-fan-ray');
  assert.equal(ray.x1, 150); assert.equal(ray.x2, 0);
  s.update(id, { props: { extend: { left: true, right: false } } });
  ray = s.layout(id).primitives.find(p => p.role === 'fib-fan-ray');
  assert.equal(ray.x1, 200); assert.equal(ray.x2, 50);
});

test('per-level styles do not leak to following primitives or labels', () => {
  const calls = [], stack = [];
  const ctx = {
    strokeStyle: 'black', fillStyle: 'black', globalAlpha: 1, textAlign: 'left', lineWidth: 1,
    save() { stack.push({ strokeStyle: this.strokeStyle, fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, textAlign: this.textAlign, lineWidth: this.lineWidth }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() {}, rect() {}, clip() {}, setLineDash() {}, moveTo() {}, lineTo() {},
    stroke() { calls.push(['stroke', this.strokeStyle, this.globalAlpha]); },
    fillText() { calls.push(['text', this.fillStyle, this.globalAlpha, this.textAlign]); },
  };
  drawLayout(ctx, { style: { color: 'blue', opacity: .8, width: 1 }, primitives: [
    { kind: 'segment', x1: 0, y1: 0, x2: 1, y2: 1, color: 'red', opacity: .4 },
    { kind: 'segment', x1: 0, y1: 1, x2: 1, y2: 2 },
  ], labels: [
    { text: 'one', x: 0, y: 0, color: 'red', opacity: .4, align: 'right' },
    { text: 'two', x: 0, y: 0 },
  ], handles: [] }, { x: 0, y: 0, width: 100, height: 100 });
  assert.deepEqual(calls, [['stroke', 'red', .4], ['stroke', 'blue', .8], ['text', 'red', .4, 'right'], ['text', 'blue', .8, 'left']]);
});

test('retracement labels fit the visible line at clipped and near pane edges', () => {
  mode = 'linear';
  for (const [anchors, position] of [
    [[anchor(5, 100), anchor(25, 200)], 'end'],
    [[anchor(-5, 100), anchor(15, 200)], 'start'],
    [[anchor(.3, 100), anchor(19.7, 200)], 'end'],
    [[anchor(.3, 100), anchor(19.7, 200)], 'start'],
  ]) {
    const s = store(), id = add(s, 'fibRetracement', { levels: [{ coefficient: .5, label: 'Visible label' }], labelPosition: position }, anchors);
    const l = s.layout(id).labels[0];
    const left = l.align === 'right' ? l.x - l.width : l.align === 'center' ? l.x - l.width / 2 : l.x;
    assert.ok(left >= 0 && left + l.width <= 200, JSON.stringify(l));
  }
});

test('coincident Fibonacci x anchors retain the rightward line span', () => {
  const s = store();
  for (const type of ['fibRetracement', 'fibExtension']) {
    const anchors = type === 'fibExtension'
      ? [anchor(5, 100), anchor(8, 200), anchor(5, 150)]
      : [anchor(5, 100), anchor(5, 200)];
    const id = add(s, type, { levels: [{ coefficient: .5 }] }, anchors);
    const line = s.layout(id).primitives.find(p => p.coefficient === .5);
    assert.equal(line.x1, 50); assert.equal(line.x2, 200);
  }
});

test('fully offscreen Fibonacci labels do not measure text', () => {
  let measured = 0;
  const g = { ...geometry, getTextContext: () => ({ measureText() { measured++; return { width: 30 }; } }) };
  const s = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry: g, historyLimit: 10 });
  add(s, 'fibRetracement', { levels: [{ coefficient: .5 }] }, [anchor(-4, 100), anchor(-3, 200)]);
  measured = 0;
  s.layout(s.list()[0].id);
  assert.equal(measured, 0);
});

test('negative angle sweep is hit as the clockwise canvas arc', () => {
  const s = store();
  const id = add(s, 'angle', {}, [anchor(15, 150), anchor(10, 150), anchor(10, 200)]);
  const arc = s.layout(id).primitives.find(p => p.kind === 'arc');
  assert.ok(arc && arc.endAngle < arc.startAngle);
  assert.equal(s.hitTest({ x: arc.cx - arc.r, y: arc.cy }, { radius: 0 })?.id, id);
});

test('render culling retains thick strokes and selection highlights at pane edges', () => {
  const rect = { x: 0, y: 0, width: 200, height: 200 };
  const layout = { bounds: { x: 0, y: -14, width: 200, height: 8 }, style: { width: 40 }, primitives: [] };
  assert.equal(drawingIntersectsRect(layout, rect, false), true);
  layout.style.width = 1;
  assert.equal(drawingIntersectsRect(layout, rect, false), false);
  layout.bounds.y = -8;
  assert.equal(drawingIntersectsRect(layout, rect, true), true);
});

test('coincident anchors beyond the right edge do not create visible Fibonacci lines', () => {
  for (const type of ['fibRetracement', 'fibExtension']) {
    let calls = 0;
    const g = { ...geometry, getTextContext: () => ({ measureText() { calls++; return { width: 20 }; } }) };
    const s = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry: g, historyLimit: 10 });
    const anchors = type === 'fibRetracement' ? [anchor(25, 100), anchor(25, 150)] : [anchor(25, 100), anchor(24, 150), anchor(25, 125)];
    const id = add(s, type, { levels: [{ coefficient: .5 }] }, anchors);
    calls = 0;
    const layout = s.layout(id);
    assert.equal(layout.labels.length, 0);
    assert.equal(calls, 0);
    assert.ok(!drawingIntersectsRect({ ...layout, style: s.get(id).style }, geometry.getVisibleRect(), false));
  }
});

test('offscreen Fibonacci families avoid canvas measurement and keep visible time labels', () => {
  for (const type of ['fibRetracement', 'fibExtension', 'fibFan', 'fibArcs', 'fibTimeZones']) {
    let calls = 0;
    const g = { ...geometry, getTextContext: () => ({ measureText() { calls++; return { width: 50 }; } }) };
    const s = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'src' }, geometry: g, historyLimit: 10 });
    const xy = [anchor(-4, 100), anchor(-3, 100)];
    const anchors = type === 'fibTimeZones' ? xy.map(({ anchorBarId, offset }) => ({ anchorBarId, offset }))
      : type === 'fibExtension' ? [...xy, anchor(-3, 100)] : xy;
    const props = { levels: [{ coefficient: 1, label: 'foo' }], ...(type === 'fibFan' ? { extend: { left: false, right: false } } : {}) };
    const id = add(s, type, props, anchors);
    calls = 0;
    const layout = s.layout(id);
    assert.equal(calls, 0, type);
    assert.equal(layout.labels.length, 0, type);
  }
  const s = store();
  const id = add(s, 'fibTimeZones', { levels: [{ coefficient: 1, label: 'foo' }] }, [{ anchorBarId: 'b2', offset: 0 }, { anchorBarId: 'b3', offset: 0 }]);
  assert.equal(s.layout(id).labels[0].text, 'foo');
});
