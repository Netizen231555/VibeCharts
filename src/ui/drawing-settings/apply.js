/**
 * Applies edited settings to drawings: every change is validated first, the patches of several fields for one
 * drawing are composed in order, and everything is written by one `updateBatch`, so the whole edit is one undo step.
 */
import { InteractionError } from '../../interaction/errors.js';
import { DRAWING_TOOLS } from '../../drawings/tools.js';
import { fieldApplies } from './registry.js';
import { getPath, validateValue, invalid, clone, equal } from './values.js';

function setPath(root, path, value) {
  let node = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (node[path[i]] === null || typeof node[path[i]] !== 'object') node[path[i]] = {};
    node = node[path[i]];
  }
  node[path[path.length - 1]] = value;
}

/** Applies one validated change to the working copy and records which top-level keys it touched. */
function compose(field, value, work, touched) {
  if (field.path) {
    const [root, key] = field.path;
    // Writing below a key rewrites that whole key: the working copy already holds the merged parent.
    setPath(work, field.path, value);
    touched[root].add(key);
    return;
  }
  const patch = field.patch(value, work);
  for (const [root, content] of Object.entries(patch)) {
    if (root === 'anchors') {
      work.anchors = content;
      touched.anchors = true;
    } else if (root === 'style' || root === 'props') {
      for (const [key, part] of Object.entries(content)) {
        work[root][key] = part;
        touched[root].add(key);
      }
    }
  }
}

/**
 * @param {object} registry the field registry
 * @param {object} store a drawing store (`get`, `updateBatch`)
 * @returns {{ changed: boolean, ids: string[] }}
 */
export function applyWith(registry, store, { ids, changes, context = {} }) {
  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== 'string' || id === '')) {
    throw new InteractionError('ids must be a non-empty array of drawing ids', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'ids' });
  }
  if (!Array.isArray(changes) || changes.length === 0) {
    throw new InteractionError('changes must be a non-empty array of { fieldId, value }', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'changes' });
  }
  const uniqueIds = [...new Set(ids)];
  // Re-read every drawing now: a drawing deleted since the dialog opened is reported here and nothing else changes.
  const drawings = uniqueIds.map((id) => store.get(id));

  const seen = new Set();
  const resolved = changes.map((change) => {
    if (change === null || typeof change !== 'object' || typeof change.fieldId !== 'string') {
      throw new InteractionError('each change needs a fieldId', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'changes' });
    }
    const field = registry.get(change.fieldId);
    if (!field) {
      throw new InteractionError(`Unknown drawing setting: ${change.fieldId}`, { code: 'UNKNOWN_DRAWING_SETTING', field: change.fieldId });
    }
    if (seen.has(field.id)) throw invalid(field, 'is given more than once');
    seen.add(field.id);
    for (const drawing of drawings) {
      if (!fieldApplies(field, drawing, DRAWING_TOOLS) || (field.visibleWhen && field.visibleWhen(drawing, context) === false)) {
        throw new InteractionError(`Setting ${field.id} does not apply to drawing ${drawing.id}`, {
          code: 'SETTING_NOT_APPLICABLE', field: field.id, detail: { drawingId: drawing.id },
        });
      }
    }
    if (!field.multi && drawings.length > 1) {
      throw new InteractionError(`Setting ${field.id} can only be changed for one drawing at a time`, {
        code: 'SETTING_NOT_APPLICABLE', field: field.id,
      });
    }
    // Per-drawing checks (coordinates depend on the drawing), so the value is validated against each of them.
    const values = drawings.map((drawing) => validateValue(field, change.value, { ...context, drawing }));
    return { field, values };
  });

  const updates = [];
  let changed = false;
  drawings.forEach((drawing, index) => {
    const work = { style: clone(drawing.style), props: clone(drawing.props), anchors: clone(drawing.anchors) };
    const touched = { style: new Set(), props: new Set(), anchors: false };
    for (const { field, values } of resolved) compose(field, values[index], work, touched);
    const patch = {};
    let styleChanged = false;
    if (touched.style.size > 0) {
      const style = {};
      for (const key of touched.style) {
        if (!equal(work.style[key], drawing.style[key])) { style[key] = work.style[key]; styleChanged = true; }
      }
      if (styleChanged) patch.style = style;
    }
    if (touched.props.size > 0) {
      const props = {};
      for (const key of touched.props) {
        if (!equal(work.props[key], drawing.props[key])) props[key] = work.props[key];
      }
      if (Object.keys(props).length > 0) patch.props = props;
    }
    if (touched.anchors && !equal(work.anchors, drawing.anchors)) patch.anchors = work.anchors;
    // A style edit is an individual choice: the marker moves in the same patch, so one undo restores both.
    if (styleChanged) patch.ownStyle = true;
    if (Object.keys(patch).length > 0) changed = true;
    updates.push({ id: drawing.id, patch });
  });
  if (!changed) return { changed: false, ids: [] };
  // Unchanged drawings stay in the batch (with an empty patch) so a locked member refuses the whole edit.
  store.updateBatch(updates);
  return { changed: true, ids: updates.filter((update) => Object.keys(update.patch).length > 0).map((update) => update.id) };
}

export { getPath };
