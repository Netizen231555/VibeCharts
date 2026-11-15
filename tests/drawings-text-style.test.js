import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { normalizeProps } from '../src/drawings/tools.js';
import { isPlainColor } from '../src/drawings/color.js';
import { validateStyle } from '../src/drawings/styles.js';

const geometry = {
  hasBinding: () => true, getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  resolveX: a => Number(a.anchorBarId.slice(1)) + a.offset, logicalToX: x => x * 10,
  priceToY: p => 200 - p, yToPrice: y => 200 - y, indexOf: id => Number(id.slice(1)),
  getIndexCount: () => 20, getSlot: i => ({ time: i * 3600000 }), getSeriesValues: () => null,
};
const store = () => createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'S' }, geometry, historyLimit: 10 });
const drawing = { type: 'segment', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b1', offset: 0, price: 10 }, { anchorBarId: 'b2', offset: 0, price: 20 }], props: { label: { text: 'Support' } } };

test('caption and text style support, defaults and field errors', () => {
  for (const type of ['segment', 'ray', 'line', 'horizontalLevel', 'horizontalRay', 'verticalLine', 'arrow', 'parallelChannel', 'regressionChannel', 'rectangle', 'ellipse', 'triangle']) {
    const props = { label: { text: 'Support' }, ...(type === 'regressionChannel' ? { seriesId: 's', k: 1 } : {}) };
    assert.deepEqual(normalizeProps(type, props).label, { text: 'Support', size: 12, bold: false, italic: false, align: 'center' });
  }
  for (const type of ['text', 'callout', 'flag', 'priceLabel']) {
    const props = { textStyle: { bold: true }, ...(type === 'priceLabel' ? {} : { text: 'Note' }) };
    assert.deepEqual(normalizeProps(type, props).textStyle, { size: 12, bold: true, italic: false, align: 'start' });
  }
  for (const [type, props, field] of [
    ['segment', { label: { text: 'x', size: 4 } }, 'props.label.size'],
    ['segment', { label: { text: 'x', align: 'left' } }, 'props.label.align'],
    ['segment', { label: { text: 'x', shadow: true } }, 'props.label.shadow'],
    ['segment', { label: {} }, 'props.label.text'],
    ['segment', { label: { text: 'a\nb\nc\nd' } }, 'props.label.text'],
    ['segment', { label: { text: 'x'.repeat(201) } }, 'props.label.text'],
    ['polyline', { label: { text: 'x' } }, 'props.label'],
    ['text', { text: 'x', textStyle: { align: 'left' } }, 'props.textStyle.align'],
  ]) assert.throws(() => normalizeProps(type, props), error => error.field === field);
});

test('plain colors are validated consistently without a browser', () => {
  for (const color of ['#123', '#1234', '#123456', '#12345678', 'red', 'RebeccaPurple', 'transparent', 'rgb(1, 2, 3)', 'rgba(20%, 30%, 40%, .5)', 'hsl(120, 50%, 25%)', 'hsla(120, 50%, 25%, 50%)']) {
    assert.equal(isPlainColor(color), true, color);
    assert.equal(normalizeProps('segment', { label: { text: 'x', color } }).label.color, color);
    assert.equal(validateStyle('line', { color }).color, color);
  }
  for (const color of ['#12345', '#1234567', 'notacolor', 'rgb(1,2)', 'rgb(1,2,3,4)', 'rgba(1,2,3,)', 'rgb(1%,2,3)', 'hsl(2,3,4)', 'rgba(1,2,3,1.2.3)', 'rgb(1.,2,3)']) {
    assert.equal(isPlainColor(color), false, color);
    const s = store();
    assert.throws(() => s.add({ ...drawing, props: { label: { text: 'x', color } } }), error => error.field === 'props.label.color');
    const id = s.add(drawing).id, before = s.export();
    assert.throws(() => s.update(id, { props: { label: { text: 'x', color } } }), error => error.field === 'props.label.color');
    const invalid = structuredClone(before); invalid.drawings[0].props.label.color = color;
    assert.throws(() => s.import(invalid), error => error.field === 'props.label.color');
    assert.deepEqual(s.export(), before);
    assert.throws(() => validateStyle('line', { color }), /color/);
  }
});

test('caption updates and document imports are atomic and undoable', () => {
  const s = store(), id = s.add(drawing).id, initial = s.export();
  assert.throws(() => s.update(id, { props: { label: { text: 'x', size: 2 } } }), error => error.field === 'props.label.size');
  assert.deepEqual(s.export(), initial);
  const invalid = structuredClone(initial); invalid.drawings[0].props.label.size = 2;
  assert.throws(() => s.import(invalid), error => error.field === 'props.label.size');
  assert.deepEqual(s.export(), initial);
  s.update(id, { props: { label: null } }); assert.equal(s.get(id).props.label, undefined);
  s.undo(); assert.equal(s.get(id).props.label.text, 'Support');
  s.redo(); assert.equal(s.get(id).props.label, undefined);
  s.import(initial); assert.equal(s.get(id).props.label.text, 'Support');
  const old = structuredClone(initial); old.schemaVersion--;
  assert.throws(() => s.import(old));
});

test('annotation typography persists and undo restores its previous value', () => {
  const s = store();
  const id = s.add({ type: 'text', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b3', offset: 0, price: 15 }], props: { text: 'line one\nline two', textStyle: { size: 18, bold: true } } }).id;
  const document = s.export();
  s.update(id, { props: { textStyle: { size: 24, italic: true } } });
  s.undo(); assert.equal(s.get(id).props.textStyle.size, 18);
  s.redo(); assert.equal(s.get(id).props.textStyle.size, 24);
  s.import(document); assert.deepEqual(s.get(id).props.textStyle, { size: 18, bold: true, italic: false, align: 'start' });
});

test('supported geometry families expose captions in their layouts', () => {
  const g = { ...geometry, getSeriesValues: () => Array.from({ length: 20 }, (_, index) => ({ index, value: 10 + index })) };
  const s = createDrawingStore({ context: { instrumentId: 'T', interval: 'D', sourceId: 'S' }, geometry: g, historyLimit: 10 });
  const a = { anchorBarId: 'b1', offset: 0, price: 30 };
  const b = { anchorBarId: 'b8', offset: 0, price: 70 };
  const c = { anchorBarId: 'b5', offset: 0, price: 20 };
  for (const type of ['segment', 'ray', 'line', 'horizontalLevel', 'horizontalRay', 'verticalLine', 'arrow', 'parallelChannel', 'regressionChannel', 'rectangle', 'ellipse', 'triangle']) {
    const anchors = type === 'horizontalLevel' ? [{ price: 30 }]
      : type === 'verticalLine' ? [{ anchorBarId: 'b1', offset: 0 }]
        : type === 'horizontalRay' ? [a]
          : ['triangle', 'parallelChannel'].includes(type) ? [a, b, c] : [a, b];
    const props = { label: { text: 'first\nsecond' }, ...(type === 'regressionChannel' ? { seriesId: 's', k: 1 } : {}) };
    const d = s.add({ type, paneId: 'main', scaleId: 'right', anchors, props });
    const layout = s.layout(d.id);
    assert.ok(layout.labels.some(label => label.text === 'first\nsecond'), type);
  }
});

test('multiline annotation uses its measured text bounds for hit testing', () => {
  const s = store();
  const d = s.add({ type: 'text', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b3', offset: 0, price: 80 }], props: { text: 'first\nsecond', textStyle: { size: 18, bold: true } } });
  const primitive = s.layout(d.id).primitives.find(p => p.kind === 'text');
  const bounds = primitive.textLayout.bounds;
  assert.deepEqual(primitive.textLayout.lines, ['first', 'second']);
  assert.ok(bounds.height > 18);
  assert.equal(s.hitTest({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 1 }, { radius: 0 })?.id, d.id);
});

test('caption follows updates and is omitted when the segment is offscreen', () => {
  const s = store(), id = s.add(drawing).id;
  const first = s.layout(id).labels.find(label => label.text === 'Support');
  s.update(id, { anchors: [{ anchorBarId: 'b2', offset: 0, price: 30 }, { anchorBarId: 'b4', offset: 0, price: 40 }] });
  const moved = s.layout(id).labels.find(label => label.text === 'Support');
  assert.notEqual(first.x, moved.x);
  s.update(id, { anchors: [{ anchorBarId: 'b21', offset: 0, price: 30 }, { anchorBarId: 'b22', offset: 0, price: 40 }] });
  assert.equal(s.layout(id).labels.some(label => label.text === 'Support'), false);
});
