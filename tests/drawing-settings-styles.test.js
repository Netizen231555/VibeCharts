// Saved styles and shared-style planning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySavedDrawingStyle, saveDrawingStyle, planDrawingStyle } from '../src/ui/drawing-settings/index.js';
import { makeStore } from './settings-fixtures.js';

const two = (a = 2, b = 8) => [{ anchorBarId: `b${a}`, offset: 0, price: 40 }, { anchorBarId: `b${b}`, offset: 0, price: 60 }];
const add = (store, type, extra = {}) => store.add({ type, paneId: 'main', scaleId: 'right', anchors: two(), ...extra });
const note = (store, extra = {}) => store.add({ type: 'text', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b5', offset: 0, price: 50 }], props: { text: 't' }, ...extra });

test('a saved style applies to drawings of its type, marks them and undoes in one step', () => {
  const store = makeStore();
  const source = add(store, 'segment', { style: { color: '#c0392b', width: 4, dash: 'dashed' } });
  const saved = saveDrawingStyle(store, source.id, 'Support');
  assert.deepEqual([saved.type, saved.name, saved.style.color, saved.style.width], ['segment', 'Support', '#c0392b', 4]);
  const a = add(store, 'segment', { anchors: two(3, 9) });
  const b = add(store, 'segment', { anchors: two(4, 10) });
  const before = store.export();
  applySavedDrawingStyle(store, [a.id, b.id], saved.id);
  for (const id of [a.id, b.id]) assert.deepEqual([store.get(id).style, store.get(id).ownStyle], [saved.style, true]);
  store.undo();
  assert.deepEqual(store.export(), before);
});

test('the wrong type, an unknown style and locked drawings are refused without changes', () => {
  const store = makeStore();
  const source = add(store, 'segment', { style: { color: '#c0392b' } });
  const saved = saveDrawingStyle(store, source.id, 'Red');
  const rectangle = add(store, 'rectangle');
  const locked = add(store, 'segment', { anchors: two(3, 9), locked: true });
  const free = add(store, 'segment', { anchors: two(4, 10) });
  const before = store.export();
  assert.throws(() => applySavedDrawingStyle(store, [free.id, rectangle.id], saved.id), error => error.code === 'incompatible-style' && error.id === rectangle.id);
  assert.throws(() => applySavedDrawingStyle(store, [free.id], 'style-999'), error => error.code === 'unknown-style' && error.id === 'style-999');
  assert.throws(() => applySavedDrawingStyle(store, [free.id, locked.id], saved.id), error => error.code === 'locked');
  assert.throws(() => applySavedDrawingStyle(store, [], saved.id), error => error.field === 'ids');
  assert.deepEqual(store.export(), before);
});

test('saving validates the name and writes the current style', () => {
  const store = makeStore();
  const a = add(store, 'rectangle', { style: { fill: true, fillOpacity: 0.4 } });
  for (const name of ['', '   ', 'x'.repeat(201), 5, null]) {
    assert.throws(() => saveDrawingStyle(store, a.id, name), error => error.field === 'name', String(name));
  }
  const saved = saveDrawingStyle(store, a.id, 'x'.repeat(200));
  assert.equal(saved.style.fillOpacity, 0.4);
  assert.deepEqual(store.listStyles('rectangle').map(style => style.id), [saved.id]);
  assert.throws(() => saveDrawingStyle(store, 'missing', 'name'), error => error.code === 'unknown-drawing');
});

test('planning keeps only what each family allows', () => {
  const store = makeStore();
  const text = note(store);
  const segment = add(store, 'segment');
  const plan = planDrawingStyle(store.list(), { color: '#c0392b', width: 5, dash: 'dotted', opacity: 0.5, fill: true });
  const byId = new Map(plan.updates.map(update => [update.id, update.patch]));
  assert.deepEqual(Object.keys(byId.get(text.id).style).sort(), ['color', 'opacity'], 'a text note has colour and opacity only');
  assert.deepEqual(byId.get(text.id).style, { color: '#c0392b', opacity: 0.5 });
  assert.deepEqual(byId.get(segment.id).style, { color: '#c0392b', width: 5, dash: 'dotted', opacity: 0.5 });
  assert.equal('ownStyle' in byId.get(segment.id), false);
  assert.deepEqual([plan.skippedOwn, plan.skippedLocked], [[], []]);
});

test('planning skips individual and locked drawings and omits ones that would not change', () => {
  const store = makeStore();
  const eligible = add(store, 'segment');
  const own = add(store, 'segment', { anchors: two(3, 9), ownStyle: true });
  const locked = add(store, 'segment', { anchors: two(4, 10), locked: true });
  const group = store.createGroup('g');
  const grouped = add(store, 'segment', { anchors: two(5, 11), groupId: group.id });
  store.setLocked(group.id, true);
  const same = add(store, 'segment', { anchors: two(6, 12), style: { color: '#c0392b' } });
  const plan = planDrawingStyle(store.list(), { color: '#c0392b' }, { groups: store.listGroups() });
  assert.deepEqual(plan.updates.map(update => update.id), [eligible.id], 'only the eligible drawing is updated');
  assert.deepEqual(plan.skippedOwn, [own.id]);
  assert.deepEqual(plan.skippedLocked.sort(), [locked.id, grouped.id].sort());
  assert.ok(!plan.updates.some(update => update.id === same.id), 'a drawing already in that colour is omitted');
  const withOwn = planDrawingStyle(store.list(), { color: '#c0392b' }, { groups: store.listGroups(), includeOwn: true });
  assert.deepEqual(withOwn.updates.map(update => update.id).sort(), [eligible.id, own.id].sort());
  assert.deepEqual(withOwn.skippedOwn, []);
  // Without the groups a group lock cannot be seen, which is why the option exists.
  assert.ok(planDrawingStyle(store.list(), { color: '#c0392b' }).updates.some(update => update.id === grouped.id));
});

test('planning honours keys, preserves other style properties and carries ownStyle', () => {
  const store = makeStore();
  const a = add(store, 'rectangle', { style: { fill: true, width: 3 } });
  const plan = planDrawingStyle(store.list(), { color: '#c0392b', width: 7 }, { keys: ['color'], ownStyle: false });
  assert.deepEqual(plan.updates[0].patch.style, { ...store.get(a.id).style, color: '#c0392b' });
  assert.equal(plan.updates[0].patch.style.width, 3, 'keys keeps the other properties untouched');
  assert.equal(plan.updates[0].patch.ownStyle, false);
  const own = planDrawingStyle([{ ...store.get(a.id), ownStyle: true }], {}, { ownStyle: false, includeOwn: true });
  assert.equal(own.updates.length, 1, 'clearing ownStyle alone is a change');
  assert.equal(own.updates[0].patch.ownStyle, false);
});

test('one plan feeds the preview and the commit, and the commit is one undo step', () => {
  const store = makeStore();
  const ids = [add(store, 'segment'), add(store, 'rectangle', { anchors: two(3, 9) }), note(store)].map(drawing => drawing.id);
  const before = store.export();
  const plan = planDrawingStyle(store.list(), { color: '#c0392b', opacity: 0.4 });
  store.setDragPreview(plan.updates);
  assert.equal(store.layout(ids[0]).style.color, '#c0392b', 'the preview shows the plan');
  assert.deepEqual(store.export(), before, 'a preview is not a document change');
  store.setDragPreview(null);
  assert.equal(store.layout(ids[0]).style.color, '#4a9fd0');
  store.updateBatch(plan.updates);
  assert.deepEqual(ids.map(id => store.get(id).style.color), ['#c0392b', '#c0392b', '#c0392b']);
  assert.deepEqual(ids.map(id => store.get(id).ownStyle), [false, false, false], 'a shared edit never marks ownership');
  store.undo();
  assert.deepEqual(store.export(), before);
});
