// Regression channel deviations and the correlation label (regression-deviations), and the pitchfork variant.
import { PITCHFORK_VARIANTS } from '../../../drawings/tools.js';
import { bool, number, select } from './helpers.js';

export const owner = 'regression';

export const fields = [
  number('props.upperK', 'upperK', 'regression', 10, ['props', 'upperK'], { tools: ['regressionChannel'] }, { min: 0, max: 20, step: 0.1 }),
  number('props.lowerK', 'lowerK', 'regression', 20, ['props', 'lowerK'], { tools: ['regressionChannel'] }, { min: 0, max: 20, step: 0.1 }),
  bool('props.showR', 'showR', 'regression', 30, ['props', 'showR'], { tools: ['regressionChannel'] }),
  select('props.variant', 'variant', 'pitchfork', 10, ['props', 'variant'], { tools: ['pitchfork'] }, PITCHFORK_VARIANTS),
];
