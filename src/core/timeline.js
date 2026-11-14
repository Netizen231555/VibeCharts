import { fail } from '../errors.js';
import { assertPlainObject, normalizeSlots } from './validate.js';

function copySlot(slot) {
  if (!slot) return null;
  const out = { barId: slot.barId };
  if (slot.time !== undefined) out.time = slot.time;
  if (slot.sessionDate !== undefined) {
    out.sessionDate = {
      year: slot.sessionDate.year,
      month: slot.sessionDate.month,
      day: slot.sessionDate.day
    };
  }
  return out;
}

/**
 * Host-owned ordered slot sequence. The host defines order; nothing is sorted.
 * Hooks are used by Chart to keep series, camera and modules consistent.
 *
 * @typedef {{barId: string, time?: number, sessionDate?: {year: number, month: number, day: number}}} Slot
 */
export class Timeline {
  constructor(hooks = {}) {
    this._slots = [];
    this._index = new Map();
    this._revision = 0;
    this._hooks = hooks;
  }

  get revision() {
    this._hooks.assertAlive?.('timeline.revision');
    return this._revision;
  }

  get length() {
    this._hooks.assertAlive?.('timeline.length');
    return this._slots.length;
  }

  slotAt(index) {
    this._hooks.assertAlive?.('timeline.slotAt');
    if (!Number.isInteger(index) || index < 0 || index >= this._slots.length) return null;
    return copySlot(this._slots[index]);
  }

  indexOf(barId) {
    this._hooks.assertAlive?.('timeline.indexOf');
    if (typeof barId !== 'string') return null;
    const index = this._index.get(barId);
    return index === undefined ? null : index;
  }

  toArray() {
    this._hooks.assertAlive?.('timeline.toArray');
    return this._slots.map(copySlot);
  }

  /** Public alias used by integration adapters. */
  listSlots() {
    this._hooks.assertAlive?.('timeline.listSlots');
    return this.toArray();
  }

  _reindex() {
    this._index = new Map();
    for (let i = 0; i < this._slots.length; i += 1) {
      this._index.set(this._slots[i].barId, i);
    }
  }

  _assertUniqueAgainstExisting(slots, operation) {
    for (let i = 0; i < slots.length; i += 1) {
      if (this._index.has(slots[i].barId)) {
        fail('DUPLICATE_BAR_ID', operation, `slot at index ${i} already exists in the timeline`, {
          field: 'barId',
          index: i
        });
      }
    }
  }

  /**
   * Atomically replaces the whole sequence.
   * @param {Slot[]} slots
   */
  setTimeline(slots) {
    this._hooks.assertAlive?.('timeline.setTimeline');
    const normalized = normalizeSlots(slots, 'timeline.setTimeline');
    this._hooks.onBeforeReplace?.(normalized);
    this._slots = normalized;
    this._reindex();
    this._revision += 1;
    this._hooks.onAfterReplace?.();
    return this;
  }

  /**
   * Appends slots in the supplied order.
   * @param {Slot[]} slots
   */
  append(slots) {
    this._hooks.assertAlive?.('timeline.append');
    const normalized = normalizeSlots(slots, 'timeline.append');
    if (normalized.length === 0) return this;
    this._assertUniqueAgainstExisting(normalized, 'timeline.append');
    if (this._hooks.onAppend) {
      this._hooks.onAppend(normalized);
      return this;
    }
    this._appendRaw(normalized);
    this._hooks.onAfterAppend?.(normalized);
    return this;
  }

  /**
   * Prepends slots in the supplied order. Existing barIds keep their identity.
   * @param {Slot[]} slots
   */
  prepend(slots) {
    this._hooks.assertAlive?.('timeline.prepend');
    const normalized = normalizeSlots(slots, 'timeline.prepend');
    if (normalized.length === 0) return this;
    this._assertUniqueAgainstExisting(normalized, 'timeline.prepend');
    if (this._hooks.onPrepend) {
      this._hooks.onPrepend(normalized);
      return this;
    }
    this._prependRaw(normalized);
    this._hooks.onAfterPrepend?.(normalized);
    return this;
  }

  /** Internal: validates and mutates without hooks (used by applyBatch). */
  _appendRaw(normalized) {
    this._assertUniqueAgainstExisting(normalized, 'timeline.append');
    this._slots = this._slots.concat(normalized);
    this._reindex();
    this._revision += 1;
  }

  /** Internal: validates and mutates without hooks (used by applyBatch). */
  _prependRaw(normalized) {
    this._assertUniqueAgainstExisting(normalized, 'timeline.prepend');
    this._slots = normalized.concat(this._slots);
    this._reindex();
    this._revision += 1;
  }

  /** Internal: replaces the whole sequence without hooks (atomic replacement). */
  _replaceRaw(normalized) {
    this._slots = normalized;
    this._reindex();
    this._revision += 1;
  }

  /** Internal: clears without hooks. */
  _clearRaw() {
    this._slots = [];
    this._index = new Map();
    this._revision += 1;
  }

  /**
   * Returns a non-mutating removal plan enriched by chart hooks.
   * @param {string} barId boundary; slots strictly before it are affected
   */
  previewRemoveHistoryBefore(barId) {
    this._hooks.assertAlive?.('timeline.previewRemoveHistoryBefore');
    const index = this.indexOf(barId);
    if (index === null) {
      fail('UNKNOWN_BAR_ID', 'timeline.previewRemoveHistoryBefore', 'boundary "barId" does not exist', {
        field: 'barId',
        barId
      });
    }
    const base = {
      operation: 'removeHistoryBefore',
      boundaryBarId: barId,
      revision: this._revision,
      removedBarIds: this._slots.slice(0, index).map((slot) => slot.barId)
    };
    const enriched = this._hooks.onPreview?.(base) ?? base;
    return Object.freeze({ ...enriched });
  }

  /**
   * Removes slots strictly before plan.boundaryBarId atomically.
   * @param {{boundaryBarId: string, revision: number, removedBarIds?: string[]}} plan
   */
  removeHistoryBefore(plan) {
    this._hooks.assertAlive?.('timeline.removeHistoryBefore');
    assertPlainObject(plan, 'timeline.removeHistoryBefore', 'plan');
    const boundaryBarId = plan.boundaryBarId;
    if (typeof boundaryBarId !== 'string' || boundaryBarId.length === 0) {
      fail('INVALID_ARGUMENT', 'timeline.removeHistoryBefore', 'plan.boundaryBarId is required', {
        field: 'boundaryBarId'
      });
    }
    const index = this.indexOf(boundaryBarId);
    if (index === null) {
      fail('UNKNOWN_BAR_ID', 'timeline.removeHistoryBefore', 'boundary "barId" does not exist', {
        field: 'barId',
        barId: boundaryBarId
      });
    }
    if (plan.revision !== this._revision) {
      fail('STALE_PLAN', 'timeline.removeHistoryBefore', 'removal plan is stale; preview again', {
        field: 'revision'
      });
    }
    const removed = this._slots.slice(0, index);
    if (plan.removedBarIds !== undefined) {
      if (
        !Array.isArray(plan.removedBarIds) ||
        plan.removedBarIds.length !== removed.length ||
        plan.removedBarIds.some((id, i) => id !== removed[i].barId)
      ) {
        fail('STALE_PLAN', 'timeline.removeHistoryBefore', 'removal plan does not match the timeline', {
          field: 'removedBarIds'
        });
      }
    }
    const prepared = this._hooks.onBeforeRemove?.(plan);
    const removedBarIds = removed.map((slot) => slot.barId);
    this._slots = this._slots.slice(index);
    this._reindex();
    this._revision += 1;
    this._hooks.onAfterRemove?.({ removedBarIds, boundaryBarId, revision: this._revision }, prepared);
    return { removedBarIds, boundaryBarId, revision: this._revision };
  }
}
