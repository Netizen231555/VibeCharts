// Drawing activation: who may raise `drawingActivate`, with which payload, and that it never edits the document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { createActivation } from '../src/interaction/activation.js';
import { createEmitter } from '../src/interaction/emitter.js';

const BARS = Array.from({ length: 20 }, (_, i) => ({ barId: `b${i}` }));
const geometry = {
  hasBinding: ({ paneId }) => paneId === 'main',
  getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  resolveX: anchor => {
    const index = BARS.findIndex(bar => bar.barId === anchor.anchorBarId);
    return index < 0 ? null : index + anchor.offset;
  },
  logicalToX: logical => logical * 10,
  priceToY: price => 200 - price * 2,
  getPriceScaleMode: () => 'linear',
  yToPrice: y => (200 - y) / 2,
  getIndexCount: () => BARS.length,
  getSlot: index => BARS[index] ?? null,
  indexOf: barId => BARS.findIndex(bar => bar.barId === barId),
  getSeriesValues: () => null,
};

function harness() {
  const store = createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
  const emitter = createEmitter();
  const events = [];
  const selectionLog = [];
  let destroyed = false;
  emitter.on('drawingActivate', payload => events.push({ ...payload, selectionAtEmit: store.getSelection() }));
  const activation = createActivation({
    getStore: () => store,
    getDrawing: id => { try { return store.get(id); } catch { return null; } },
    selectDrawing: id => { selectionLog.push(id); store.select(id); },
    adoptStoreSelection: () => {},
    emit: (event, payload) => emitter.emit(event, payload),
    isDestroyed: () => destroyed,
  });
  const add = n => store.add({ type: 'segment', paneId: 'main', scaleId: 'right',
    anchors: [{ anchorBarId: `b${n}`, offset: 0, price: 40 }, { anchorBarId: `b${n + 3}`, offset: 0, price: 60 }] });
  return { store, activation, events, selectionLog, add, destroy: () => { destroyed = true; }, emitter };
}
const body = id => ({ kind: 'drawing', drawingId: id });
const idle = { toolArmed: false, gestureActive: false };

test('a double click on the only selected drawing emits once with the pointer source', () => {
  const t = harness();
  const a = t.add(2);
  t.store.select(a.id);
  assert.equal(t.activation.fromPointer(body(a.id), idle), true);
  assert.equal(t.events.length, 1);
  assert.deepEqual({ ...t.events[0] }, { drawingIds: [a.id], drawingId: a.id, source: 'pointer', selectionAtEmit: [a.id] });
});

test('a double click on an unselected drawing makes it the selection before the event; a handle activates too', () => {
  const t = harness();
  const a = t.add(2);
  const b = t.add(8);
  t.store.select(a.id);
  t.activation.fromPointer({ kind: 'handle', drawingId: b.id, anchorIndex: 0 }, idle);
  assert.deepEqual(t.events[0].selectionAtEmit, [b.id], 'the selection already held the id when the event ran');
  assert.deepEqual(t.store.getSelection(), [b.id]);
});

test('a multi-selection stays and is listed in selection order', () => {
  const t = harness();
  const [a, b, c] = [t.add(2), t.add(6), t.add(10)];
  t.store.selectMany([c.id, a.id, b.id]);
  t.activation.fromPointer(body(a.id), idle);
  assert.deepEqual(t.events[0].drawingIds, [c.id, a.id, b.id]);
  assert.equal(t.events[0].drawingId, c.id);
  assert.deepEqual(t.selectionLog, [], 'the selection was not reselected');
});

test('an armed tool, a gesture in flight, empty plot and axes never activate', () => {
  const t = harness();
  const a = t.add(2);
  assert.equal(t.activation.fromPointer(body(a.id), { toolArmed: true, gestureActive: false }), false);
  assert.equal(t.activation.fromPointer(body(a.id), { toolArmed: false, gestureActive: true }), false);
  assert.equal(t.activation.fromPointer({ kind: 'plot' }, idle), false);
  assert.equal(t.activation.fromPointer({ kind: 'axis', axis: 'price' }, idle), false);
  assert.equal(t.events.length, 0);
  assert.deepEqual(t.store.getSelection(), [], 'a refused double click does not even select');
});

test('a locked drawing still activates', () => {
  const t = harness();
  const a = t.add(2);
  t.store.setLocked(a.id, true);
  assert.equal(t.activation.fromPointer(body(a.id), idle), true);
  assert.equal(t.events.length, 1);
});

test('the keyboard path emits only for a non-empty selection', () => {
  const t = harness();
  const a = t.add(2);
  assert.equal(t.activation.fromKeyboard(), false);
  assert.equal(t.events.length, 0);
  t.store.select(a.id);
  assert.equal(t.activation.fromKeyboard(), true);
  assert.equal(t.events[0].source, 'keyboard');
});

test('activateDrawing without ids uses the selection and throws on an empty one', () => {
  const t = harness();
  const a = t.add(2);
  assert.throws(() => t.activation.fromApi(), error => error.code === 'NO_DRAWING_SELECTED' && error.field === 'ids');
  assert.equal(t.events.length, 0);
  t.store.select(a.id);
  t.activation.fromApi();
  assert.deepEqual([t.events[0].source, t.events[0].drawingIds], ['api', [a.id]]);
  assert.throws(() => t.activation.fromApi([]), error => error.code === 'NO_DRAWING_SELECTED');
  assert.deepEqual(t.store.getSelection(), [a.id], 'an empty list does not clear the selection');
});

test('activateDrawing with ids selects them and validates before touching the selection', () => {
  const t = harness();
  const [a, b] = [t.add(2), t.add(8)];
  t.store.select(a.id);
  assert.throws(() => t.activation.fromApi(['missing']), error => error.code === 'UNKNOWN_DRAWING' && /missing/.test(error.message));
  assert.throws(() => t.activation.fromApi([b.id, 'missing']), error => error.code === 'UNKNOWN_DRAWING');
  assert.deepEqual(t.store.getSelection(), [a.id], 'the selection is unchanged after an error');
  assert.throws(() => t.activation.fromApi('nope'), error => error.code === 'INVALID_DRAWING_IDS' && error.field === 'ids');
  assert.throws(() => t.activation.fromApi([1]), error => error.code === 'INVALID_DRAWING_IDS');
  assert.equal(t.events.length, 0);
  t.activation.fromApi([b.id, a.id]);
  assert.deepEqual(t.events[0].drawingIds, [b.id, a.id]);
  t.store.setVisibility(b.id, false);
  assert.throws(() => t.activation.fromApi([b.id]), error => error.code === 'UNKNOWN_DRAWING', 'a hidden drawing counts as unknown');
});

test('activation is not an edit and stops after destroy', () => {
  const t = harness();
  const a = t.add(2);
  const before = t.store.export();
  const canUndo = t.store.canUndo();
  t.activation.fromPointer(body(a.id), idle);
  t.activation.fromKeyboard();
  t.activation.fromApi([a.id]);
  assert.equal(t.store.canUndo(), canUndo);
  assert.deepEqual(t.store.export().drawings, before.drawings);
  t.destroy();
  assert.throws(() => t.activation.fromApi([a.id]), error => error.code === 'INTERACTION_DESTROYED');
  t.emitter.offAll();
  const count = t.events.length;
  t.emitter.emit('drawingActivate', {});
  assert.equal(t.events.length, count, 'subscribers receive nothing after the emitter is cleared');
});
