/**
 * Input priority and gesture ownership.
 *
 * A pointer gesture belongs to exactly one handler for its whole lifetime:
 * an active capture wins, then the armed drawing tool, then a drawing handle
 * or body, then an axis, then the plot, then the browser. A capture survives
 * the pointer leaving the plot area and is released on completion, cancel,
 * `lostpointercapture` or destroy. Subscribers see a successful action only
 * after the owner reports a commit; cancellations never publish a commit.
 */
import { InteractionError } from './errors.js';

export const ROUTE = Object.freeze({
  CAPTURE: 'capture',
  TOOL: 'tool',
  OBJECT: 'object',
  AXIS_INDEX: 'axis-index',
  AXIS_PRICE: 'axis-price',
  PLOT: 'plot',
  NONE: 'none',
});

export const CANCEL_REASONS = Object.freeze({
  POINTER_CANCEL: 'pointercancel',
  LOST_CAPTURE: 'lost-capture',
  ESCAPE: 'escape',
  DESTROY: 'destroy',
  REPLACED: 'replaced',
});

/**
 * Decide the single owner for a fresh pointer-down.
 * `captureActive` is true while any gesture is in flight.
 */
export function routePointerDown({ captureActive, tool, hit, point }) {
  if (captureActive) return { kind: ROUTE.CAPTURE, hit, point, accepted: false, reason: 'capture-active' };
  if (tool && tool.active && tool.enabled !== false) return { kind: ROUTE.TOOL, hit, point, accepted: true };
  if (hit && (hit.kind === 'handle' || hit.kind === 'drawing')) return { kind: ROUTE.OBJECT, hit, point, accepted: true };
  if (hit && hit.kind === 'axis') {
    return { kind: hit.axis === 'price' ? ROUTE.AXIS_PRICE : ROUTE.AXIS_INDEX, hit, point, accepted: true };
  }
  if (hit && hit.kind === 'plot') return { kind: ROUTE.PLOT, hit, point, accepted: true };
  return { kind: ROUTE.NONE, hit: hit || null, point, accepted: false, reason: 'no-target' };
}

/**
 * Gesture owner interface:
 *   move(point, meta) -> void
 *   end(point, meta)  -> result | { cancelled: true, reason? } | undefined
 *   cancel(reason)    -> void
 *   commitKey?        -> string   (identifier published on commit)
 */
export function createRouter({ onCommit = () => {}, onCancel = () => {}, onCaptureChange = () => {} } = {}) {
  let active = null;

  function assertOwner(owner) {
    if (!owner || typeof owner.end !== 'function' || typeof owner.cancel !== 'function') {
      throw new InteractionError('Gesture owner must implement end() and cancel()', { code: 'INVALID_GESTURE_OWNER', field: 'owner' });
    }
  }

  const router = {
    get capture() {
      return active ? { kind: active.kind, pointerId: active.pointerId, captureId: active.captureId, data: active.data } : null;
    },
    get active() {
      return active !== null;
    },
    begin(kind, owner, { pointerId = null, point = null, data = null } = {}) {
      assertOwner(owner);
      if (active) {
        return { started: false, reason: 'capture-active', active: router.capture };
      }
      active = {
        kind,
        owner,
        pointerId,
        captureId: Symbol(kind),
        point: point ? { x: point.x, y: point.y } : null,
        data,
        moves: 0,
      };
      onCaptureChange({ active: true, kind, pointerId });
      return { started: true, captureId: active.captureId };
    },
    move(point, meta = {}) {
      if (!active) return { handled: false, reason: 'no-capture' };
      active.point = { x: point.x, y: point.y };
      active.moves += 1;
      if (typeof active.owner.move === 'function') active.owner.move(point, { ...meta, kind: active.kind, moves: active.moves });
      return { handled: true, kind: active.kind };
    },
    end(point, meta = {}) {
      if (!active) return { handled: false, reason: 'no-capture' };
      const capture = active;
      let result;
      try {
        result = capture.owner.end(point, { ...meta, kind: capture.kind, moves: capture.moves });
      } catch (error) {
        active = null;
        onCaptureChange({ active: false, kind: capture.kind, pointerId: capture.pointerId });
        try {
          capture.owner.cancel('commit-failed');
        } finally {
          onCancel({ reason: 'commit-failed', kind: capture.kind, error });
        }
        throw error;
      }
      active = null;
      onCaptureChange({ active: false, kind: capture.kind, pointerId: capture.pointerId });
      if (result && result.cancelled === true) {
        onCancel({ reason: result.reason || 'cancelled', kind: capture.kind, pointerId: capture.pointerId });
        return { handled: true, committed: false, result };
      }
      const commit = { kind: capture.kind, pointerId: capture.pointerId, result: result === undefined ? null : result, commitKey: capture.owner.commitKey || null };
      onCommit(commit);
      return { handled: true, committed: true, result: commit.result };
    },
    cancel(reason) {
      if (!active) return { handled: false, reason: 'no-capture' };
      const capture = active;
      active = null;
      onCaptureChange({ active: false, kind: capture.kind, pointerId: capture.pointerId });
      capture.owner.cancel(reason);
      onCancel({ reason, kind: capture.kind, pointerId: capture.pointerId, data: capture.data });
      return { handled: true, kind: capture.kind };
    },
  };
  return router;
}
