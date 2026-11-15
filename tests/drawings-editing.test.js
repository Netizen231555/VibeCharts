// Contract tests of the editing shortcuts: duplicate, clone preview, bulk visibility and lock, and coalesced
// batches. Run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';

const BARS = Array.from({ length: 20 }, (_, i) => ({ barId: `b${i}` }));
const RECT = { x: 0, y: 0, width: 200, height: 200 };
const adapter = {
  hasBinding: ({ paneId }) => paneId === 'main',
  getVisibleRect: () => RECT,
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
const CONTEXT = { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' };
const makeStore = () => createDrawingStore({ context: CONTEXT, geometry: adapter, historyLimit: 20 });
const anchors = (a = 2, b = 6, p = 40, q = 60) => [
  { anchorBarId: `b${a}`, offset: 0, price: p },
  { anchorBarId: `b${b}`, offset: 0, price: q },
];
const segment = (extra = {}) => ({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors(), ...extra });

test('duplicate copies every field with fresh ids, selects the copies and undoes as one step', () => {
  const store = makeStore();
  const group = store.createGroup('g');
  const first = store.add(segment({ style: { color: '#ff0000', width: 3 }, groupId: group.id, locked: true }));
  const second = store.add(segment({ anchors: anchors(3, 8) }));
  store.selectMany([second.id]);
  const before = store.export();
  const copies = store.duplicate([first.id, second.id]);
  assert.equal(copies.length, 2);
  assert.deepEqual(copies.map(copy => copy.id), ['drawing-3', 'drawing-4']);
  assert.deepEqual(store.getSelection(), ['drawing-3', 'drawing-4']);
  assert.equal(copies[0].groupId, group.id);
  assert.equal(copies[0].locked, true);
  assert.equal(copies[0].style.color, '#ff0000');
  assert.equal(copies[0].style.width, 3);
  assert.deepEqual(store.get(first.id), first, 'locked source is untouched');
  assert.deepEqual(store.order(), ['drawing-1', 'drawing-2', 'drawing-3', 'drawing-4']);

  assert.equal(store.undo(), true);
  assert.deepEqual(store.export(), before);
  assert.deepEqual(store.getSelection(), [second.id]);
  assert.equal(store.redo(), true);
  assert.deepEqual(store.getSelection(), ['drawing-3', 'drawing-4']);
  assert.deepEqual(store.get('drawing-4').anchors, second.anchors);
});

test('duplicate applies placement updates atomically and rejects invalid input without a partial copy', () => {
  const store = makeStore();
  const one = store.add(segment());
  const two = store.add(segment({ anchors: anchors(3, 8) }));
  const ray = store.add(segment({ type: 'ray' }));
  const before = store.export();
  const moved = store.duplicate([one.id, two.id], { updates: [
    { id: one.id, patch: { anchors: anchors(4, 8) } },
    { id: two.id, patch: { anchors: anchors(5, 9) } },
  ] });
  assert.equal(moved[0].anchors[0].anchorBarId, 'b4');
  assert.equal(moved[1].anchors[1].anchorBarId, 'b9');
  assert.equal(store.get(one.id).anchors[0].anchorBarId, 'b2');
  store.undo();
  assert.deepEqual(store.export(), before);

  const invalid = [
    () => store.duplicate([one.id, 'missing']),
    () => store.duplicate([]),
    () => store.duplicate(one.id, { updates: [{ id: two.id, patch: {} }] }),
    // A ray needs a direction; coincident anchors are invalid geometry and nothing is copied.
    () => store.duplicate([one.id, ray.id], { updates: [{ id: ray.id, patch: { anchors: [anchors()[0], anchors()[0]] } }] }),
    () => store.duplicate(one.id, { updates: [{ id: one.id, patch: { paneId: 'other' } }] }),
  ];
  for (const attempt of invalid) assert.throws(attempt);
  assert.deepEqual(store.export(), before);
  assert.equal(store.canRedo(), true, 'failed duplicates leave history alone');
  assert.equal(store.list().length, 3);
});

test('clone preview is transient and validated like a copy', () => {
  const store = makeStore();
  const one = store.add(segment());
  const before = store.export();
  const history = store.canUndo();
  assert.equal(store.clonePreview(), null);
  store.setClonePreview([{ id: one.id, patch: { anchors: anchors(5, 9) } }]);
  const ghost = store.clonePreview();
  assert.equal(ghost.length, 1);
  assert.equal(ghost[0].resolved, true);
  assert.equal(ghost[0].anchors[0].x, 50);
  assert.deepEqual(store.export(), before, 'export excludes the ghost');
  assert.deepEqual(store.getSelection(), []);
  assert.equal(store.canUndo(), history);
  assert.equal(store.layout(one.id).anchors[0].x, 20, 'the original stays where it is');

  const ray = store.add(segment({ type: 'ray' }));
  assert.throws(() => store.setClonePreview([{ id: ray.id, patch: { anchors: [anchors()[0], anchors()[0]] } }]));
  assert.equal(store.clonePreview().length, 1, 'a rejected update keeps the previous ghost until it is cleared');
  store.setClonePreview(null);
  assert.equal(store.clonePreview(), null);

  store.setClonePreview([{ id: one.id, patch: {} }]);
  store.import(store.export());
  assert.equal(store.clonePreview(), null, 'import clears the ghost');
});

test('bulk visibility and locking cover drawings and groups in one undoable step', () => {
  const store = makeStore();
  assert.deepEqual(store.summary(), { drawings: 0, groups: 0, visible: null, locked: null });
  assert.equal(store.setAllVisible(false), false);
  assert.equal(store.setAllLocked(true), false);
  assert.equal(store.canUndo(), false);

  const group = store.createGroup('g');
  const a = store.add(segment({ style: { color: '#00ff00' }, groupId: group.id }));
  const b = store.add(segment({ locked: true }));
  const c = store.add(segment({ visible: false }));
  store.setVisibility(group.id, false);
  store.select(b.id);
  assert.deepEqual(store.summary(), { drawings: 3, groups: 1, visible: 'mixed', locked: 'mixed' });
  const before = store.export();

  assert.equal(store.setAllVisible(true), true);
  assert.deepEqual(store.summary().visible, 'all');
  assert.equal(store.get(c.id).visible, true);
  assert.equal(store.listGroups()[0].visible, true);
  assert.deepEqual(store.get(a.id).style, a.style, 'styles are untouched');
  assert.equal(store.setAllVisible(true), false, 'no change adds no history');

  assert.equal(store.setAllLocked(true), true);
  assert.equal(store.summary().locked, 'all');
  assert.equal(store.setAllLocked(false), true);
  assert.equal(store.summary().locked, 'none');

  assert.equal(store.setAllVisible(false), true);
  assert.deepEqual(store.getSelection(), [], 'hiding clears the selection');
  assert.equal(store.summary().visible, 'none');

  for (let i = 0; i < 4; i += 1) store.undo();
  assert.deepEqual(store.export(), before, 'each bulk call is exactly one undo step');
  assert.deepEqual(store.getSelection(), [b.id]);
  assert.throws(() => store.setAllVisible('yes'), error => error.field === 'visible');
  assert.throws(() => store.setAllLocked(1), error => error.field === 'locked');
});

test('updateBatch coalesces only consecutive commands with the same key and targets', () => {
  const store = makeStore();
  const a = store.add(segment());
  const b = store.add(segment({ anchors: anchors(3, 8) }));
  store.selectMany([a.id, b.id]);
  const shift = (drawing, bars) => ({ id: drawing.id, patch: { anchors: drawing.anchors.map(anchor => ({ ...anchor, offset: anchor.offset + bars })) } });
  const nudge = bars => store.updateBatch([shift(store.get(a.id), bars), shift(store.get(b.id), bars)], { coalesceKey: 'nudge' });
  const original = store.export();

  assert.equal(nudge(1), true);
  assert.equal(nudge(1), true);
  assert.equal(nudge(1), true);
  assert.equal(store.get(a.id).anchors[0].offset, 3);
  const moved = store.export();
  store.undo();
  assert.deepEqual(store.export(), original, 'one undo restores the position before the run');
  assert.equal(store.canUndo(), true, 'earlier history survives');
  store.redo();
  assert.deepEqual(store.export(), moved);

  // A selection change, a different command, undo/redo and another key each end the run.
  store.undo();
  nudge(1);
  store.select(a.id);
  store.select(null);
  store.selectMany([a.id, b.id]);
  nudge(1);
  assert.equal(store.get(a.id).anchors[0].offset, 2);
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 1, 'a selection change split the run');
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 0);

  nudge(1);
  store.setVisibility(b.id, true);
  store.update(a.id, { style: { width: 4 } });
  nudge(1);
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 1, 'an intervening command ends the run');
  store.undo();
  store.undo();
  nudge(1);
  assert.equal(store.updateBatch([shift(store.get(a.id), 1), shift(store.get(b.id), 1)], { coalesceKey: 'other' }), true);
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 1, 'a different key does not merge');

  assert.throws(() => store.updateBatch([], { coalesceKey: 5 }), error => error.field === 'options.coalesceKey');
  assert.throws(() => store.updateBatch([], 'nudge'), error => error.field === 'options');
});

test('undo after a coalesced run starts a fresh run and keeps the redo stack honest', () => {
  const store = makeStore();
  const a = store.add(segment());
  store.select(a.id);
  const step = () => store.updateBatch([{ id: a.id, patch: { anchors: store.get(a.id).anchors.map(anchor => ({ ...anchor, offset: anchor.offset + 1 })) } }], { coalesceKey: 'nudge' });
  step(); step();
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 0);
  assert.equal(store.canRedo(), true);
  step();
  assert.equal(store.canRedo(), false, 'a new command clears redo');
  store.undo();
  assert.equal(store.get(a.id).anchors[0].offset, 0);
});
