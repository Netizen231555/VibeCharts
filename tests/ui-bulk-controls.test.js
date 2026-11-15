// The hide and lock controls of the chart UI model, their keyboard equivalents and layout validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToolbarModel, findControl, activateControl } from '../src/ui/controls.js';
import { describeActionAccess } from '../src/ui/access.js';
import { validateLayout, PRESETS } from '../src/ui/layout-config.js';
import { createKeyboard } from '../src/interaction/keyboard.js';

const control = (model, id) => findControl(model, id).control;
const build = (drawingState, capabilities = {}, locale = 'en-US') => createToolbarModel({ current: { drawingState }, capabilities, locale });

test('pressed state follows the explicit flags and mixed state reads as not pressed', () => {
  const all = build({ drawings: 2, groups: 1, visible: 'none', locked: 'all' });
  assert.equal(control(all, 'hideDrawings').pressed, true);
  assert.equal(control(all, 'lockDrawings').pressed, true);
  const mixed = build({ drawings: 2, groups: 1, visible: 'mixed', locked: 'mixed' });
  assert.equal(control(mixed, 'hideDrawings').pressed, false);
  assert.equal(control(mixed, 'lockDrawings').pressed, false);
  const shown = build({ drawings: 2, groups: 0, visible: 'all', locked: 'none' });
  assert.equal(control(shown, 'hideDrawings').pressed, false);
  assert.equal(control(shown, 'lockDrawings').pressed, false);
  assert.equal(control(shown, 'hideDrawings').kind, 'toggle');
  assert.equal(control(shown, 'hideDrawings').enabled, true);
});

test('an empty or unavailable store disables the controls with an explicit localized reason', () => {
  const empty = build({ drawings: 0, groups: 0, visible: null, locked: null });
  for (const id of ['hideDrawings', 'lockDrawings']) {
    assert.equal(control(empty, id).enabled, false);
    assert.match(control(empty, id).reason, /no drawings/i);
    const refused = activateControl(empty, id);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'CONTROL_DISABLED');
  }
  const unavailable = build(null, { canBulkDrawings: false });
  assert.equal(control(unavailable, 'hideDrawings').enabled, false);
  assert.match(control(unavailable, 'lockDrawings').reason, /unavailable/i);
  const ru = build({ drawings: 0, groups: 0, visible: null, locked: null }, {}, 'ru-RU');
  assert.match(control(ru, 'hideDrawings').label, /Скрыть/);
  assert.match(control(ru, 'lockDrawings').label, /Заблокировать/);
  assert.match(control(ru, 'hideDrawings').reason, /Нет рисунков/);
});

test('a layout without the rail keeps a keyboard way to hide and lock, or must remove the controls on purpose', () => {
  const model = build({ drawings: 1, groups: 0, visible: 'all', locked: 'none' });
  const controls = model.groups.flatMap(group => group.controls);
  const bound = describeActionAccess(controls, { keyboard: createKeyboard() });
  assert.deepEqual(bound.find(item => item.id === 'hideDrawings').keyboard, ['shift+h']);
  assert.deepEqual(bound.find(item => item.id === 'lockDrawings').keyboard, ['shift+l']);
  const layout = { top: ['topBar'], overlay: ['navCluster'], menu: ['settingsMenu'], bottom: ['statusLine'], without: ['tool:', 'clearDrawings'] };
  assert.doesNotThrow(() => validateLayout(layout, { access: bound }));
  const disabled = describeActionAccess(controls, { keyboard: createKeyboard({ bindings: { toggleDrawingsVisible: null } }) });
  assert.throws(() => validateLayout(layout, { access: disabled }), error => error.detail.actions.includes('hideDrawings'));
  assert.doesNotThrow(() => validateLayout({ ...layout, without: [...layout.without, 'hideDrawings'] }, { access: disabled }));
  assert.ok(PRESETS.compact.without.includes('hideDrawings') && PRESETS.compact.without.includes('lockDrawings'));
});
