// Reach, arrow heads and midpoint (drawing-line-options), axis plates and the statistics badge (axis labels and
// statistics). The tool lists come from the drawing library's own option tables, so a tool added there is covered.
import { LINE_OPTIONS } from '../../../drawings/tools.js';
import { AXIS_LABEL_TOOLS, STATS_TOOLS } from '../../../drawings/axis-stats.js';
import { bool, select, toolsOf } from './helpers.js';

export const owner = 'line-options';

// The fib tools and the regression channel store the same `props.extend` shape as the line family.
const EXTEND_TOOLS = Object.freeze([...new Set([...Object.keys(LINE_OPTIONS), 'fibRetracement', 'fibExtension', 'regressionChannel'])]);
const ARROW_TOOLS = Object.freeze(Object.keys(LINE_OPTIONS).filter((tool) => LINE_OPTIONS[tool].arrows));
const MIDPOINT_TOOLS = Object.freeze(Object.keys(LINE_OPTIONS).filter((tool) => LINE_OPTIONS[tool].midpoint !== undefined));

const axisVisible = (key) => (drawing) => AXIS_LABEL_TOOLS[drawing.type]?.[key] === true;

export const fields = [
  bool('props.extend.left', 'extendLeft', 'extend', 310, ['props', 'extend', 'left'], { tools: EXTEND_TOOLS }),
  bool('props.extend.right', 'extendRight', 'extend', 320, ['props', 'extend', 'right'], { tools: EXTEND_TOOLS }),
  bool('props.arrows.start', 'arrowStart', 'arrows', 410, ['props', 'arrows', 'start'], { tools: ARROW_TOOLS }),
  bool('props.arrows.end', 'arrowEnd', 'arrows', 420, ['props', 'arrows', 'end'], { tools: ARROW_TOOLS }),
  bool('props.midpoint', 'midpoint', 'arrows', 430, ['props', 'midpoint'], { tools: MIDPOINT_TOOLS }),
  // A tool only offers the plate it has a coordinate for (a vertical line has no price plate).
  bool('props.axisLabels.price', 'axisPrice', 'axisLabels', 510, ['props', 'axisLabels', 'price'], { tools: toolsOf(AXIS_LABEL_TOOLS) },
    { visibleWhen: axisVisible('price') }),
  bool('props.axisLabels.time', 'axisTime', 'axisLabels', 520, ['props', 'axisLabels', 'time'], { tools: toolsOf(AXIS_LABEL_TOOLS) },
    { visibleWhen: axisVisible('time') }),
  bool('props.stats.priceRange', 'statPriceRange', 'stats', 610, ['props', 'stats', 'priceRange'], { tools: toolsOf(STATS_TOOLS) }),
  bool('props.stats.percent', 'statPercent', 'stats', 620, ['props', 'stats', 'percent'], { tools: toolsOf(STATS_TOOLS) }),
  bool('props.stats.bars', 'statBars', 'stats', 630, ['props', 'stats', 'bars'], { tools: toolsOf(STATS_TOOLS) }),
  bool('props.stats.time', 'statTime', 'stats', 640, ['props', 'stats', 'time'], { tools: toolsOf(STATS_TOOLS) }),
  bool('props.stats.always', 'statAlways', 'stats', 650, ['props', 'stats', 'always'], { tools: toolsOf(STATS_TOOLS) }),
  select('props.stats.position', 'statPosition', 'stats', 660, ['props', 'stats', 'position'], { tools: toolsOf(STATS_TOOLS) }, ['start', 'center', 'end']),
];
