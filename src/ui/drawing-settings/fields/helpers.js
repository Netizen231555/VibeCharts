// Small constructors for descriptors, so a contribution states what a field is and not how a descriptor is built.
export const ALL_FAMILIES = Object.freeze(['line', 'filled', 'text', 'marker']);

const msg = (name) => `drawingSettings.f.${name}`;

export const color = (id, label, group, order, path, appliesTo, extra = {}) =>
  ({ id, tab: 'style', group, order, type: 'color', labelKey: msg(label), appliesTo, path, ...extra });

export const bool = (id, label, group, order, path, appliesTo, extra = {}) =>
  ({ id, tab: 'style', group, order, type: 'boolean', labelKey: msg(label), appliesTo, path, ...extra });

export const number = (id, label, group, order, path, appliesTo, limits, extra = {}) =>
  ({ id, tab: 'style', group, order, type: 'number', labelKey: msg(label), appliesTo, path, limits, ...extra });

export const select = (id, label, group, order, path, appliesTo, values, extra = {}) =>
  ({
    id, tab: 'style', group, order, type: 'select', labelKey: msg(label), appliesTo, path,
    limits: { options: values.map((value) => ({ value, labelKey: `drawingSettings.opt.${value}` })) }, ...extra,
  });

export const toolsOf = (table) => Object.freeze(Object.keys(table));
