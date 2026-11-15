// Text notes, caption and font fields (drawing-text-labels, drawing-text-style). The stored objects are optional on
// most tools, so these fields read and patch through functions that supply the library's defaults and always write
// the whole parent object back (an update replaces the keys of `props` it is given).
import { LABEL_TOOLS, TEXT_STYLE_TOOLS } from '../../../drawings/tools.js';

export const owner = 'text';

const TEXT_TOOLS = ['text', 'callout', 'flag'];
const FONT_DEFAULTS = Object.freeze({ size: 12, bold: false, italic: false, align: 'start' });
const LABEL_DEFAULTS = Object.freeze({ text: '', size: 12, bold: false, italic: false, align: 'center' });
const ALIGN = ['start', 'center', 'end'].map((value) => ({ value, labelKey: `drawingSettings.opt.${value}` }));
const msg = (name) => `drawingSettings.f.${name}`;

function nested(key, defaults, member, fallback = () => undefined) {
  return {
    read: (drawing) => drawing.props[key]?.[member] ?? fallback(drawing) ?? defaults[member],
    patch: (value, drawing) => ({ props: { [key]: { ...defaults, ...drawing.props[key], [member]: value } } }),
  };
}

const fontField = (id, label, order, member, type, limits) => ({
  id, tab: 'text', group: 'textStyle', order, type, labelKey: msg(label), appliesTo: { tools: TEXT_STYLE_TOOLS }, limits,
  ...nested('textStyle', FONT_DEFAULTS, member),
});

const labelField = (id, label, order, member, type, limits, fallback) => ({
  id, tab: 'text', group: 'label', order, type, labelKey: msg(label), appliesTo: { tools: LABEL_TOOLS }, limits,
  ...nested('label', LABEL_DEFAULTS, member, fallback),
});

function validateLabelText(value) {
  if (typeof value !== 'string') throw new Error('must be a string');
  if (value.split('\n').length > 3) throw new Error('must have at most 3 lines');
  return value;
}

export const fields = [
  {
    id: 'props.text', tab: 'text', group: 'text', order: 10, type: 'text', labelKey: msg('text'),
    appliesTo: { tools: TEXT_TOOLS }, path: ['props', 'text'], limits: { maxLength: 20000, multiline: true }, multi: false,
  },
  fontField('props.textStyle.size', 'fontSize', 10, 'size', 'number', { min: 8, max: 72, step: 1, integer: true }),
  fontField('props.textStyle.bold', 'bold', 20, 'bold', 'boolean'),
  fontField('props.textStyle.italic', 'italic', 30, 'italic', 'boolean'),
  fontField('props.textStyle.align', 'align', 40, 'align', 'select', { options: ALIGN }),
  { ...labelField('props.label.text', 'labelText', 10, 'text', 'text', { maxLength: 200, multiline: true }), validate: validateLabelText },
  labelField('props.label.color', 'labelColor', 20, 'color', 'color', undefined, (drawing) => drawing.style.color),
  labelField('props.label.size', 'labelSize', 30, 'size', 'number', { min: 8, max: 72, step: 1, integer: true }),
  labelField('props.label.bold', 'labelBold', 40, 'bold', 'boolean'),
  labelField('props.label.italic', 'labelItalic', 50, 'italic', 'boolean'),
  labelField('props.label.align', 'labelAlign', 60, 'align', 'select', { options: ALIGN }),
];
