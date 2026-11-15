/**
 * Pointer gestures on existing drawings: moving a drawing or one of its handles, and cloning by Shift-drag.
 *
 * `createObjectOwner` is the owner the router drives (`move`, `end`, `cancel`); it knows nothing about the DOM, so
 * the cancellation paths (Escape, pointer cancel, lost capture) are the router's `cancel` and can be tested without
 * a browser. The caller supplies `env`:
 * `{ chart, store, getDrawing, getSnap, locale, tr, announce, reportError, ensureSelected, adoptStoreSelection,
 *    hostController }`.
 */
import { isFiniteNumber } from './geometry.js';
import { drawingAnchor, effectiveSnap, modifierState, SHIFT_HORIZONTAL_TYPES } from './drawingTool.js';

// Dragging is staged locally: the store sees exactly one confirmed update,
// and a cancelled gesture never crosses the backend reconciliation boundary.
function drawingDrag(request, env) {
  const { chart, store, getDrawing, getSnap, locale, tr, announce, reportError, adoptStoreSelection } = env;
  const surface = chart.surface;
  if (!store || !surface || typeof surface.anchorToX !== 'function' || typeof surface.xToAnchor !== 'function') return null;
  // A clone drag shows its copies as a separate ghost and commits one duplicate; a move drags the drawings themselves.
  const clone = request.clone === true;
  if (clone ? typeof store.duplicate !== 'function' || typeof store.setClonePreview !== 'function' : typeof store.update !== 'function') {
    if (clone) reportError(new Error(tr('drawing.cloneApiUnavailable')), { action: 'drawing-clone' });
    return null;
  }
  const selected = typeof store.getSelection === 'function' ? store.getSelection() : [];
  const ids = request.anchorIndex === null && selected.includes(request.drawingId) ? selected : [request.drawingId];
  const entries = ids.map(id => {
    const drawing = getDrawing(id);
    if (!drawing) return null;
    const binding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
    const anchors = drawing.anchors.map(anchor => ({
      anchor,
      x: anchor.anchorBarId === undefined ? null : surface.anchorToX(anchor, { paneId: drawing.paneId }),
      y: anchor.price === undefined ? null : surface.priceToY(anchor.price, binding),
    }));
    if (anchors.some(item => (item.anchor.anchorBarId !== undefined && !isFiniteNumber(item.x)) ||
        (item.anchor.price !== undefined && !isFiniteNumber(item.y)))) return null;
    return { drawing, binding, anchors };
  });
  if (entries.some(entry => entry === null) || (entries.length > 1 && typeof store.updateBatch !== 'function')) {
    reportError(new Error(tr('drawing.moveUnavailable')), { action: 'drawing-update' });
    return null;
  }
  let lastPreviewError = null;
  // The drawing itself is drawn at its pending position (store.setDragPreview), so it follows the pointer instead
  // of a dashed ghost that jumps on release; the document and the undo stack change only on commit.
  function clearPreview() {
    if (clone) store.setClonePreview(null);
    else store.setDragPreview(null);
    lastPreviewError = null;
    chart.requestRender();
  }
  function updatesAt(point, notify, event) {
    const mods = modifierState(event);
    const shift = mods.shiftKey;
    const dx = point.x - request.point.x;
    const dy = point.y - request.point.y;
    return entries.map(({ drawing, binding, anchors: initial }) => ({
      id: drawing.id,
      patch: { anchors: initial.map((item, index) => {
        if (request.anchorIndex !== null && request.anchorIndex !== index) return item.anchor;
        const moved = drawingAnchor(chart, { x: item.x === null ? point.x : item.x + dx,
          y: item.y === null ? point.y : item.y + dy }, binding,
        { x: item.x !== null, price: item.y !== null }, effectiveSnap(chart, binding, getSnap(), mods), notify, locale());
        // Shift keeps a two-point line horizontal: the dragged handle takes the other anchor's price.
        if (shift && request.anchorIndex !== null && initial.length === 2 && SHIFT_HORIZONTAL_TYPES.includes(drawing.type) &&
            moved.price !== undefined) moved.price = initial[1 - index].anchor.price;
        return moved;
      }) }
    }));
  }
  function previewMove(point, meta = {}) {
    try {
      const updates = updatesAt(point, () => {}, meta.event);
      if (clone) {
        store.setClonePreview(updates);
        for (const layout of store.clonePreview()) {
          if (!layout.resolved) throw new Error(layout.error?.message || layout.reason || tr('drawing.geometryUnavailable'));
        }
      } else {
        store.setDragPreview(updates);
        for (const { id } of updates) {
          const layout = store.layout(id);
          if (!layout.resolved) throw new Error(layout.error?.message || layout.reason || tr('drawing.geometryUnavailable'));
        }
      }
      lastPreviewError = null;
    } catch (error) {
      // An unresolvable position is not shown: the drawing stays where it was until the pointer returns to a valid one.
      if (clone) store.setClonePreview(null);
      else store.setDragPreview(null);
      if (lastPreviewError !== error.message) reportError(error, { action: 'drawing-preview' });
      lastPreviewError = error.message;
    }
    chart.requestRender();
  }
  // The drop is validated through the ghost first so an unresolvable destination creates nothing and is announced.
  function duplicateAt(point, event) {
    try {
      const updates = updatesAt(point, text => announce(text), event);
      store.setClonePreview(updates);
      const unresolved = store.clonePreview().some(layout => !layout.resolved);
      store.setClonePreview(null);
      if (unresolved) throw new Error(tr('drawing.cloneUnavailable'));
      const copies = store.duplicate(updates.map(update => update.id), { updates });
      adoptStoreSelection();
      announce(tr('drawing.copied', { count: copies.length }));
    } catch (error) {
      store.setClonePreview(null);
      reportError(error, { action: 'drawing-clone' });
      announce(tr('drawing.cloneUnavailable'), { error: true });
    }
  }
  return {
    move: previewMove,
    cancel: clearPreview,
    commit(point, meta = {}) {
      clearPreview();
      const dx = point.x - request.point.x;
      const dy = point.y - request.point.y;
      if (dx === 0 && dy === 0) return;
      if (clone) { duplicateAt(point, meta.event); return; }
      const updates = updatesAt(point, text => announce(text), meta.event);
      if (updates.length === 1) store.update(updates[0].id, updates[0].patch);
      else store.updateBatch(updates);
    },
  };
}

// Shift sampled at pointer down turns a body drag into a clone drag; handle drags keep their own constraint.
export function createObjectOwner(hit, point, event, env) {
  env.ensureSelected(hit);
  const clone = hit.kind === 'drawing' && event?.shiftKey === true;
  const controllerRequest = {
    drawingId: hit.drawingId,
    anchorIndex: hit.kind === 'handle' ? hit.anchorIndex : null,
    locked: hit.locked === true,
    clone,
    point: { x: point.x, y: point.y },
  };
  // A locked drawing cannot move, but copying leaves it untouched, so a clone drag is allowed.
  const controller = !hit.locked || clone
    ? (env.hostController && typeof env.hostController.begin === 'function'
      ? env.hostController.begin(controllerRequest) : drawingDrag(controllerRequest, env))
    : null;
  let moved = false;
  let last = { x: point.x, y: point.y };
  return {
    move(next, meta) {
      if (next.x !== last.x || next.y !== last.y) moved = true;
      last = { x: next.x, y: next.y };
      if (controller && typeof controller.move === 'function') controller.move(next, meta);
    },
    end(next, meta) {
      try {
        if (controller && typeof controller.commit === 'function') controller.commit(next, meta);
      } catch (error) {
        env.reportError(error, { action: 'drawing-update', drawingId: hit.drawingId });
        return { cancelled: true, reason: 'commit-failed', drawingId: hit.drawingId, error };
      }
      return { drawingId: hit.drawingId, anchorIndex: controllerRequest.anchorIndex, moved: Boolean(controller) && moved };
    },
    cancel(reason) {
      if (controller && typeof controller.cancel === 'function') controller.cancel(reason);
    },
    commitKey: `object:${hit.drawingId}`,
  };
}
