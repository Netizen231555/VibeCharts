import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawingStore } from '../src/drawings/store.js';
import { normalizeProps } from '../src/drawings/tools.js';
import { drawAxisLabels } from '../src/integration/axis-labels.js';
import { computeLayout } from '../src/render/layout.js';

const geometry = {
  hasBinding: () => true, getVisibleRect: () => ({ x: 0, y: 0, width: 200, height: 200 }),
  resolveX: a => Number(a.anchorBarId.slice(1)) + a.offset, logicalToX: x => x * 10,
  priceToY: p => 200 - p * 2, yToPrice: y => (200 - y) / 2,
  getIndexCount: () => 20, getSlot: i => ({ time: i * 3600000 }), indexOf: id => Number(id.slice(1)),
  getSeriesValues: () => null,
};
const makeStore = () => createDrawingStore({ context: { instrumentId: 'T', interval: '1D', sourceId: 'src', view: 'main' }, geometry, historyLimit: 20 });
const anchor = (i, price, offset = 0) => ({ anchorBarId: `b${i}`, offset, price });

test('axis and stats props validate and preserve current-version documents', () => {
  assert.deepEqual(normalizeProps('line', {}).axisLabels, { price: false, time: false });
  assert.equal(normalizeProps('measure', {}).stats.always, true);
  for (const [type, props, field] of [
    ['horizontalLevel', { axisLabels: { time: true } }, 'props.axisLabels.time'],
    ['verticalLine', { axisLabels: { price: true } }, 'props.axisLabels.price'],
    ['line', { stats: { position: 'side' } }, 'props.stats.position'],
    ['line', { stats: { bars: 1 } }, 'props.stats.bars'],
  ]) assert.throws(() => normalizeProps(type, props), error => error.field === field);
  assert.throws(() => normalizeProps('rectangle', { axisLabels: {} }), /axisLabels/);
  const s = makeStore();
  const id = s.add({ type: 'line', paneId: 'main', scaleId: 'right', anchors: [anchor(2, 50), anchor(8, 60)], props: { axisLabels: { price: true } } }).id;
  const doc = s.export();
  s.update(id, { props: { axisLabels: { time: true } } });
  s.undo(); assert.equal(s.get(id).props.axisLabels.time, false);
  s.redo(); assert.equal(s.get(id).props.axisLabels.time, true);
  s.import(doc); assert.equal(s.get(id).props.axisLabels.price, true);
  delete doc.drawings[0].props.axisLabels; delete doc.drawings[0].props.stats;
  s.import(doc); assert.equal(s.get(id).props.axisLabels.price, false);
  doc.schemaVersion--; assert.throws(() => s.import(doc));
});

test('statistics and unavailable time values remain inspectable', () => {
  const s = makeStore();
  const id = s.add({ type: 'segment', paneId: 'main', scaleId: 'right', anchors: [anchor(2, 50), anchor(8, 60, 0.5)], props: { axisLabels: { price: true, time: true }, stats: { priceRange: true, percent: true, bars: true, time: true } } }).id;
  const layout = s.layout(id);
  assert.equal(layout.axisLabels.length, 4);
  assert.equal(layout.axisLabels[3].unavailable, 'no-time');
  assert.equal(layout.labels[0].selectedOnly, true);
  assert.match(layout.labels[0].lines[0], /\+10.*20\.00%/);
  assert.match(layout.labels[0].lines[1], /6\.5 bars/);
  assert.doesNotMatch(layout.labels[0].lines[1], /h/);
  const measure = s.add({ type: 'measure', paneId: 'main', scaleId: 'right', anchors: [anchor(2, 50), anchor(8, 60)] }).id;
  assert.equal(s.layout(measure).labels[0].lines.length, 2);
  s.update(measure, { props: { stats: { priceRange: false, percent: false, bars: false, time: false } } });
  assert.equal(s.layout(measure).labels.length, 0);
  assert.ok(s.layout(measure).primitives.length);
});

function axisFixture() {
  const scale = { id: 'right', side: 'right', visible: true, overlay: false };
  const pane = { id: 'main', visible: true, priceScales: new Map([['right', scale]]) };
  const frameLayout = computeLayout({ width: 300, height: 200, panes: [pane] });
  const painted = [];
  const ctx = { save() {}, restore() {}, fillRect() {}, strokeRect() {}, fillText(text, x, y) { painted.push({ text, x, y }); }, measureText(text) { return { width: text.length * 5 }; } };
  let formats = 0;
  const adapter = { priceToY: p => p, logicalToX: x => x, getSlot: () => ({ time: 3600000 }), formatPrice: p => { formats++; return p.toFixed(2); } };
  const layout = { paneId: 'main', scaleId: 'right', style: { color: '#123' }, axisLabels: [{ axis: 'price', price: 50 }, { axis: 'time', logical: 80 }] };
  const options = { entries: [{ layout, selected: false }], frameLayout, width: 300, theme: { lastValueBackground: '#000', lastValueText: '#fff' }, options: {}, adapter };
  return { ctx, options, painted, formats: () => formats };
}

test('axis plates cull, yield to last price, deduplicate and cache per frame', () => {
  const f = axisFixture();
  f.options.entries.push(f.options.entries[0]);
  drawAxisLabels(f.ctx, f.options);
  assert.equal(f.painted.length, 2);
  assert.equal(f.formats(), 1);
  f.painted.length = 0;
  f.options.axisPlates = [{ paneId: 'main', side: 'right', left: 236, top: 41, width: 64, height: 18 }];
  drawAxisLabels(f.ctx, f.options);
  assert.equal(f.painted.length, 1);
  f.painted.length = 0; f.options.entries = [{ ...f.options.entries[0], selected: true }];
  drawAxisLabels(f.ctx, f.options); assert.equal(f.painted.length, 2);
  f.painted.length = 0; f.options.entries[0].layout.axisLabels[1].unavailable = 'no-time';
  drawAxisLabels(f.ctx, f.options); assert.equal(f.painted.length, 1);
});

test('host time formatter is called for each anchor and failures do not suppress price plates', () => {
  const f = axisFixture(); let calls = 0, errors = 0;
  f.options.entries.push(f.options.entries[0]);
  f.options.timeFormatter = () => { calls++; throw new Error('bad time'); };
  f.options.reportError = () => { errors++; };
  drawAxisLabels(f.ctx, f.options);
  assert.equal(calls, 2); assert.equal(errors, 1);
  assert.equal(f.painted.length, 1); assert.equal(f.painted[0].text, '50.00');
});
