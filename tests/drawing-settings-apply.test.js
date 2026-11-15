// Applying edited settings: validation before any write, composition, ownership, coordinates and atomic history.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyDrawingSettings } from '../src/ui/drawing-settings/index.js';
import { fibDefaultLevels } from '../src/drawings/tools.js';
import { makeStore } from './settings-fixtures.js';

const two = (a = 2, b = 8) => [{ anchorBarId: `b${a}`, offset: 0, price: 40 }, { anchorBarId: `b${b}`, offset: 0, price: 60 }];
const add = (store, type, extra = {}) => store.add({ type, paneId: 'main', scaleId: 'right', anchors: two(), ...extra });
const apply = (store, ids, changes, context) => applyDrawingSettings(store, { ids, changes, context });

test('a colour applies to different tools as one undo step', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const b = add(store, 'rectangle');
  const c = store.add({ type: 'text', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b5', offset: 0, price: 50 }], props: { text: 'note' } });
  const before = store.export();
  const result = apply(store, [a.id, b.id, c.id], [{ fieldId: 'style.color', value: '#c0392b' }]);
  assert.deepEqual([result.changed, result.ids], [true, [a.id, b.id, c.id]]);
  for (const id of [a.id, b.id, c.id]) assert.deepEqual([store.get(id).style.color, store.get(id).ownStyle], ['#c0392b', true]);
  assert.equal(store.undo(), true);
  assert.deepEqual(store.export(), before);
});

test('two fields that write the same nested object both take effect in one step', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const b = add(store, 'ray');
  const before = store.export();
  apply(store, [a.id, b.id], [{ fieldId: 'props.extend.left', value: true }, { fieldId: 'props.extend.right', value: false }]);
  assert.deepEqual(store.get(a.id).props.extend, { left: true, right: false });
  assert.deepEqual(store.get(b.id).props.extend, { left: true, right: false });
  assert.equal(store.get(a.id).ownStyle, false, 'props-only edits leave ownStyle alone');
  store.undo();
  assert.deepEqual(store.export(), before);
});

test('an invalid value changes nothing, even next to a valid one', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const before = store.export();
  assert.throws(() => apply(store, [a.id], [{ fieldId: 'style.color', value: '#00ff00' }, { fieldId: 'style.width', value: 0 }]),
    error => error.code === 'INVALID_DRAWING_SETTING' && error.field === 'style.width' && /1 to 20/.test(error.message));
  assert.deepEqual(store.export(), before);
  for (const [fieldId, value] of [['style.color', 'not a colour'], ['style.opacity', 2], ['style.width', 2.5e9], ['style.dash', 'wavy'],
    ['props.extend.left', 'yes'], ['props.stats.position', 'top'], ['props.label.text', 'a\nb\nc\nd'], ['props.label.size', 7.5]]) {
    assert.throws(() => apply(store, [a.id], [{ fieldId, value }]), error => error.code === 'INVALID_DRAWING_SETTING' && error.field === fieldId, fieldId);
  }
  assert.deepEqual(store.export(), before);
});

test('malformed requests name the field', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const b = add(store, 'segment', { anchors: two(3, 9) });
  assert.throws(() => apply(store, [a.id], [{ fieldId: 'nope', value: 1 }]), error => error.code === 'UNKNOWN_DRAWING_SETTING' && error.field === 'nope');
  assert.throws(() => apply(store, [a.id], [{ fieldId: 'style.fill', value: true }]),
    error => error.code === 'SETTING_NOT_APPLICABLE' && error.field === 'style.fill' && error.message.includes(a.id));
  assert.throws(() => apply(store, [a.id, b.id], [{ fieldId: 'anchors', value: [] }]), error => error.code === 'SETTING_NOT_APPLICABLE' && error.field === 'anchors');
  assert.throws(() => apply(store, [a.id], [{ fieldId: 'style.color', value: '#fff' }, { fieldId: 'style.color', value: '#000' }]), error => error.field === 'style.color');
  assert.throws(() => apply(store, [], [{ fieldId: 'style.color', value: '#fff' }]), error => error.field === 'ids');
  assert.throws(() => apply(store, [a.id], []), error => error.field === 'changes');
});

test('a locked member refuses the whole edit with the store error', () => {
  const store = makeStore();
  const [a, b, c] = [add(store, 'segment'), add(store, 'segment', { anchors: two(3, 9) }), add(store, 'segment', { anchors: two(4, 10), locked: true })];
  const before = store.export();
  assert.throws(() => apply(store, [a.id, b.id, c.id], [{ fieldId: 'style.color', value: '#c0392b' }]),
    error => error.code === 'locked' && error.blockers.includes(c.id));
  assert.deepEqual(store.export(), before);
  // A locked drawing whose value already matches still refuses an edit that changes the others.
  const same = apply(store, [a.id, b.id], [{ fieldId: 'style.color', value: '#c0392b' }]);
  assert.equal(same.changed, true);
  assert.throws(() => apply(store, [a.id, b.id, c.id], [{ fieldId: 'style.color', value: '#c0392b' }, { fieldId: 'style.width', value: 3 }]), error => error.code === 'locked');
  assert.equal(store.get(a.id).style.width, 1);
});

test('requesting the current values is not an edit', () => {
  const store = makeStore();
  const a = add(store, 'segment', { style: { color: '#c0392b' } });
  const history = store.canUndo();
  const result = apply(store, [a.id], [{ fieldId: 'style.color', value: '#c0392b' }, { fieldId: 'props.extend.left', value: false }]);
  assert.deepEqual([result.changed, result.ids], [false, []]);
  assert.equal(store.canUndo(), history);
  assert.equal(store.get(a.id).ownStyle, false);
});

test('ownStyle moves with style edits only', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  apply(store, [a.id], [{ fieldId: 'anchors', value: [{ anchorBarId: 'b2', offset: 1.5, price: 40 }, { anchorBarId: 'b8', offset: 0, price: 61 }] }]);
  assert.equal(store.get(a.id).ownStyle, false);
  apply(store, [a.id], [{ fieldId: 'style.width', value: 4 }]);
  assert.equal(store.get(a.id).ownStyle, true);
  apply(store, [a.id], [{ fieldId: 'props.midpoint', value: true }]);
  assert.equal(store.get(a.id).ownStyle, true, 'a props edit keeps the marker as it was');
  store.undo(); store.undo();
  assert.equal(store.get(a.id).ownStyle, false);
});

test('coordinates keep the bar, accept fractions and negatives, and reject what the tool or scale cannot hold', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const level = store.add({ type: 'horizontalLevel', paneId: 'main', scaleId: 'right', anchors: [{ price: 50 }] });
  apply(store, [a.id], [{ fieldId: 'anchors', value: [{ anchorBarId: 'b2', offset: 3.5, price: 41 }, { anchorBarId: 'b8', offset: -2, price: 59.5 }] }]);
  assert.deepEqual(store.get(a.id).anchors, [{ anchorBarId: 'b2', offset: 3.5, price: 41 }, { anchorBarId: 'b8', offset: -2, price: 59.5 }]);
  const before = store.export();
  const rejected = [
    [[{ anchorBarId: 'b2', offset: 0, price: 1 }], /needs 2 anchors/],
    [[{ anchorBarId: 'b9', offset: 0, price: 1 }, { anchorBarId: 'b8', offset: 0, price: 1 }], /anchor 0 anchorBarId is read-only/],
    [[{ anchorBarId: 'b2', offset: Infinity, price: 1 }, { anchorBarId: 'b8', offset: 0, price: 1 }], /anchor 0 offset/],
    [[{ anchorBarId: 'b2', offset: 0, price: 1 }, { anchorBarId: 'b8', offset: 0, price: NaN }], /anchor 1 price/],
  ];
  for (const [value, pattern] of rejected) {
    assert.throws(() => apply(store, [a.id], [{ fieldId: 'anchors', value }]), error => error.code === 'INVALID_DRAWING_SETTING' && error.field === 'anchors' && pattern.test(error.message));
  }
  assert.throws(() => apply(store, [level.id], [{ fieldId: 'anchors', value: [{ offset: 1, price: 50 }] }]), error => /anchor 0 has no offset/.test(error.message));
  assert.throws(() => apply(store, [a.id], [{ fieldId: 'anchors', value: [{ anchorBarId: 'b2', offset: 0, price: -5 }, { anchorBarId: 'b8', offset: 0, price: 5 }] }], { priceScaleMode: () => 'log' }),
    error => error.field === 'anchors' && /anchor 0 price/.test(error.message) && /logarithmic/.test(error.message));
  assert.doesNotThrow(() => apply(store, [a.id], [{ fieldId: 'anchors', value: [{ anchorBarId: 'b2', offset: 0, price: -5 }, { anchorBarId: 'b8', offset: 0, price: 5 }] }], { priceScaleMode: () => 'linear' }));
  assert.notDeepEqual(store.export(), before);
});

test('a drawing removed since the dialog opened is reported and the others stay untouched', () => {
  const store = makeStore();
  const a = add(store, 'segment');
  const b = add(store, 'segment', { anchors: two(3, 9) });
  store.remove(b.id);
  const before = store.export();
  assert.throws(() => apply(store, [a.id, b.id], [{ fieldId: 'style.color', value: '#c0392b' }]), error => error.code === 'unknown-drawing' && error.id === b.id);
  assert.deepEqual(store.export(), before);
  assert.equal(store.list().some(drawing => drawing.id === b.id), false, 'it is not recreated');
});

test('captions and fonts compose into whole objects with the library defaults', () => {
  const store = makeStore();
  const segment = add(store, 'segment');
  apply(store, [segment.id], [{ fieldId: 'props.label.text', value: 'Support' }, { fieldId: 'props.label.size', value: 16 }, { fieldId: 'props.label.bold', value: true }]);
  assert.deepEqual(store.get(segment.id).props.label, { text: 'Support', size: 16, bold: true, italic: false, align: 'center' });
  const note = store.add({ type: 'text', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b5', offset: 0, price: 50 }], props: { text: 'note' } });
  apply(store, [note.id], [{ fieldId: 'props.textStyle.size', value: 20 }, { fieldId: 'props.text', value: 'changed' }]);
  assert.deepEqual(store.get(note.id).props.textStyle, { size: 20, bold: false, italic: false, align: 'start' });
  assert.equal(store.get(note.id).props.text, 'changed');
});

test('Fibonacci levels replace as one list: large lists, defaults and atomic rejection', () => {
  const store = makeStore();
  const fib = add(store, 'fibRetracement');
  const big = Array.from({ length: 25 }, (_, i) => ({ coefficient: i * 0.1 + (i === 24 ? 5000 : 0), visible: i % 2 === 0, opacity: 0.5, color: '#e8a33d' }));
  apply(store, [fib.id], [{ fieldId: 'props.levels', value: big }]);
  assert.equal(store.get(fib.id).props.levels.length, 25);
  assert.equal(store.get(fib.id).props.levels[24].coefficient, 5002.4);
  assert.equal(store.get(fib.id).ownStyle, false);
  apply(store, [fib.id], [{ fieldId: 'props.levels', value: fibDefaultLevels('fibRetracement') }]);
  assert.equal(store.get(fib.id).props.levels.length, 7);
  const before = store.export();
  assert.throws(() => apply(store, [fib.id], [{ fieldId: 'props.levels', value: [{ coefficient: 1 }, { coefficient: 1 }] }]), error => error.field === 'props.levels');
  assert.throws(() => apply(store, [fib.id], [{ fieldId: 'props.levels', value: [] }]), error => error.code === 'INVALID_DRAWING_SETTING');
  assert.deepEqual(store.export(), before);
  apply(store, [fib.id], [{ fieldId: 'props.showPrices', value: true }, { fieldId: 'props.labelPosition', value: 'center' }, { fieldId: 'props.fill', value: true }]);
  assert.deepEqual(['showPrices', 'labelPosition', 'fill'].map(key => store.get(fib.id).props[key]), [true, 'center', true]);
});
