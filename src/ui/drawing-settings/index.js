/**
 * The drawing settings model: the field registry with every contributed descriptor module, the description of a
 * selection, atomic application, saved styles and shared-style planning.
 *
 * A drawing change adds its fields by adding one module to `MODULES` below (and its texts to `messages.js`); the
 * model and the dialog stay as they are.
 */
import { DRAWING_TOOLS } from '../../drawings/tools.js';
import { STYLE_FAMILIES } from '../../drawings/styles.js';
import { hasMessage } from '../messages.js';
import { createFieldRegistry, DRAWING_SETTINGS_TABS } from './registry.js';
import { describeWith } from './describe.js';
import { applyWith } from './apply.js';
import * as style from './fields/style.js';
import * as lineOptions from './fields/line-options.js';
import * as regression from './fields/regression.js';
import * as fibonacci from './fields/fibonacci.js';
import * as text from './fields/text.js';
import * as coordinates from './fields/coordinates.js';

const MODULES = [style, lineOptions, regression, fibonacci, text, coordinates];

const registry = createFieldRegistry({ tools: DRAWING_TOOLS, families: Object.keys(STYLE_FAMILIES), hasMessage });
for (const module of MODULES) {
  for (const descriptor of module.fields) registry.register(descriptor, module.owner);
}
// Runs once, at module load: a tool nobody describes fails here and not when a user opens a dialog.
registry.seal();

export { DRAWING_SETTINGS_TABS };
export const listDrawingSettingsFields = () => registry.list();
export const describeDrawingSettings = (input) => describeWith(registry, input);
export const applyDrawingSettings = (store, input) => applyWith(registry, store, input);
export { applySavedDrawingStyle, saveDrawingStyle, planDrawingStyle } from './styles.js';
export { createFieldRegistry } from './registry.js';
