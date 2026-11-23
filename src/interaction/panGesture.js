/**
 * Empty-plot pointer gestures: a click clears the drawing selection, a real drag pans.
 *
 * A mouse click is never perfectly still. Treating the first pixel of that jitter as a pan both nudges the chart
 * and suppresses the click's selection clear, so the pointer must travel past `CLICK_SLOP` before the gesture
 * becomes a drag. Once it does, the whole displacement from the press point is applied, so crossing the slop does
 * not lose the movement.
 */

export const CLICK_SLOP = 3;

/**
 * `startPoint` is the press point. `pan(dx, dy)` applies an incremental pan; `clearSelection()` runs when the
 * pointer is released without a drag. Returns a router gesture owner.
 */
export function createPanOwner({ paneId, startPoint = null, pan, clearSelection }) {
  if (typeof pan !== 'function') throw new TypeError('pan must be a function');
  if (typeof clearSelection !== 'function') throw new TypeError('clearSelection must be a function');
  const origin = startPoint ? { x: startPoint.x, y: startPoint.y } : null;
  let last = startPoint ? { x: startPoint.x, y: startPoint.y } : null;
  let moved = false;
  return {
    move(point) {
      if (!last) {
        last = { x: point.x, y: point.y };
        return;
      }
      if (!moved) {
        if (origin) {
          const dx = point.x - origin.x;
          const dy = point.y - origin.y;
          if (Math.hypot(dx, dy) <= CLICK_SLOP) {
            last = { x: point.x, y: point.y };
            return;
          }
          moved = true;
          last = { x: point.x, y: point.y };
          pan(dx, dy);
          return;
        }
        moved = true;
      }
      const dx = point.x - last.x;
      const dy = point.y - last.y;
      last = { x: point.x, y: point.y };
      if (dx !== 0 || dy !== 0) pan(dx, dy);
    },
    end() {
      if (!moved) clearSelection();
      return { paneId, moved };
    },
    cancel() {},
    commitKey: `pan:${paneId}`,
  };
}
