/**
 * Saved styles and shared-style planning on top of the drawing store.
 */
import { DrawingError } from '../../drawings/values.js';
import { DRAWING_TOOLS } from '../../drawings/tools.js';
import { STYLE_FAMILIES } from '../../drawings/styles.js';
import { InteractionError } from '../../interaction/errors.js';

/** Applies a saved style to drawings of its type; the style and `ownStyle: true` are one undo step. */
export function applySavedDrawingStyle(store, ids, styleId) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new InteractionError('ids must be a non-empty array of drawing ids', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'ids' });
  }
  const saved = store.listStyles().find((style) => style.id === styleId);
  if (!saved) throw new DrawingError('unknown-style', `Unknown saved style: ${String(styleId)}`, { id: styleId });
  const drawings = [...new Set(ids)].map((id) => store.get(id));
  for (const drawing of drawings) {
    if (drawing.type !== saved.type) {
      throw new DrawingError('incompatible-style', `Style ${saved.id} is not compatible with drawing ${drawing.id}`, { id: drawing.id, styleId: saved.id });
    }
  }
  return store.updateBatch(drawings.map((drawing) => ({ id: drawing.id, patch: { style: saved.style, ownStyle: true } })));
}

/** Saves the drawing's current style under `name` (non-empty, at most 200 characters). */
export function saveDrawingStyle(store, id, name) {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 200) {
    throw new InteractionError('name must be a string of 1 to 200 characters', { code: 'INVALID_DRAWING_SETTINGS_INPUT', field: 'name' });
  }
  const drawing = store.get(id);
  return store.saveStyle({ type: drawing.type, name, style: drawing.style });
}

function lockedBy(drawing, groups) {
  if (drawing.locked) return true;
  const byId = new Map((groups ?? []).map((group) => [group.id, group]));
  const seen = new Set();
  for (let groupId = drawing.groupId; groupId && !seen.has(groupId);) {
    seen.add(groupId);
    const group = byId.get(groupId);
    if (!group) break;
    if (group.locked) return true;
    groupId = group.parentId ?? null;
  }
  return false;
}

/**
 * Plans a shared style over drawings without touching anything, so the same list can feed a preview
 * (`drawings.setDragPreview`) and the commit (`drawings.updateBatch`).
 * `options`: `keys` limits the properties, `includeOwn` also plans drawings with `ownStyle`, `ownStyle` writes that
 * value in every update, `groups` lets group locks count. A drawing that would not change is omitted; one that is
 * locked (directly or by a group) is listed as locked even when it also has its own style.
 */
export function planDrawingStyle(drawings, style, options = {}) {
  const keys = options.keys ? new Set(options.keys) : null;
  const updates = [];
  const skippedOwn = [];
  const skippedLocked = [];
  for (const drawing of drawings) {
    const allowed = STYLE_FAMILIES[DRAWING_TOOLS[drawing.type].family];
    const filtered = {};
    for (const [key, value] of Object.entries(style)) {
      if (allowed.includes(key) && (!keys || keys.has(key))) filtered[key] = value;
    }
    const merged = { ...drawing.style, ...filtered };
    const styleChanged = Object.keys(filtered).some((key) => drawing.style[key] !== filtered[key]);
    const ownChanged = typeof options.ownStyle === 'boolean' && drawing.ownStyle !== options.ownStyle;
    if (!styleChanged && !ownChanged) continue;
    if (lockedBy(drawing, options.groups)) { skippedLocked.push(drawing.id); continue; }
    if (drawing.ownStyle === true && options.includeOwn !== true) { skippedOwn.push(drawing.id); continue; }
    const patch = { style: merged };
    if (typeof options.ownStyle === 'boolean') patch.ownStyle = options.ownStyle;
    updates.push({ id: drawing.id, patch });
  }
  return { updates, skippedOwn, skippedLocked };
}
