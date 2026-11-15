/**
 * Drawing activation: a request to edit the settings of the current selection.
 *
 * It never changes the document or its history; only the selection may change before the event, and the event is
 * delivered after it did. Whoever listens (the settings dialog, a host) decides what to show. The DOM events that
 * lead here (double click, Enter) stay in `attachInteraction`; the rules live in this module so they can be tested
 * without a document. `env`: `{ getStore, getDrawing, selectDrawing, adoptStoreSelection, emit, isDestroyed }`.
 */
import { InteractionError } from './errors.js';

export function createActivation(env) {
  function emitFromSelection(source) {
    const drawingIds = env.getStore()?.getSelection?.() ?? [];
    if (drawingIds.length === 0) return false;
    env.adoptStoreSelection();
    env.emit('drawingActivate', { drawingIds: [...drawingIds], drawingId: drawingIds[0], source });
    return true;
  }

  return {
    /**
     * A double click on a drawing body or handle. An armed tool finishes its construction with a double click and a
     * gesture in flight owns the pointer, so neither activates. A hit on a selected drawing keeps the whole
     * selection; any other hit becomes the selection on its own. Returns whether the event was emitted.
     */
    fromPointer(hit, { toolArmed, gestureActive }) {
      if (!hit || (hit.kind !== 'handle' && hit.kind !== 'drawing') || toolArmed || gestureActive) return false;
      const store = env.getStore();
      if (!store || typeof store.getSelection !== 'function') return false;
      if (!store.getSelection().includes(hit.drawingId)) env.selectDrawing(hit.drawingId);
      return emitFromSelection('pointer');
    },

    /** Enter in the chart region. The caller has already excluded armed tools, open menus and editable targets. */
    fromKeyboard() {
      return emitFromSelection('keyboard');
    },

    /** `interaction.activateDrawing(ids?)`: validates everything before the selection is touched. */
    fromApi(ids) {
      if (env.isDestroyed()) {
        throw new InteractionError('The interaction has been destroyed', { code: 'INTERACTION_DESTROYED', field: 'interaction' });
      }
      const store = env.getStore();
      if (!store || typeof store.getSelection !== 'function') {
        throw new InteractionError('The chart has no drawing store', { code: 'NO_DRAWING_SELECTED', field: 'ids' });
      }
      if (ids !== undefined) {
        if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || id === '')) {
          throw new InteractionError('ids must be an array of non-empty strings', { code: 'INVALID_DRAWING_IDS', field: 'ids' });
        }
        for (const id of ids) {
          let visible = false;
          try { visible = Boolean(env.getDrawing(id)) && store.layout(id).visible !== false; } catch { visible = false; }
          if (!visible) throw new InteractionError(`Unknown or hidden drawing: ${id}`, { code: 'UNKNOWN_DRAWING', field: 'ids', id });
        }
        // An empty list would become an empty selection, which has nothing to edit; it fails without clearing it.
        if (ids.length > 0) store.selectMany(ids);
        else throw new InteractionError('No drawing is selected', { code: 'NO_DRAWING_SELECTED', field: 'ids' });
      }
      if (store.getSelection().length === 0) {
        throw new InteractionError('No drawing is selected', { code: 'NO_DRAWING_SELECTED', field: 'ids' });
      }
      emitFromSelection('api');
    },
  };
}
