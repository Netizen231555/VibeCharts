/**
 * Pane layout state machine: order, height and visibility.
 *
 * Reordering only changes positions; pane ids, series, scales, the shared
 * index scale and barId anchors live in the core and are never touched here.
 * Resizing is a reversible preview until the gesture commits; Escape,
 * `pointercancel` or lost capture restore the previous layout. Hiding keeps
 * every setting, refuses to hide the last visible pane, and reports the
 * control that should receive focus.
 */
import { InteractionError } from './errors.js';
import { clamp, isFiniteNumber } from './geometry.js';
import { createEmitter } from './emitter.js';

function normalizePanes(panes, defaults = {}) {
  if (!Array.isArray(panes) || panes.length === 0) {
    throw new InteractionError('Pane layout requires at least one pane', { code: 'INVALID_PANE_LAYOUT', field: 'panes' });
  }
  const seen = new Set();
  return panes.map((pane, index) => {
    if (!pane || typeof pane.id !== 'string' || pane.id.length === 0) {
      throw new InteractionError('Pane id must be a non-empty string', { code: 'INVALID_PANE_LAYOUT', field: `panes[${index}].id` });
    }
    if (seen.has(pane.id)) {
      throw new InteractionError(`Duplicate pane id ${pane.id}`, { code: 'INVALID_PANE_LAYOUT', field: 'panes.id' });
    }
    seen.add(pane.id);
    const height = pane.height === undefined ? defaults.height : pane.height;
    const minHeight = pane.minHeight === undefined ? defaults.minHeight : pane.minHeight;
    if (!isFiniteNumber(height) || height <= 0) {
      throw new InteractionError('Pane height must be a finite positive number', { code: 'INVALID_PANE_LAYOUT', field: `panes[${index}].height` });
    }
    if (!isFiniteNumber(minHeight) || minHeight <= 0) {
      throw new InteractionError('Pane minHeight must be a finite positive number', { code: 'INVALID_PANE_LAYOUT', field: `panes[${index}].minHeight` });
    }
    return {
      id: pane.id,
      order: isFiniteNumber(pane.order) ? pane.order : index,
      height,
      minHeight,
      visible: pane.visible !== false,
    };
  });
}

function clone(list) {
  return list.map((pane) => ({ ...pane }));
}

export function createPaneLayout({ panes, separatorHeight = 4, containerHeight = null, minHeight = 24 } = {}) {
  const emitter = createEmitter();
  let committed = normalizePanes(panes, { height: 120, minHeight }).sort((a, b) => a.order - b.order);
  let preview = null;
  let baseline = null;
  let viewport = isFiniteNumber(containerHeight) ? containerHeight : null;

  function sorted(list) {
    return list.slice().sort((a, b) => a.order - b.order);
  }

  function find(list, id) {
    if (typeof id !== 'string' || id.length === 0) {
      throw new InteractionError('Pane id is required', { code: 'INVALID_PANE', field: 'paneId' });
    }
    const pane = list.find((entry) => entry.id === id);
    if (!pane) throw new InteractionError(`Unknown pane ${id}`, { code: 'UNKNOWN_PANE', field: 'paneId', detail: id });
    return pane;
  }

  function maxHeightFor(id) {
    if (!isFiniteNumber(viewport)) return null;
    const others = committed.filter((pane) => pane.visible && pane.id !== id).reduce((sum, pane) => sum + pane.minHeight, 0);
    const separators = committed.filter((pane) => pane.visible).length > 1 ? separatorHeight * (committed.filter((pane) => pane.visible).length - 1) : 0;
    return Math.max(find(committed, id).minHeight, viewport - others - separators);
  }

  function emitChange(kind, extra = {}) {
    emitter.emit('change', { kind, preview: false, panes: clone(sorted(committed)), ...extra });
  }

  function effective() {
    return preview || committed;
  }

  const layout = {
    get separatorHeight() {
      return separatorHeight;
    },
    get containerHeight() {
      return viewport;
    },
    get hasPreview() {
      return preview !== null;
    },
    list() {
      return clone(sorted(committed));
    },
    previewList() {
      return clone(sorted(effective()));
    },
    get(id) {
      return { ...find(committed, id) };
    },
    subscribe(handler) {
      return emitter.on('change', handler);
    },
    setContainerHeight(height) {
      if (!isFiniteNumber(height) || height < 0) {
        throw new InteractionError('Container height must be a finite non-negative number', { code: 'INVALID_SIZE', field: 'containerHeight' });
      }
      viewport = height;
      return { ok: true };
    },
    visible() {
      return clone(sorted(committed)).filter((pane) => pane.visible);
    },
    visibleCount() {
      return committed.filter((pane) => pane.visible).length;
    },
    requiredHeight() {
      const visible = committed.filter((pane) => pane.visible);
      if (visible.length === 0) return 0;
      return visible.reduce((sum, pane) => sum + pane.height, 0) + separatorHeight * (visible.length - 1);
    },
    needsScroll(height = viewport) {
      if (!isFiniteNumber(height)) return false;
      return layout.requiredHeight() > height;
    },
    canHide(id) {
      const pane = find(committed, id);
      if (!pane.visible) return { ok: false, code: 'ALREADY_HIDDEN', paneId: id };
      if (committed.filter((entry) => entry.visible).length <= 1) {
        return { ok: false, code: 'LAST_VISIBLE_PANE', paneId: id, reason: 'Нельзя скрыть единственную видимую панель' };
      }
      return { ok: true, paneId: id };
    },
    setVisible(id, visible, { restoreFocus = false } = {}) {
      const pane = find(committed, id);
      const next = visible === true;
      if (pane.visible === next) return { ok: false, code: 'NO_CHANGE', paneId: id };
      if (!next) {
        const check = layout.canHide(id);
        if (!check.ok) return check;
      }
      pane.visible = next;
      emitChange('visibility', { paneId: id, visible: next });
      return {
        ok: true,
        paneId: id,
        visible: next,
        focusId: !next && restoreFocus ? `pane-restore:${id}` : null,
      };
    },
    hide(id, options) {
      return layout.setVisible(id, false, options);
    },
    show(id) {
      return layout.setVisible(id, true);
    },
    move(id, direction) {
      const list = sorted(committed);
      const pane = find(list, id);
      if (!isFiniteNumber(direction) || direction === 0) {
        return { ok: false, code: 'INVALID_DIRECTION', paneId: id };
      }
      const index = list.indexOf(pane);
      const targetIndex = direction === Infinity ? list.length - 1 : direction === -Infinity ? 0 : clamp(index + Math.sign(direction), 0, list.length - 1);
      if (targetIndex === index) return { ok: false, code: 'AT_BOUNDARY', paneId: id };
      list.splice(index, 1);
      list.splice(targetIndex, 0, pane);
      list.forEach((entry, position) => {
        entry.order = position;
      });
      committed = list;
      emitChange('reorder', { paneId: id, index: targetIndex });
      return { ok: true, paneId: id, order: list.map((entry) => entry.id) };
    },
    moveTo(id, targetIndex) {
      if (!isFiniteNumber(targetIndex) || !Number.isInteger(targetIndex)) {
        return { ok: false, code: 'INVALID_INDEX', paneId: id };
      }
      const list = sorted(committed);
      const pane = find(list, id);
      const index = list.indexOf(pane);
      const clamped = clamp(targetIndex, 0, list.length - 1);
      if (clamped === index) return { ok: false, code: 'NO_CHANGE', paneId: id };
      list.splice(index, 1);
      list.splice(clamped, 0, pane);
      list.forEach((entry, position) => {
        entry.order = position;
      });
      committed = list;
      emitChange('reorder', { paneId: id, index: clamped });
      return { ok: true, paneId: id, order: list.map((entry) => entry.id) };
    },
    beginResize(id) {
      find(committed, id);
      baseline = clone(committed);
      preview = clone(committed);
      return { ok: true, paneId: id, snapshot: clone(committed) };
    },
    previewResize(id, height) {
      if (!preview) {
        baseline = clone(committed);
        preview = clone(committed);
      }
      const pane = find(preview, id);
      if (!isFiniteNumber(height)) {
        return { ok: false, code: 'INVALID_HEIGHT', paneId: id, min: pane.minHeight, max: maxHeightFor(id) };
      }
      const max = maxHeightFor(id);
      const clamped = clamp(height, pane.minHeight, max === null ? Number.MAX_SAFE_INTEGER : max);
      if (Math.abs(clamped - pane.height) < 1e-9) {
        return { ok: true, preview: true, paneId: id, height: clamped, min: pane.minHeight, max, unchanged: true };
      }
      pane.height = clamped;
      emitter.emit('preview', { kind: 'resize', paneId: id, height: clamped, panes: clone(sorted(preview)) });
      return { ok: true, preview: true, paneId: id, height: clamped, min: pane.minHeight, max, total: preview.reduce((sum, entry) => sum + (entry.visible ? entry.height : 0), 0) };
    },
    commitResize() {
      if (!preview) return { ok: false, code: 'NO_PREVIEW' };
      committed = preview;
      preview = null;
      baseline = null;
      emitChange('resize');
      return { ok: true, panes: clone(sorted(committed)) };
    },
    cancelResize() {
      if (!preview) return { ok: false, code: 'NO_PREVIEW' };
      const restored = baseline ? clone(baseline) : clone(committed);
      preview = null;
      baseline = null;
      emitter.emit('cancel', { kind: 'resize', panes: clone(sorted(restored)) });
      return { ok: true, restored: true, panes: clone(sorted(restored)) };
    },
    resizeByKeyboard(id, delta, { announce = true } = {}) {
      const pane = find(committed, id);
      if (!isFiniteNumber(delta)) return { ok: false, code: 'INVALID_HEIGHT', paneId: id };
      const max = maxHeightFor(id);
      const nextHeight = clamp(pane.height + delta, pane.minHeight, max === null ? Number.MAX_SAFE_INTEGER : max);
      if (Math.abs(nextHeight - pane.height) < 1e-9) {
        return { ok: false, code: 'AT_LIMIT', paneId: id, height: pane.height, min: pane.minHeight, max };
      }
      pane.height = nextHeight;
      const announcement = {
        paneId: id,
        value: nextHeight,
        min: pane.minHeight,
        max,
        text: announce ? `Высота панели ${nextHeight} пикселей, минимум ${pane.minHeight}, максимум ${max === null ? 'не ограничен' : max}` : null,
      };
      emitChange('resize', { paneId: id, height: nextHeight, announcement });
      return { ok: true, paneId: id, height: nextHeight, min: pane.minHeight, max, announcement };
    },
    snapshot() {
      return { panes: clone(sorted(committed)) };
    },
    restore(snapshot) {
      if (!snapshot || !Array.isArray(snapshot.panes)) {
        throw new InteractionError('Invalid pane snapshot', { code: 'INVALID_PANE_LAYOUT', field: 'snapshot' });
      }
      committed = normalizePanes(snapshot.panes, { height: 120, minHeight }).sort((a, b) => a.order - b.order);
      preview = null;
      baseline = null;
      emitChange('restore');
      return layout.list();
    },
  };
  return layout;
}
