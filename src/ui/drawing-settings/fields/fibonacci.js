// The Fibonacci tools: the level list (colour, opacity, label, visibility, coefficient per level) and the options each
// tool supports. Which tool takes which option comes from `FIB_TOOL_OPTIONS`, so the dialog offers exactly what the
// store accepts. `extend` is the shared `props.extend` field of the line options.
import { FIB_TOOL_OPTIONS } from '../../../drawings/tools.js';
import { bool, number, select } from './helpers.js';

export const owner = 'fibonacci';

const FIB_TOOLS = Object.freeze(Object.keys(FIB_TOOL_OPTIONS));
const supporting = (option) => Object.freeze(FIB_TOOLS.filter((tool) => FIB_TOOL_OPTIONS[tool].includes(option)));

function validateLevels(value) {
  if (!Array.isArray(value) || value.length === 0) throw new Error('must be a non-empty list of levels');
  value.forEach((level, index) => {
    if (level === null || typeof level !== 'object' || !Number.isFinite(level.coefficient)) {
      throw new Error(`level ${index} needs a finite coefficient`);
    }
  });
  return value;
}

const fibBool = (option, label, order) => bool(`props.${option}`, label, 'fibOptions', order, ['props', option], { tools: supporting(option) });

export const fields = [
  {
    id: 'props.levels', tab: 'style', group: 'fibLevels', order: 10, type: 'levels', labelKey: 'drawingSettings.f.levels',
    appliesTo: { tools: FIB_TOOLS }, path: ['props', 'levels'], validate: validateLevels, multi: false,
  },
  fibBool('showPrices', 'showPrices', 10),
  fibBool('showPercent', 'showPercent', 20),
  fibBool('reverse', 'reverse', 30),
  fibBool('fill', 'fibFill', 40),
  number('props.fillOpacity', 'fibFillOpacity', 'fibOptions', 50, ['props', 'fillOpacity'], { tools: supporting('fillOpacity') }, { min: 0, max: 1, step: 0.02 }),
  select('props.labelPosition', 'labelPosition', 'fibOptions', 60, ['props', 'labelPosition'], { tools: supporting('labelPosition') }, ['start', 'center', 'end']),
  fibBool('grid', 'grid', 70),
  fibBool('fullCircles', 'fullCircles', 80),
];
