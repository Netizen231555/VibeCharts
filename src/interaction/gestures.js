/**
 * Touch gesture recognizer: one finger pans freely in X and Y, two fingers
 * pinch-zoom the shared index scale around the finger midpoint. Adding or
 * removing a finger starts a new phase from the current camera, so the view
 * never jumps. Cancelling a touch drops all pointers and ends the gesture.
 */
import { distance, isFiniteNumber, midpoint } from './geometry.js';

export function createGestureRecognizer({ navigation, paneAt, options = {} }) {
  const enabled = options.touch !== false;
  const pointers = new Map();
  let phase = 'idle';
  let paneId = null;
  let lastMidpoint = null;
  let lastDistance = null;

  function reset() {
    pointers.clear();
    phase = 'idle';
    paneId = null;
    lastMidpoint = null;
    lastDistance = null;
  }

  function startPan(point) {
    phase = 'pan';
    if (paneId === null) paneId = paneAt(point)?.id ?? null;
  }

  function startPinch() {
    phase = 'pinch';
    const [a, b] = [...pointers.values()];
    lastMidpoint = midpoint(a, b);
    lastDistance = distance(a, b);
  }

  return {
    get phase() {
      return phase;
    },
    get pointerCount() {
      return pointers.size;
    },
    get paneId() {
      return paneId;
    },
    get enabled() {
      return enabled;
    },
    begin(id, point, { pointerType = 'touch' } = {}) {
      if (!enabled || pointerType !== 'touch') return { accepted: false, reason: 'touch-disabled' };
      if (!pointers.has(id) && pointers.size >= 2) return { accepted: false, phase, reason: 'too-many-pointers' };
      pointers.set(id, { x: point.x, y: point.y });
      if (pointers.size === 1) {
        startPan(point);
        return { accepted: true, phase };
      }
      if (pointers.size === 2) {
        startPinch();
        return { accepted: true, phase };
      }
      return { accepted: false, phase, reason: 'too-many-pointers' };
    },
    move(id, point) {
      if (!enabled || !pointers.has(id)) return { applied: false, reason: 'not-tracked' };
      const previous = pointers.get(id);
      pointers.set(id, { x: point.x, y: point.y });
      if (phase === 'pan' && pointers.size === 1) {
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        if (dx === 0 && dy === 0) return { applied: false, phase };
        const result = navigation.pan(dx, dy, paneId);
        return { applied: result.applied, phase, result };
      }
      if (phase === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const center = midpoint(a, b);
        const currentDistance = distance(a, b);
        const applied = [];
        const dx = lastMidpoint ? center.x - lastMidpoint.x : 0;
        if (dx !== 0) applied.push(navigation.pan(dx, 0, paneId));
        if (isFiniteNumber(lastDistance) && lastDistance > 0 && currentDistance > 0) {
          const factor = lastDistance / currentDistance;
          if (Math.abs(factor - 1) > 1e-6) {
            applied.push(navigation.zoomIndex(factor, center.x, paneId));
          }
        }
        lastMidpoint = center;
        lastDistance = currentDistance;
        return { applied: applied.some((entry) => entry.applied), phase, results: applied };
      }
      return { applied: false, phase };
    },
    end(id) {
      if (!pointers.has(id)) return { phase, cancelled: false };
      pointers.delete(id);
      if (pointers.size === 1) {
        // A new one-finger phase starts from the remaining finger, not from a
        // stale baseline, so lifting a finger cannot jump the view.
        const remaining = [...pointers.values()][0];
        startPan(remaining);
        return { phase, cancelled: false, restarted: true };
      }
      if (pointers.size === 0) {
        const finished = phase;
        reset();
        return { phase: finished, cancelled: false, finished: true };
      }
      return { phase, cancelled: false };
    },
    cancel(id = null) {
      if (id !== null && !pointers.has(id)) return { cancelled: false, phase };
      const cancelledPhase = phase;
      reset();
      return { cancelled: true, phase: 'idle', cancelledPhase };
    },
    reset,
  };
}
