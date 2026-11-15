// The `ownStyle` marker of a drawing: default, validation, history, persistence and its independence from applyStyle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';

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
const make = () => createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
const segment = (extra = {}) => ({
  type: 'segment', paneId: 'main', scaleId: 'right',
  anchors: [{ anchorBarId: 'b2', offset: 0, price: 40 }, { anchorBarId: 'b6', offset: 0, price: 60 }], ...extra,
});

test('ownStyle defaults to false and rejects non-booleans everywhere it can be written', () => {
  const store = make();
  const a = store.add(segment());
  assert.equal(store.get(a.id).ownStyle, false);
  assert.equal(store.list()[0].ownStyle, false);
  assert.throws(() => store.add(segment({ ownStyle: 'yes' })), error => error.field === 'ownStyle');
  assert.throws(() => store.update(a.id, { ownStyle: 'yes' }), error => error.field === 'ownStyle');
  assert.throws(() => store.updateBatch([{ id: a.id, patch: { ownStyle: 1 } }]), error => error.field === 'ownStyle');
  const document = store.export();
  document.drawings[0].ownStyle = null;
  assert.throws(() => store.import(document), error => error.field === 'ownStyle');
  assert.equal(store.get(a.id).ownStyle, false, 'a rejected write leaves the drawing unchanged');
});

test('ownStyle changes in the same undo step as the style it accompanies', () => {
  const store = make();
  const a = store.add(segment());
  store.update(a.id, { style: { color: '#c0392b' }, ownStyle: true });
  assert.deepEqual([store.get(a.id).style.color, store.get(a.id).ownStyle], ['#c0392b', true]);
  assert.equal(store.undo(), true);
  assert.deepEqual([store.get(a.id).style.color, store.get(a.id).ownStyle], ['#4a9fd0', false]);
  assert.equal(store.redo(), true);
  assert.equal(store.get(a.id).ownStyle, true);

  const b = store.add(segment());
  store.updateBatch([{ id: a.id, patch: { ownStyle: false } }, { id: b.id, patch: { ownStyle: true } }]);
  store.undo();
  assert.deepEqual([store.get(a.id).ownStyle, store.get(b.id).ownStyle], [true, false]);
});

test('ownStyle survives export, import and snapshots; documents without it import as false', () => {
  const store = make();
  const a = store.add(segment({ ownStyle: true }));
  store.add(segment());
  const document = store.export();
  assert.deepEqual(document.drawings.map(drawing => drawing.ownStyle), [true, false]);
  assert.equal(store.snapshot().drawings[0].ownStyle, true);
  const fresh = make();
  fresh.import(document);
  assert.equal(fresh.get(a.id).ownStyle, true);
  const legacy = structuredClone(document);
  for (const drawing of legacy.drawings) delete drawing.ownStyle;
  const other = make();
  other.import(legacy);
  assert.deepEqual(other.list().map(drawing => drawing.ownStyle), [false, false]);
});

test('a locked drawing refuses an ownStyle change like any non-flag change', () => {
  const store = make();
  const a = store.add(segment({ locked: true }));
  assert.throws(() => store.update(a.id, { ownStyle: true }), error => error.code === 'locked');
  const group = store.createGroup('g');
  const b = store.add(segment({ groupId: group.id }));
  store.setLocked(group.id, true);
  assert.throws(() => store.update(b.id, { ownStyle: true }), error => error.code === 'locked');
  assert.throws(() => store.updateBatch([{ id: b.id, patch: { ownStyle: true } }]), error => error.code === 'locked');
  assert.equal(store.get(b.id).ownStyle, false);
});

test('applyStyle and duplicate keep the field as it is', () => {
  const store = make();
  const a = store.add(segment({ ownStyle: true }));
  const b = store.add(segment());
  store.applyStyle([a.id, b.id], { color: '#00ff00' });
  assert.deepEqual([store.get(a.id).ownStyle, store.get(b.id).ownStyle], [true, false]);
  const [copy] = store.duplicate(a.id);
  assert.equal(copy.ownStyle, true, 'a copy keeps the individual style marker');
});
