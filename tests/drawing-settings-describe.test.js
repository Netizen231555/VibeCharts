// The description of a selection: applicable fields, values, mixed and disabled states, localization.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeDrawingSettings, DRAWING_SETTINGS_TABS } from '../src/ui/drawing-settings/index.js';
import { createFieldRegistry } from '../src/ui/drawing-settings/registry.js';
import { describeWith } from '../src/ui/drawing-settings/describe.js';
import { DRAWING_TOOLS } from '../src/drawings/tools.js';
import { STYLE_FAMILIES } from '../src/drawings/styles.js';
import { hasMessage } from '../src/ui/messages.js';

import { makeStore } from './settings-fixtures.js';
const two = (a = 2, b = 8) => [{ anchorBarId: `b${a}`, offset: 0, price: 40 }, { anchorBarId: `b${b}`, offset: 0, price: 60 }];
const add = (store, type, extra = {}) => store.add({ type, paneId: 'main', scaleId: 'right', anchors: two(), ...extra });
const fieldIds = description => description.tabs.flatMap(tab => tab.groups.flatMap(group => group.fields.map(field => field.id)));
const find = (description, id) => description.tabs.flatMap(tab => tab.groups.flatMap(group => group.fields)).find(field => field.id === id);

test('a single trend line gets its style, text and coordinates without fill', () => {
  const store = makeStore();
  const segment = add(store, 'segment', { style: { color: '#c0392b', width: 3 } });
  const description = describeDrawingSettings({ drawings: [segment], locale: 'en-US' });
  assert.deepEqual(description.tabs.map(tab => tab.id), ['style', 'text', 'coordinates']);
  assert.deepEqual([description.ids, description.types, description.count, description.locked], [[segment.id], ['segment'], 1, false]);
  const ids = fieldIds(description);
  for (const id of ['style.color', 'style.width', 'style.dash', 'style.opacity', 'anchors', 'props.extend.left', 'props.arrows.end', 'props.stats.percent']) {
    assert.ok(ids.includes(id), id);
  }
  assert.ok(!ids.includes('style.fill') && !ids.includes('style.fillOpacity'));
  assert.equal(find(description, 'style.color').value, '#c0392b');
  assert.equal(find(description, 'style.width').value, 3);
  assert.equal(find(description, 'anchors').value.length, 2);
  assert.deepEqual(find(description, 'anchors').limits, { offset: true, price: true, positivePrice: false });
  assert.equal(description.tabs[0].label, 'Style');
  assert.equal(description.tabs[0].groups[0].label, 'Appearance');
});

test('only tabs with fields appear, in the fixed order', () => {
  const store = makeStore();
  const polyline = store.add({ type: 'polyline', paneId: 'main', scaleId: 'right', anchors: [...two(), { anchorBarId: 'b12', offset: 0, price: 50 }] });
  const description = describeDrawingSettings({ drawings: [polyline], locale: 'en-US' });
  assert.deepEqual(description.tabs.map(tab => tab.id), ['style', 'coordinates']);
  assert.deepEqual(DRAWING_SETTINGS_TABS, ['style', 'text', 'coordinates']);
});

test('a mixed selection keeps the shared fields, drops coordinates and marks differing values', () => {
  const store = makeStore();
  const segment = add(store, 'segment', { style: { color: '#111111' } });
  const rectangle = add(store, 'rectangle', { style: { color: '#222222' } });
  const description = describeDrawingSettings({ drawings: [segment, rectangle], locale: 'en-US' });
  const ids = fieldIds(description);
  assert.ok(ids.includes('style.color') && ids.includes('style.width') && ids.includes('style.dash') && ids.includes('style.opacity'));
  assert.ok(!ids.includes('anchors'), 'single-drawing fields are dropped');
  assert.ok(!ids.includes('style.fill'), 'fill belongs to the filled family only');
  const color = find(description, 'style.color');
  assert.deepEqual([color.mixed, color.value], [true, null]);
  assert.deepEqual([find(description, 'style.width').mixed, find(description, 'style.width').value], [false, 1]);
  assert.deepEqual(description.types.sort(), ['rectangle', 'segment']);
});

test('equal values are not mixed', () => {
  const store = makeStore();
  const drawings = [1, 2, 3].map(i => add(store, 'ray', { anchors: two(i, i + 5), style: { color: '#abcdef' } }));
  const color = find(describeDrawingSettings({ drawings, locale: 'en-US' }), 'style.color');
  assert.deepEqual([color.value, color.mixed], ['#abcdef', false]);
});

test('malformed input throws with the field named', () => {
  for (const drawings of [[], undefined, 'segment', null, {}]) {
    assert.throws(() => describeDrawingSettings({ drawings, locale: 'en-US' }), error => error.code === 'INVALID_DRAWING_SETTINGS_INPUT' && error.field === 'drawings');
  }
});

test('a field that cannot be read is an error naming the field and the drawing', () => {
  const store = makeStore();
  const segment = add(store, 'segment');
  const broken = { ...segment, props: {} };
  assert.throws(() => describeDrawingSettings({ drawings: [broken], locale: 'en-US' }),
    error => error.code === 'DRAWING_SETTING_UNREADABLE' && /^props\./.test(error.field) && error.detail.drawingId === segment.id);
});

test('a locked drawing keeps every field, read-only with one localized reason', () => {
  const store = makeStore();
  const segment = add(store, 'segment', { locked: true });
  const open = add(store, 'segment');
  const description = describeDrawingSettings({ drawings: [segment, open], locale: 'en-US' });
  const fields = description.tabs.flatMap(tab => tab.groups.flatMap(group => group.fields));
  assert.ok(fields.length > 5);
  assert.equal(description.locked, true);
  assert.ok(fields.every(field => field.enabled === false && field.reason === 'The drawing is locked'));
  const group = store.createGroup('g');
  store.addToGroup(group.id, open.id);
  store.setLocked(group.id, true);
  const byGroup = describeDrawingSettings({ drawings: [store.get(open.id)], locale: 'ru-RU', context: { isLocked: drawing => store.layout(drawing.id).locked } });
  assert.equal(byGroup.locked, true);
  assert.equal(find(byGroup, 'style.color').reason, 'Рисунок заблокирован');
});

test('Russian descriptions contain no English labels', () => {
  const store = makeStore();
  const fib = add(store, 'fibRetracement');
  const description = describeDrawingSettings({ drawings: [fib], locale: 'ru-RU' });
  assert.equal(description.tabs[0].label, 'Стиль');
  for (const field of description.tabs.flatMap(tab => tab.groups.flatMap(group => [group, ...group.fields]))) {
    assert.ok(!/^[A-Za-z ]+$/.test(field.label), `${field.id ?? field.label} is Russian`);
    for (const option of field.limits?.options ?? []) assert.ok(!/^[A-Za-z ]+$/.test(option.label), option.label);
  }
  assert.deepEqual(find(description, 'props.labelPosition').limits.options.map(option => option.label), ['Начало', 'Центр', 'Конец']);
});

test('tools only get the plates and options they have', () => {
  const store = makeStore();
  const level = store.add({ type: 'horizontalLevel', paneId: 'main', scaleId: 'right', anchors: [{ price: 50 }] });
  const vertical = store.add({ type: 'verticalLine', paneId: 'main', scaleId: 'right', anchors: [{ anchorBarId: 'b4', offset: 0 }] });
  const forLevel = fieldIds(describeDrawingSettings({ drawings: [level], locale: 'en-US' }));
  assert.ok(forLevel.includes('props.axisLabels.price') && !forLevel.includes('props.axisLabels.time'));
  const forVertical = fieldIds(describeDrawingSettings({ drawings: [vertical], locale: 'en-US' }));
  assert.ok(forVertical.includes('props.axisLabels.time') && !forVertical.includes('props.axisLabels.price'));
  assert.deepEqual(find(describeDrawingSettings({ drawings: [level], locale: 'en-US' }), 'anchors').limits, { offset: false, price: true, positivePrice: false });
  assert.deepEqual(find(describeDrawingSettings({ drawings: [vertical], locale: 'en-US' }), 'anchors').limits, { offset: true, price: false, positivePrice: false });
});

test('Fibonacci levels are a single-drawing field and the scale mode reaches the coordinates', () => {
  const store = makeStore();
  const a = add(store, 'fibRetracement');
  const b = add(store, 'fibRetracement', { anchors: two(3, 9) });
  assert.ok(fieldIds(describeDrawingSettings({ drawings: [a], locale: 'en-US' })).includes('props.levels'));
  assert.ok(!fieldIds(describeDrawingSettings({ drawings: [a, b], locale: 'en-US' })).includes('props.levels'));
  assert.ok(fieldIds(describeDrawingSettings({ drawings: [a, b], locale: 'en-US' })).includes('props.showPrices'));
  const levels = find(describeDrawingSettings({ drawings: [a], locale: 'en-US' }), 'props.levels');
  assert.equal(levels.value.length, 7);
  const log = describeDrawingSettings({ drawings: [a], locale: 'en-US', context: { priceScaleMode: () => 'log' } });
  assert.equal(find(log, 'anchors').limits.positivePrice, true);
});

test('enabledWhen and visibleWhen refusals come from the descriptor with a localized reason', () => {
  const registry = createFieldRegistry({ tools: DRAWING_TOOLS, families: Object.keys(STYLE_FAMILIES), hasMessage });
  const base = { tab: 'style', group: 'appearance', order: 1, type: 'boolean', labelKey: 'drawingSettings.f.fill', appliesTo: { tools: ['segment'] } };
  registry.register({ ...base, id: 'gated', path: ['props', 'midpoint'], enabledWhen: () => ({ reasonKey: 'drawingSettings.reason.mixed' }) }, 't');
  registry.register({ ...base, id: 'hidden', path: ['props', 'midpoint'], visibleWhen: () => false }, 't');
  const store = makeStore();
  const segment = add(store, 'segment');
  const description = describeWith(registry, { drawings: [segment], locale: 'ru-RU' });
  assert.deepEqual(fieldIds(description), ['gated']);
  assert.deepEqual([find(description, 'gated').enabled, find(description, 'gated').reason, find(description, 'gated').value], [false, 'Выбранные рисунки различаются', false]);
});
