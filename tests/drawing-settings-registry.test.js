// The drawing settings field registry: descriptor validation, ordering, extension and the coverage check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DRAWING_TOOLS, FIB_TOOL_OPTIONS } from '../src/drawings/tools.js';
import { STYLE_FAMILIES } from '../src/drawings/styles.js';
import { hasMessage, t } from '../src/ui/messages.js';
import { createFieldRegistry, DRAWING_SETTINGS_TABS } from '../src/ui/drawing-settings/registry.js';
import * as style from '../src/ui/drawing-settings/fields/style.js';
import * as lineOptions from '../src/ui/drawing-settings/fields/line-options.js';
import * as regression from '../src/ui/drawing-settings/fields/regression.js';
import * as fibonacci from '../src/ui/drawing-settings/fields/fibonacci.js';
import * as text from '../src/ui/drawing-settings/fields/text.js';
import * as coordinates from '../src/ui/drawing-settings/fields/coordinates.js';

const fresh = (tools = DRAWING_TOOLS) => createFieldRegistry({ tools, families: Object.keys(STYLE_FAMILIES), hasMessage });
const valid = (extra = {}) => ({
  id: 'test.field', tab: 'style', group: 'appearance', order: 1, type: 'boolean', labelKey: 'drawingSettings.f.fill',
  appliesTo: { tools: ['segment'] }, path: ['props', 'midpoint'], ...extra,
});
const ALL = [style, lineOptions, regression, fibonacci, text, coordinates];
const listDrawingSettingsFields = () => {
  const registry = fresh();
  for (const module of ALL) for (const descriptor of module.fields) registry.register(descriptor, module.owner);
  return registry.list();
};

test('a malformed descriptor names the field id and the member', () => {
  const registry = fresh();
  const cases = [
    [{ labelKey: 'drawingSettings.f.nothing' }, 'labelKey'],
    [{ id: '1bad' }, 'id'],
    [{ tab: 'layout' }, 'tab'],
    [{ group: 'nonexistent' }, 'group'],
    [{ order: 1.5 }, 'order'],
    [{ type: 'slider' }, 'type'],
    [{ appliesTo: {} }, 'appliesTo'],
    [{ appliesTo: { tools: ['trendline'] } }, 'trendline'],
    [{ appliesTo: { families: ['curve'] } }, 'curve'],
    [{ path: undefined }, 'path'],
    [{ path: ['anchors', 'x'] }, 'path'],
    [{ read: () => 1, patch: () => ({}) }, 'path'],
    [{ type: 'number' }, 'limits'],
    [{ type: 'number', limits: { min: 5, max: 1, step: 1 } }, 'limits'],
    [{ type: 'select', limits: { options: [] } }, 'limits.options'],
    [{ type: 'select', limits: { options: [{ value: 'a', labelKey: 'drawingSettings.opt.solid' }, { value: 'a', labelKey: 'drawingSettings.opt.solid' }] } }, 'limits.options'],
    [{ type: 'select', limits: { options: [{ value: 'a', labelKey: 'drawingSettings.opt.missing' }] } }, 'limits.options'],
    [{ limits: { min: 0 } }, 'limits'],
    [{ validate: 'nope' }, 'validate'],
    [{ multi: 'yes' }, 'multi'],
  ];
  for (const [patch, member] of cases) {
    assert.throws(() => registry.register(valid(patch), 'test'),
      error => error.code === 'INVALID_DRAWING_SETTING_FIELD' && error.message.includes(patch.id ?? 'test.field') && error.message.includes(member),
      JSON.stringify(patch));
  }
  assert.equal(registry.list().length, 0, 'nothing malformed was registered');
});

test('a Russian text is required for every label', () => {
  assert.equal(hasMessage('drawingSettings.f.color'), true);
  assert.equal(hasMessage('drawingSettings.f.unknown'), false);
  for (const field of listDrawingSettingsFields()) {
    for (const locale of ['en-US', 'ru-RU']) {
      assert.ok(t(locale, field.labelKey).length > 0, `${field.id} ${locale}`);
      assert.ok(t(locale, `drawingSettings.group.${field.group}`).length > 0, `${field.id} group ${locale}`);
      for (const option of field.limits?.options ?? []) assert.ok(t(locale, option.labelKey).length > 0, `${field.id}:${option.value}`);
    }
  }
});

test('a duplicate id is rejected naming both owners and the first registration stays', () => {
  const registry = fresh();
  registry.register(valid(), 'first');
  assert.throws(() => registry.register(valid({ order: 9 }), 'second'),
    error => error.code === 'DUPLICATE_DRAWING_SETTING_FIELD' && error.message.includes('first') && error.message.includes('second') && error.field === 'test.field');
  assert.equal(registry.get('test.field').order, 1);
  assert.equal(registry.owner('test.field'), 'first');
});

test('descriptors are frozen and the list is sorted by tab, group and order, ties by registration', () => {
  const registry = fresh();
  registry.register(valid({ id: 'c', tab: 'coordinates', group: 'anchors', order: 1 }), 'm');
  registry.register(valid({ id: 'b2', group: 'fill', order: 5 }), 'm');
  registry.register(valid({ id: 'a', group: 'appearance', order: 20 }), 'm');
  registry.register(valid({ id: 'b1', group: 'fill', order: 1 }), 'm');
  registry.register(valid({ id: 'tie1', group: 'appearance', order: 20 }), 'm');
  registry.register(valid({ id: 't', tab: 'text', group: 'text', order: 1 }), 'm');
  // Groups follow the lowest order of their fields: `fill` (1) comes before `appearance` (20).
  assert.deepEqual(registry.list().map(field => field.id), ['b1', 'b2', 'a', 'tie1', 't', 'c']);
  assert.ok(Object.isFrozen(registry.list()));
  assert.ok(Object.isFrozen(registry.get('a')));
  assert.ok(Object.isFrozen(registry.get('a').appliesTo.tools));
  assert.deepEqual(DRAWING_SETTINGS_TABS, ['style', 'text', 'coordinates']);
});

test('registration ends at seal: the registry is read-only afterwards', () => {
  const registry = fresh();
  for (const module of ALL) for (const descriptor of module.fields) registry.register(descriptor, module.owner);
  registry.seal();
  assert.throws(() => registry.register(valid({ id: 'late' }), 'late'), error => error.code === 'DRAWING_SETTINGS_SEALED');
});

test('the coverage check names every uncovered tool and is satisfied by a family field', () => {
  const tools = { ...DRAWING_TOOLS, wave: { anchors: { count: 2, x: true, price: true }, family: 'wave' }, spiral: { anchors: { count: 1, x: true, price: true }, family: 'wave' } };
  const registry = createFieldRegistry({ tools, families: [...Object.keys(STYLE_FAMILIES), 'wave'], hasMessage });
  for (const module of ALL) for (const descriptor of module.fields) registry.register(descriptor, module.owner);
  assert.throws(() => registry.seal(), error => error.code === 'DRAWING_SETTINGS_COVERAGE' && error.detail.tools.join() === 'wave,spiral'
    && error.message.includes('wave') && error.message.includes('spiral'));
  registry.register(valid({ id: 'wave.color', appliesTo: { families: ['wave'] }, path: ['style', 'color'] }), 'wave');
  registry.seal();
  assert.ok(registry.list().some(field => field.id === 'wave.color'));
});

test('every library tool is covered by the built-in modules', () => {
  const registry = fresh();
  for (const module of ALL) for (const descriptor of module.fields) registry.register(descriptor, module.owner);
  assert.doesNotThrow(() => registry.seal());
  const fields = registry.list();
  for (const tool of Object.keys(DRAWING_TOOLS)) {
    assert.ok(fields.some(field => field.appliesTo.tools.includes(tool) || field.appliesTo.families.includes(DRAWING_TOOLS[tool].family)), tool);
  }
});

test('Fibonacci options are offered exactly where the store accepts them', () => {
  const byId = new Map(listDrawingSettingsFields().map(field => [field.id, field]));
  for (const option of ['showPrices', 'showPercent', 'reverse', 'fill', 'fillOpacity', 'labelPosition', 'grid', 'fullCircles']) {
    const expected = Object.keys(FIB_TOOL_OPTIONS).filter(tool => FIB_TOOL_OPTIONS[tool].includes(option)).sort();
    assert.deepEqual([...byId.get(`props.${option}`).appliesTo.tools].sort(), expected, option);
  }
  const levels = byId.get('props.levels');
  assert.equal(levels.type, 'levels');
  assert.deepEqual([...levels.appliesTo.tools].sort(), Object.keys(FIB_TOOL_OPTIONS).sort());
  assert.equal(levels.multi, false);
  for (const tool of Object.keys(FIB_TOOL_OPTIONS)) {
    const reachesExtend = byId.get('props.extend.left').appliesTo.tools.includes(tool);
    assert.equal(reachesExtend, FIB_TOOL_OPTIONS[tool].includes('extend'), `extend for ${tool}`);
  }
});

test('a contributed module adds fields without touching the model', () => {
  const registry = fresh();
  for (const module of ALL) for (const descriptor of module.fields) registry.register(descriptor, module.owner);
  const before = registry.list().length;
  registry.register(valid({ id: 'contrib.dashOffset', type: 'number', limits: { min: 0, max: 10, step: 1 }, path: ['props', 'midpoint'] }), 'contrib');
  assert.equal(registry.list().length, before + 1);
  registry.seal();
});
