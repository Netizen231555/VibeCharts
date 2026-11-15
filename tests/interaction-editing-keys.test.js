// Keyboard ownership and nudge planning of the drawing editing shortcuts. Run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKeyboard, DEFAULT_BINDINGS } from '../src/interaction/keyboard.js';
import { planNudge } from '../src/interaction/nudge.js';
import { createDrawingStore } from '../src/drawings/store.js';

const press = (key, extra = {}) => ({ key, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, target: null, ...extra });

test('selection actions win over camera actions only while a drawing is selected', () => {
  const keyboard = createKeyboard();
  assert.equal(keyboard.resolveEvent(press('ArrowLeft')), 'panLeft');
  assert.equal(keyboard.resolveEvent(press('ArrowLeft'), { selectionActive: true }), 'nudgeLeft');
  assert.equal(keyboard.resolveEvent(press('ArrowRight', { shiftKey: true }), { selectionActive: true }), 'nudgeRightTen');
  assert.equal(keyboard.resolveEvent(press('ArrowUp', { shiftKey: true })), 'priceZoomIn');
  assert.equal(keyboard.resolveEvent(press('ArrowUp', { shiftKey: true }), { selectionActive: true }), 'nudgeUpTen');
  assert.equal(keyboard.resolveEvent(press('ArrowDown', { shiftKey: true }), { selectionActive: true }), 'nudgeDownTen');
  // An arrow chord with no camera action stays with the page when nothing is selected.
  assert.equal(keyboard.resolveEvent(press('ArrowUp')), null);
  assert.equal(keyboard.resolveEvent(press('ArrowDown')), null);
  assert.equal(keyboard.resolveEvent(press('ArrowUp'), { selectionActive: true }), 'nudgeUp');
  // The explicit duplicate chord answers even without a selection so the caller can announce why nothing happened.
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true })), 'duplicateSelection');
  assert.equal(keyboard.resolveEvent(press('H', { shiftKey: true })), 'toggleDrawingsVisible');
  assert.equal(keyboard.resolveEvent(press('L', { shiftKey: true })), 'toggleDrawingsLocked');
  assert.equal(keyboard.resolveEvent(press('l')), 'toggleLogScale');
});

test('the keyboard crosshair keeps the arrow keys and disables selection actions', () => {
  const calls = [];
  const crosshair = { prev: () => { calls.push('prev'); return { ok: true }; }, next: () => { calls.push('next'); return { ok: true }; }, clear() {} };
  const keyboard = createKeyboard({ crosshair });
  keyboard.setCrosshairActive(true);
  assert.deepEqual(keyboard.resolveEvent(press('ArrowLeft'), { selectionActive: true }), { action: 'crosshairPrev', result: { ok: true } });
  assert.equal(keyboard.resolveEvent(press('ArrowUp'), { selectionActive: true }), null);
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true }), { selectionActive: true }), null);
  assert.deepEqual(calls, ['prev']);
  keyboard.setCrosshairActive(false);
  assert.equal(keyboard.resolveEvent(press('ArrowLeft'), { selectionActive: true }), 'nudgeLeft');
});

test('an armed tool switches the selection scope off', () => {
  const keyboard = createKeyboard();
  const armed = { selectionActive: true, selectionScope: false };
  assert.equal(keyboard.resolveEvent(press('ArrowLeft'), armed), 'panLeft');
  assert.equal(keyboard.resolveEvent(press('ArrowUp'), armed), null);
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true }), armed), null);
  assert.equal(keyboard.resolveEvent(press('H', { shiftKey: true }), armed), 'toggleDrawingsVisible');
});

test('editable targets, browser modifiers and handled events are never consumed', () => {
  const keyboard = createKeyboard();
  const field = { tagName: 'INPUT', parentElement: null, getAttribute: () => null };
  assert.equal(keyboard.resolveEvent(press('ArrowLeft'), { selectionActive: true, target: field }), null);
  assert.equal(keyboard.resolveEvent(press('ArrowLeft', { ctrlKey: true }), { selectionActive: true }), null);
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true, metaKey: true }), { selectionActive: true }), null);
  assert.equal(keyboard.resolveEvent(press('ArrowLeft', { defaultPrevented: true }), { selectionActive: true }), null);
});

test('bindings are rebindable and disableable; disabled selection bindings do not shadow the camera', () => {
  const keyboard = createKeyboard({ bindings: { nudgeLeft: null, nudgeLeftTen: 'a', duplicateSelection: 'x' } });
  assert.equal(keyboard.resolveEvent(press('ArrowLeft'), { selectionActive: true }), 'panLeft');
  assert.equal(keyboard.resolveEvent(press('a'), { selectionActive: true }), 'nudgeLeftTen');
  assert.equal(keyboard.resolveEvent(press('x')), 'duplicateSelection');
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true })), null);
  assert.equal(Object.hasOwn(keyboard.getBindings(), 'nudgeLeft'), false);
  assert.equal(keyboard.getBindings().duplicateSelection, 'x');
});

test('binding validation is transactional and only permits selection against camera overlap', () => {
  const keyboard = createKeyboard();
  const before = keyboard.getBindings();
  const rejected = [
    [{ toggleDrawingsVisible: 'shift+d' }, 'BINDING_CONFLICT'],
    [{ duplicateSelection: 'shift+arrowup' }, 'BINDING_CONFLICT'],
    [{ nudgeLeft: 'escape' }, 'BINDING_CONFLICT'],
    [{ toggleDrawingsLocked: 'arrowleft' }, 'BINDING_CONFLICT'],
    [{ nudgeLeft: 'ctrl+a' }, 'BINDING_RESERVED'],
    [{ duplicateSelection: 'f5' }, 'BINDING_RESERVED'],
    [{ nudgeLeft: 'contextmenu' }, 'BINDING_CONFLICT'],
    [{ nudgeBogus: 'a' }, 'INVALID_BINDING'],
  ];
  for (const [overrides, code] of rejected) {
    assert.throws(() => keyboard.setBindings(overrides), error => error.code === code, JSON.stringify(overrides));
    assert.deepEqual(keyboard.getBindings(), before, 'a rejected table leaves the previous one intact');
  }
  // A camera action may take over a selection chord, and a selection action a camera chord.
  keyboard.setBindings({ panLeft: 'shift+d', duplicateSelection: 'arrowleft', nudgeLeft: 'q' });
  assert.equal(keyboard.resolveEvent(press('ArrowLeft')), 'duplicateSelection');
  assert.equal(keyboard.resolveEvent(press('D', { shiftKey: true })), 'panLeft');
  for (const action of ['nudgeLeft', 'nudgeRight', 'nudgeUp', 'nudgeDown', 'nudgeLeftTen', 'nudgeRightTen', 'nudgeUpTen', 'nudgeDownTen',
    'duplicateSelection', 'toggleDrawingsVisible', 'toggleDrawingsLocked']) {
    assert.ok(Object.hasOwn(DEFAULT_BINDINGS, action), action);
  }
});

// ---- nudge planning -------------------------------------------------------------------------------------

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
const makeStore = () => createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
const anchors = (a = 2, b = 6, p = 40, q = 60) => [
  { anchorBarId: `b${a}`, offset: 0, price: p },
  { anchorBarId: `b${b}`, offset: 0, price: q },
];
const fakeChart = ({ steps = [0.05] } = {}) => ({
  surface: {
    resolveAnchor: anchor => geometry.resolveX(anchor),
    // A scale that cannot project a non-positive price, as a logarithmic one.
    priceToY: price => {
      if (!(price > 0)) throw new Error('LOG_RANGE');
      return geometry.priceToY(price);
    },
  },
  series: Object.assign(id => ({ metadata: () => ({ priceStep: steps[Number(id.slice(1))] }) }), {
    list: () => steps.map((_, index) => ({ id: `s${index}`, paneId: 'main', priceScaleId: 'right' })),
  }),
});
const adapter = { indexScaleFor: () => ({ length: BARS.length }) };

function setup(extra = []) {
  const store = makeStore();
  const added = [store.add({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors() }),
    store.add({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors(3, 8, 41, 55) }), ...extra.map(input => store.add(input))];
  return { store, ids: added.map(drawing => drawing.id) };
}

test('horizontal nudges change offsets only, and Shift moves by ten', () => {
  const { store, ids } = setup();
  const one = planNudge({ chart: fakeChart(), store, adapter, ids, action: 'nudgeRight' });
  assert.deepEqual(one.updates[0].patch.anchors.map(anchor => anchor.offset), [1, 1]);
  assert.deepEqual(one.updates[0].patch.anchors.map(anchor => anchor.anchorBarId), ['b2', 'b6']);
  assert.deepEqual(one.updates[0].patch.anchors.map(anchor => anchor.price), [40, 60], 'prices are untouched');
  const ten = planNudge({ chart: fakeChart(), store, adapter, ids: [ids[0]], action: 'nudgeRightTen' });
  assert.deepEqual(ten.updates[0].patch.anchors.map(anchor => anchor.offset), [10, 10]);
  const left = planNudge({ chart: fakeChart(), store, adapter, ids, action: 'nudgeLeft' });
  assert.deepEqual(left.updates[1].patch.anchors.map(anchor => anchor.offset), [-1, -1]);
});

test('vertical nudges use the scale price step without binary drift', () => {
  const { store, ids } = setup([{ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors(1, 4, 0.1, 0.2) }]);
  const plan = planNudge({ chart: fakeChart({ steps: [0.1] }), store, adapter, ids: [ids[2]], action: 'nudgeUp' });
  assert.deepEqual(plan.updates[0].patch.anchors.map(anchor => anchor.price), [0.2, 0.3]);
  const down = planNudge({ chart: fakeChart({ steps: [0.05] }), store, adapter, ids: [ids[0]], action: 'nudgeDownTen' });
  assert.deepEqual(down.updates[0].patch.anchors.map(anchor => anchor.price), [39.5, 59.5]);
});

test('a selection is refused as a whole and nothing is clamped', () => {
  const { store, ids } = setup([
    { type: 'verticalLine', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b5', offset: 0 }] },
    { type: 'horizontalLevel', paneId: 'main', scaleId: 'right', anchors: [{ price: 50 }] },
  ]);
  const chart = fakeChart();
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[0], ids[2]], action: 'nudgeUp' }).refusal, 'noAnchor');
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[0], ids[3]], action: 'nudgeLeft' }).refusal, 'noAnchor');
  assert.equal(planNudge({ chart: fakeChart({ steps: [] }), store, adapter, ids: [ids[0]], action: 'nudgeUp' }).refusal, 'noStep');
  assert.equal(planNudge({ chart: fakeChart({ steps: [0.1, 0.2] }), store, adapter, ids: [ids[0]], action: 'nudgeUp' }).refusal, 'noStep',
    'series that disagree give no step');
  // The end of the data refuses the whole selection even if one drawing could still move.
  const edge = store.add({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors(2, 19) });
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[0], edge.id], action: 'nudgeRight' }).refusal, 'outOfData');
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[0], edge.id], action: 'nudgeLeftTen' }).refusal, 'outOfData');
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[0]], action: 'nudgeRightTen' }).refusal, undefined);
  // A move that no scale can project (a log scale cannot draw a non-positive price) is refused, not clamped.
  const low = store.add({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: anchors(2, 5, 0.04, 0.2) });
  assert.equal(planNudge({ chart, store, adapter, ids: [low.id], action: 'nudgeDown' }).refusal, 'invalid');
});

test('locked drawings, including those locked by a group, refuse the whole selection', () => {
  const { store, ids } = setup();
  const group = store.createGroup('g');
  const inner = store.createGroup({ name: 'inner', parentId: group.id });
  store.addToGroup(inner.id, ids[1]);
  const chart = fakeChart();
  assert.equal(planNudge({ chart, store, adapter, ids, action: 'nudgeRight' }).updates.length, 2);
  store.setLocked(group.id, true);
  assert.equal(planNudge({ chart, store, adapter, ids, action: 'nudgeRight' }).refusal, 'locked');
  store.setLocked(group.id, false);
  store.setLocked(ids[0], true);
  assert.equal(planNudge({ chart, store, adapter, ids, action: 'nudgeRight' }).refusal, 'locked');
  assert.equal(planNudge({ chart, store, adapter, ids: [ids[1]], action: 'nudgeRight' }).updates.length, 1);
});

test('repeated nudges apply through one coalesced undo step and refused ones leave history alone', () => {
  const { store, ids } = setup();
  store.selectMany(ids);
  const before = store.export();
  const chart = fakeChart();
  const run = action => {
    const plan = planNudge({ chart, store, adapter, ids: store.getSelection(), action });
    return store.updateBatch(plan.updates, { coalesceKey: 'nudge' });
  };
  run('nudgeRight'); run('nudgeRight'); run('nudgeUp');
  assert.equal(store.get(ids[0]).anchors[0].offset, 2);
  assert.equal(store.get(ids[0]).anchors[0].price, 40.05);
  assert.equal(store.undo(), true);
  assert.deepEqual(store.export(), before, 'the whole run was one undo step');
  store.redo();
  assert.equal(store.get(ids[0]).anchors[0].offset, 2);
  store.setLocked(ids[0], true);
  const refused = planNudge({ chart, store, adapter, ids: store.getSelection(), action: 'nudgeRight' });
  assert.equal(refused.refusal, 'locked');
  assert.equal(store.get(ids[0]).anchors[0].offset, 2);
});
