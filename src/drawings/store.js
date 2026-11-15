import { DRAWING_TOOLS, anchorCountCheck, normalizeAnchor, normalizeProps, PITCHFORK_VARIANTS } from './tools.js';
import { completeStyle, validateStyle } from './styles.js';
import { buildLayout, resolveAnchor, validateDrawingGeometry } from './layout.js';
import { measureAnchors } from './analytics.js';
import { clone, equal, fail, isNumber, isObject, normalizeZero, requireBoolean, requireString } from './values.js';

export const DRAWINGS_SCHEMA_VERSION = 1;
export const DRAWINGS_FORMAT = 'vibecharts/drawings';
export const DRAWING_TOOL_TYPES = Object.freeze(Object.keys(DRAWING_TOOLS));
export const DRAWING_RESTORE_HOOKS = Symbol('drawingRestoreHooks');

const ADAPTER_METHODS = ['resolveX', 'logicalToX', 'priceToY', 'yToPrice', 'getVisibleRect', 'getIndexCount', 'getSlot', 'indexOf', 'getSeriesValues'];

export function createDrawingStore(options) {
  if (!isObject(options)) fail('invalid-options', 'options must be an object');
  const context = normalizeContext(options.context);
  const adapter = options.geometry;
  if (!isObject(adapter)) fail('invalid-geometry', 'geometry adapter is required');
  for (const method of ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') fail('invalid-geometry', `geometry.${method} must be a function`, { field: `geometry.${method}` });
  }
  const historyLimit = options.historyLimit;
  if (!Number.isSafeInteger(historyLimit) || historyLimit < 0) {
    fail('invalid-history-limit', 'historyLimit must be a finite non-negative safe integer', { field: 'historyLimit' });
  }
  if (options.deferNotifications !== undefined && typeof options.deferNotifications !== 'function') {
    fail('invalid-options', 'deferNotifications must be a function', { field: 'deferNotifications' });
  }
  const alertEngine = options.alertEngine ?? null;
  if (alertEngine !== null && (!isObject(alertEngine) ||
      ['list', 'backendUpdate', 'backendPause', 'getPendingBackendDefinitions', 'prepareUpdates', 'markSourceRemoved', 'markSourceAvailable'].some(method => typeof alertEngine[method] !== 'function'))) {
    fail('invalid-alert-engine', 'alertEngine must provide alert reconciliation and source availability methods');
  }
  const drawingChartId = options.drawingChartId === undefined
    ? null : requireString(options.drawingChartId, 'drawingChartId');
  let reconciling = false;

  let drawings = [];
  let groups = [];
  let selection = [];
  let styles = [];
  let favorites = new Set();
  let repeatMode = false;
  const undoStack = [];
  const redoStack = [];
  const listeners = new Set();
  let transaction = null;
  let dragPreview = new Map();
  const counters = { drawing: 0, group: 0, style: 0 };

  function normalizeContext(raw) {
    if (!isObject(raw)) fail('invalid-context', 'context must be an object', { field: 'context' });
    return {
      instrumentId: requireString(raw.instrumentId, 'context.instrumentId'),
      interval: requireString(raw.interval, 'context.interval'),
      sourceId: requireString(raw.sourceId, 'context.sourceId'),
      view: raw.view === undefined ? 'source' : requireString(raw.view, 'context.view'),
    };
  }

  function binding(paneId, scaleId) {
    return { paneId, scaleId };
  }

  function checkBinding(paneId, scaleId) {
    if (typeof adapter.hasBinding === 'function' && adapter.hasBinding({ paneId, scaleId }) !== true) {
      fail('incompatible-binding', `Pane ${paneId} or scale ${scaleId} is not available on this chart`, { field: 'paneId' });
    }
  }

  function hasAnyId(id) {
    return drawings.some(drawing => drawing.id === id)
      || groups.some(group => group.id === id)
      || styles.some(style => style.id === id);
  }

  function nextId(kind) {
    for (;;) {
      counters[kind] += 1;
      const id = `${kind}-${counters[kind]}`;
      if (!hasAnyId(id)) return id;
    }
  }

  function groupById(id) {
    return groups.find(group => group.id === id) ?? null;
  }

  function groupAncestors(groupId) {
    const result = [];
    const seen = new Set();
    let current = groupId === null ? null : groupById(groupId);
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      result.push(current);
      current = current.parentId === null ? null : groupById(current.parentId);
    }
    return result;
  }

  function descendantGroupIds(groupId) {
    const result = new Set([groupId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const group of groups) {
        if (group.parentId !== null && result.has(group.parentId) && !result.has(group.id)) {
          result.add(group.id);
          changed = true;
        }
      }
    }
    return result;
  }

  function drawingsInGroups(groupIds) {
    return drawings.filter(drawing => drawing.groupId !== null && groupIds.has(drawing.groupId));
  }

  function effectiveVisible(drawing) {
    if (!drawing.visible) return false;
    if (drawing.groupId === null) return true;
    return groupAncestors(drawing.groupId).every(group => group.visible);
  }

  function effectiveLocked(drawing) {
    if (drawing.locked) return true;
    if (drawing.groupId === null) return false;
    return groupAncestors(drawing.groupId).some(group => group.locked);
  }

  function requireDrawing(id) {
    const drawing = drawings.find(item => item.id === id);
    if (!drawing) fail('unknown-drawing', `Unknown drawing: ${String(id)}`, { id });
    return drawing;
  }

  function requireGroup(id) {
    const group = groupById(id);
    if (!group) fail('unknown-group', `Unknown group: ${String(id)}`, { id });
    return group;
  }

  function assertGroupExists(groupId) {
    if (groupId !== null && !groupById(groupId)) {
      fail('incompatible-group', `Unknown group: ${groupId}`, { field: 'groupId', id: groupId });
    }
  }

  function normalizeDrawing(raw, { id = null, type = null } = {}) {
    if (!isObject(raw)) fail('invalid-drawing', 'drawing must be an object');
    const drawingType = type ?? raw.type;
    const spec = DRAWING_TOOLS[drawingType];
    if (!spec) fail('unknown-type', `Unknown drawing type: ${String(drawingType)}`, { field: 'type' });
    const drawingId = id ?? (raw.id === undefined ? null : requireString(raw.id, 'id', { max: 128 }));
    if (drawingId !== null) requireString(drawingId, 'id', { max: 128 });
    const paneId = requireString(raw.paneId, 'paneId', { max: 128 });
    const scaleId = requireString(raw.scaleId, 'scaleId', { max: 128 });
    checkBinding(paneId, scaleId);
    if (!Array.isArray(raw.anchors)) fail('invalid-anchors', 'anchors must be an array', { field: 'anchors' });
    anchorCountCheck(drawingType, raw.anchors.length);
    const anchors = raw.anchors.map((anchor, index) => normalizeAnchor(anchor, spec.anchors, index));
    const style = completeStyle(spec.family, raw.style ?? {});
    const props = normalizeProps(drawingType, raw.props ?? {});
    const visible = raw.visible === undefined ? true : requireBoolean(raw.visible, 'visible');
    const locked = raw.locked === undefined ? false : requireBoolean(raw.locked, 'locked');
    let groupId = null;
    if (raw.groupId !== undefined && raw.groupId !== null) groupId = requireString(raw.groupId, 'groupId', { max: 128 });
    return { id: drawingId, type: drawingType, paneId, scaleId, anchors, style, props, visible, locked, groupId };
  }

  function prepareDrawing(raw, options = {}) {
    const drawing = normalizeDrawing(raw, options);
    assertGroupExists(drawing.groupId);
    validateDrawingGeometry(drawing, adapter);
    return drawing;
  }

  function capture() {
    return { drawings: clone(drawings), groups: clone(groups), selection: [...selection] };
  }

  function restore(snapshot) {
    drawings = snapshot.drawings;
    groups = snapshot.groups;
    selection = [...snapshot.selection];
  }

  function pushUndo(snapshot) {
    redoStack.length = 0;
    if (historyLimit === 0) return;
    undoStack.push(snapshot);
    while (undoStack.length > historyLimit) undoStack.shift();
  }

  function emit(type, ids = []) {
    if (!listeners.size) return;
    const event = { type, ids: [...ids] };
    const deliver = () => { for (const listener of [...listeners]) listener(event); };
    if (options.deferNotifications?.(deliver) === true) return;
    deliver();
  }
  function drawingSource(source, drawing) {
    const expectedType = drawing.type === 'horizontalLevel' ? 'horizontal' : drawing.type;
    if (source.drawingType !== expectedType || !['horizontal', 'segment', 'ray'].includes(expectedType)) {
      fail('alert-drawing-mismatch', `Drawing ${drawing.id} does not match its alert source`, { drawingId: drawing.id });
    }
    return expectedType === 'horizontal'
      ? { ...source, price: drawing.anchors[0].price }
      : { ...source, points: clone(drawing.anchors) };
  }

  function reconcileDrawings(before, after) {
    if (!alertEngine) return;
    const oldById = new Map(before.map(drawing => [drawing.id, drawing]));
    const newById = new Map(after.map(drawing => [drawing.id, drawing]));
    const changed = new Map();
    for (const [id, oldDrawing] of oldById) {
      const next = newById.get(id);
      if (!next || oldDrawing.type !== next.type || oldDrawing.paneId !== next.paneId ||
          oldDrawing.scaleId !== next.scaleId || !equal(oldDrawing.anchors, next.anchors)) {
        changed.set(id, { oldDrawing, next });
      }
    }
    for (const [id, next] of newById) {
      if (!oldById.has(id)) changed.set(id, { oldDrawing: null, next });
    }
    if (!changed.size) return;
    const matches = source => source?.kind === 'drawing' && changed.has(source.drawingId) &&
      !(drawingChartId !== null && source.chartId !== null && source.chartId !== drawingChartId);
    function assertNoPending() {
      for (const definition of alertEngine.getPendingBackendDefinitions()) {
        if (matches(definition.left) || matches(definition.right)) {
          fail('alert-reconciliation-required', `Backend alert ${definition.id} has a pending or unknown mutation`, { alertId: definition.id });
        }
      }
    }
    assertNoPending();

    // Plan every dependent alert before sending any request. One definition may
    // refer to more than one changed drawing, but needs only one new revision.
    const operations = [];
    for (const record of alertEngine.list()) {
      if (record.definition.authority !== 'backend') continue;
      const patch = {};
      let deleting = false;
      let affected = false;
      for (const side of ['left', 'right']) {
        const source = record.definition[side];
        if (!matches(source)) continue;
        affected = true;
        const { oldDrawing, next } = changed.get(source.drawingId);
        if (!next) { deleting = true; continue; }
        if (oldDrawing && (oldDrawing.paneId !== next.paneId || oldDrawing.scaleId !== next.scaleId)) {
          fail('alert-drawing-mismatch', `Drawing ${source.drawingId} cannot change its chart binding while referenced`, {
            alertId: record.id, drawingId: source.drawingId
          });
        }
        const previous = oldDrawing ? drawingSource(source, oldDrawing) : null;
        const proposed = drawingSource(source, next);
        if (previous && !equal(source, previous) && !equal(source, proposed)) {
          fail('alert-drawing-mismatch', `Alert ${record.id} has different confirmed drawing geometry`, {
            alertId: record.id, drawingId: source.drawingId
          });
        }
        if (!equal(source, proposed)) patch[side] = proposed;
      }
      if (!affected) continue;
      if (record.backend.syncState !== 'confirmed' ||
          record.backend.confirmedRevision !== record.definition.revision) {
        fail('alert-reconciliation-required', `Read and reconcile backend alert ${record.id} before changing its drawing`, { alertId: record.id });
      }
      if (deleting) {
        if (record.backend.confirmedStatus !== 'paused') operations.push({ record, type: 'pause' });
      } else if (Object.keys(patch).length) {
        operations.push({ record, type: 'update', patch });
      }
    }
    const localUpdates = [];
    const removed = new Map();
    const restored = new Map();
    for (const record of alertEngine.list()) {
      if (record.definition.authority !== 'local') continue;
      const patch = {};
      for (const side of ['left', 'right']) {
        const source = record.definition[side];
        if (!matches(source)) continue;
        const { oldDrawing, next } = changed.get(source.drawingId);
        const chartId = source.chartId ?? drawingChartId;
        const ref = { kind: 'drawing', drawingId: source.drawingId, ...(chartId === null ? {} : { chartId }) };
        const key = JSON.stringify(ref);
        if (!next) {
          removed.set(key, ref);
          continue;
        }
        const proposed = drawingSource(source, next);
        if (!oldDrawing) {
          if (equal(source, proposed)) restored.set(key, ref);
          continue;
        }
        if (oldDrawing.paneId !== next.paneId || oldDrawing.scaleId !== next.scaleId) {
          fail('alert-drawing-mismatch', `Drawing ${source.drawingId} cannot change its chart binding while referenced`, {
            alertId: record.id, drawingId: source.drawingId
          });
        }
        if (!equal(source, drawingSource(source, oldDrawing))) {
          fail('alert-drawing-mismatch', `Alert ${record.id} has different drawing geometry`, {
            alertId: record.id, drawingId: source.drawingId
          });
        }
        if (!equal(source, proposed)) patch[side] = proposed;
      }
      if (Object.keys(patch).length) localUpdates.push({ id: record.id, patch, expectedRevision: record.definition.revision });
    }
    const prepared = alertEngine.prepareUpdates(localUpdates);
    for (const operation of operations) {
      const { record } = operation;
      let result;
      try {
        result = operation.type === 'pause'
          ? alertEngine.backendPause(record.id, record.definition.revision)
          : alertEngine.backendUpdate(record.id, operation.patch, record.definition.revision);
      } catch (error) {
        fail('alert-reconciliation-failed', `Backend alert ${record.id} rejected the drawing change: ${error.message}`, {
          alertId: record.id, cause: error
        });
      }
      if (result?.outcome !== 'confirmed' ||
          (operation.type === 'pause' && result.status !== 'paused')) {
        fail('alert-reconciliation-unknown', `Backend alert ${record.id} did not confirm the drawing change; reconcile it before retrying`, {
          alertId: record.id, outcome: result?.outcome ?? 'unknown'
        });
      }
    }
    // Adapter callbacks and alert subscribers can change the dependency set
    // while requests are being processed. Never commit against a stale plan.
    assertNoPending();
    for (const record of alertEngine.list()) {
      if (record.definition.authority !== 'backend') continue;
      const sources = [record.definition.left, record.definition.right].filter(matches);
      if (!sources.length) continue;
      const deleted = sources.some(source => !changed.get(source.drawingId).next);
      if (record.backend.syncState !== 'confirmed' || record.backend.confirmedRevision !== record.definition.revision ||
          (deleted ? record.backend.confirmedStatus !== 'paused'
            : sources.some(source => !equal(source, drawingSource(source, changed.get(source.drawingId).next))))) {
        fail('alert-reconciliation-required', `Backend alert ${record.id} changed during drawing reconciliation`, { alertId: record.id });
      }
    }
    return () => {
      prepared.commit();
      for (const ref of removed.values()) alertEngine.markSourceRemoved(ref, 'drawing-removed');
      for (const ref of restored.values()) alertEngine.markSourceAvailable(ref);
    };
  }

  function transition(before, after) {
    if (reconciling) fail('alert-reconciliation-active', 'A drawing change is already being reconciled');
    reconciling = true;
    try {
      const finalize = reconcileDrawings(before.drawings, after.drawings);
      restore(after);
      try { finalize?.(); } catch (error) { restore(before); throw error; }
    } finally {
      reconciling = false;
    }
  }

  function assertNotReconciling() {
    if (reconciling) fail('alert-reconciliation-active', 'A drawing change is already being reconciled');
  }


  function command(type, ids, mutate) {
    assertNotReconciling();
    const before = capture();
    let after;
    try {
      mutate();
      after = capture();
    } finally {
      restore(before);
    }
    transition(before, after);
    if (transaction) {
      for (const id of ids) transaction.changed.add(id);
      return;
    }
    pushUndo(before);
    emit(type, ids);
  }

  function add(raw) {
    const drawing = prepareDrawing(raw);
    if (drawing.id !== null && hasAnyId(drawing.id)) fail('duplicate-id', `Drawing id already exists: ${drawing.id}`, { id: drawing.id });
    drawing.id = drawing.id ?? nextId('drawing');
    command('add', [drawing.id], () => {
      drawings.push(drawing);
    });
    return clone(drawing);
  }

  function get(id) {
    return clone(requireDrawing(id));
  }

  function list() {
    return clone(drawings);
  }

  function lockedPatchAllowed(drawing, patch) {
    const keys = Object.keys(patch);
    const flagsOnly = keys.every(key => key === 'visible' || key === 'locked');
    if (flagsOnly) return;
    if (drawing.groupId !== null && groupAncestors(drawing.groupId).some(group => group.locked)) {
      fail('locked', `Drawing ${drawing.id} is locked by a group and cannot be changed`, { blockers: [drawing.id] });
    }
    if (drawing.locked) {
      fail('locked', `Drawing ${drawing.id} is locked and cannot be changed`, { blockers: [drawing.id] });
    }
  }

  function buildUpdateCandidate(current, patch) {
    if (!isObject(patch)) fail('invalid-patch', 'patch must be an object', { field: 'patch' });
    const allowed = ['anchors', 'style', 'props', 'visible', 'locked', 'paneId', 'scaleId', 'groupId'];
    for (const key of Object.keys(patch)) {
      if (!allowed.includes(key)) fail('invalid-patch', `Unknown drawing property: ${key}`, { field: key });
    }
    const candidate = clone(current);
    if ('anchors' in patch) {
      if (!Array.isArray(patch.anchors)) fail('invalid-anchors', 'anchors must be an array', { field: 'anchors' });
      candidate.anchors = clone(patch.anchors);
    }
    if ('style' in patch) {
      if (!isObject(patch.style)) fail('invalid-style', 'style must be an object', { field: 'style' });
      candidate.style = { ...candidate.style, ...clone(patch.style) };
    }
    if ('props' in patch) {
      if (!isObject(patch.props)) fail('invalid-props', 'props must be an object', { field: 'props' });
      candidate.props = { ...candidate.props, ...clone(patch.props) };
    }
    for (const key of ['visible', 'locked', 'paneId', 'scaleId', 'groupId']) {
      if (key in patch) candidate[key] = patch[key];
    }
    return candidate;
  }

  function update(id, patch) {
    const current = requireDrawing(id);
    lockedPatchAllowed(current, patch);
    const candidate = prepareDrawing(buildUpdateCandidate(current, patch), { id: current.id, type: current.type });
    if (equal(current, candidate)) return clone(candidate);
    command('update', [id], () => {
      const index = drawings.findIndex(item => item.id === id);
      drawings[index] = candidate;
      selection = selection.filter(selectedId => {
        const drawing = drawings.find(item => item.id === selectedId);
        return drawing ? effectiveVisible(drawing) : false;
      });
    });
    return clone(candidate);
  }

  function blockerIds(ids) {
    return ids.filter(id => effectiveLocked(requireDrawing(id)));
  }

  function assertUnblocked(ids, operation) {
    const blockers = blockerIds(ids);
    if (blockers.length) {
      fail('locked', `Blocked drawings prevent ${operation}`, { blockers, operation });
    }
  }

  function remove(id) {
    const drawing = requireDrawing(id);
    assertUnblocked([id], 'deletion');
    command('delete', [id], () => {
      drawings = drawings.filter(item => item.id !== id);
      selection = selection.filter(item => item !== id);
    });
    return clone(drawing);
  }

  function removeSelected() {
    const ids = [...selection];
    if (!ids.length) return false;
    assertUnblocked(ids, 'mass deletion');
    command('delete', ids, () => {
      drawings = drawings.filter(item => !ids.includes(item.id));
      selection = [];
    });
    return true;
  }

  function clearAll() {
    const blockers = [
      ...drawings.filter(effectiveLocked).map(drawing => drawing.id),
      ...groups.filter(group => group.locked).map(group => group.id),
    ];
    if (blockers.length) fail('locked', 'Blocked objects prevent clearing all drawings', { blockers });
    if (!drawings.length && !groups.length && !selection.length) return false;
    command('clear', drawings.map(drawing => drawing.id), () => {
      drawings = [];
      groups = [];
      selection = [];
    });
    return true;
  }

  const clear = clearAll;

  function undo() {
    assertNotReconciling();
    if (transaction) fail('transaction-active', 'Cannot undo while a drag transaction is open');
    if (!undoStack.length) return false;
    const current = capture();
    const previous = undoStack[undoStack.length - 1];
    transition(current, clone(previous));
    undoStack.pop();
    redoStack.push(current);
    emit('undo', []);
    return true;
  }

  function redo() {
    assertNotReconciling();
    if (transaction) fail('transaction-active', 'Cannot redo while a drag transaction is open');
    if (!redoStack.length) return false;
    const current = capture();
    const next = redoStack[redoStack.length - 1];
    transition(current, clone(next));
    redoStack.pop();
    undoStack.push(current);
    while (undoStack.length > Math.max(1, historyLimit)) undoStack.shift();
    emit('redo', []);
    return true;
  }

  function canUndo() {
    return undoStack.length > 0;
  }

  function canRedo() {
    return redoStack.length > 0;
  }

  function beginTransaction() {
    assertNotReconciling();
    if (transaction) fail('transaction-active', 'A drag transaction is already open');
    transaction = { before: capture(), changed: new Set() };
    return true;
  }

  function endTransaction() {
    assertNotReconciling();
    if (!transaction) fail('no-transaction', 'No drag transaction is open');
    const { before, changed } = transaction;
    transaction = null;
    const hasChanges = !equal(before.drawings, drawings) || !equal(before.groups, groups) || !equal(before.selection, selection);
    if (hasChanges) {
      pushUndo(before);
      emit('commit', [...changed]);
    }
    return hasChanges;
  }

  function cancelTransaction() {
    assertNotReconciling();
    if (!transaction) fail('no-transaction', 'No drag transaction is open');
    const before = transaction.before;
    transition(capture(), clone(before));
    transaction = null;
    emit('cancel', []);
    return true;
  }

  function setSelection(ids) {
    const next = [...new Set(ids)];
    if (equal(selection, next)) return [...selection];
    selection = next;
    emit('selection', selection);
    return [...selection];
  }

  function expandTargets(target, { groupVisibleOnly = false } = {}) {
    const rawIds = Array.isArray(target) ? target : [target];
    const ids = [];
    for (const id of rawIds) {
      if (typeof id !== 'string' || id === '') fail('invalid-target', 'selection target must be a non-empty id', { id });
      if (groupById(id)) {
        const subtree = descendantGroupIds(id);
        for (const drawing of drawingsInGroups(subtree)) {
          if (!groupVisibleOnly || effectiveVisible(drawing)) ids.push(drawing.id);
        }
      } else {
        requireDrawing(id);
        ids.push(id);
      }
    }
    return [...new Set(ids)];
  }

  function assertSelectable(ids) {
    for (const id of ids) {
      if (!effectiveVisible(requireDrawing(id))) fail('hidden', `Drawing ${id} is hidden and cannot be selected`, { id });
    }
  }

  function select(id) {
    if (id === null) return setSelection([]);
    const ids = expandTargets(id, { groupVisibleOnly: true });
    assertSelectable(ids);
    return setSelection(ids);
  }

  function selectMany(ids) {
    if (!Array.isArray(ids)) fail('invalid-target', 'selectMany expects an array of ids', { field: 'ids' });
    const expanded = expandTargets(ids, { groupVisibleOnly: true });
    assertSelectable(expanded);
    return setSelection(expanded);
  }

  function getSelection() {
    return [...selection];
  }

  function selectedByZ() {
    const set = new Set(selection);
    return clone(drawings.filter(drawing => set.has(drawing.id)));
  }

  function reorder(mode) {
    if (!selection.length) return false;
    const selected = new Set(selection);
    let next;
    if (mode === 'front') {
      next = [...drawings.filter(drawing => !selected.has(drawing.id)), ...drawings.filter(drawing => selected.has(drawing.id))];
    } else if (mode === 'back') {
      next = [...drawings.filter(drawing => selected.has(drawing.id)), ...drawings.filter(drawing => !selected.has(drawing.id))];
    } else if (mode === 'forward') {
      next = drawings.slice();
      for (let i = next.length - 2; i >= 0; i -= 1) {
        if (selected.has(next[i].id) && !selected.has(next[i + 1].id)) {
          [next[i], next[i + 1]] = [next[i + 1], next[i]];
        }
      }
    } else {
      next = drawings.slice();
      for (let i = 1; i < next.length; i += 1) {
        if (selected.has(next[i].id) && !selected.has(next[i - 1].id)) {
          [next[i], next[i - 1]] = [next[i - 1], next[i]];
        }
      }
    }
    if (equal(next.map(drawing => drawing.id), drawings.map(drawing => drawing.id))) return false;
    command('order', selection, () => {
      drawings = next;
    });
    return true;
  }

  function setOrder(ids) {
    if (!Array.isArray(ids)) fail('invalid-order', 'setOrder expects an array of drawing ids', { field: 'ids' });
    if (ids.length !== drawings.length) {
      fail('invalid-order', 'setOrder must list every drawing exactly once', {
        field: 'ids',
        expected: drawings.length,
        actual: ids.length,
      });
    }
    const byId = new Map(drawings.map(drawing => [drawing.id, drawing]));
    const ordered = [];
    const seen = new Set();
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') {
        fail('invalid-order', 'Ordering ids must be non-empty strings', { field: 'ids' });
      }
      if (seen.has(id)) fail('invalid-order', `Duplicate drawing id in order: ${id}`, { field: 'ids', id });
      const drawing = byId.get(id);
      if (!drawing) fail('invalid-order', `Unknown drawing id in order: ${id}`, { field: 'ids', id });
      seen.add(id);
      ordered.push(drawing);
    }
    if (equal(ids, drawings.map(drawing => drawing.id))) return false;
    command('order', ids, () => {
      drawings = ordered;
    });
    return true;
  }

  function renameGroup(groupId, name) {
    const group = requireGroup(groupId);
    const next = requireString(name, 'group.name', { max: 200 });
    const blockers = groupLockBlockers(group);
    if (blockers.length) fail('locked', `Group ${groupId} cannot be renamed while locked`, { blockers });
    if (group.name === next) return false;
    command('group-rename', [groupId], () => {
      group.name = next;
    });
    return true;
  }

  function groupLockBlockers(group, { includeSelf = true } = {}) {
    const blockers = [];
    if (includeSelf && group.locked) blockers.push(group.id);
    for (const ancestor of groupAncestors(group.parentId)) {
      if (ancestor.locked && !blockers.includes(ancestor.id)) blockers.push(ancestor.id);
    }
    return blockers;
  }

  function assertGroupsUnlocked(groupsToCheck) {
    const blockers = [];
    for (const group of groupsToCheck) {
      for (const id of groupLockBlockers(group)) if (!blockers.includes(id)) blockers.push(id);
    }
    if (blockers.length) fail('locked', 'Locked groups prevent this group operation', { blockers });
  }

  function setVisibility(target, visible) {
    requireBoolean(visible, 'visible');
    const ids = Array.isArray(target) ? [...target] : [target];
    if (ids.length === 0) return false;
    const drawingIds = [];
    const groupIds = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') fail('invalid-target', 'target must be a non-empty id', { id });
      if (groupById(id)) groupIds.push(id);
      else {
        requireDrawing(id);
        drawingIds.push(id);
      }
    }
    const changed = drawingIds.some(id => requireDrawing(id).visible !== visible)
      || groupIds.some(id => requireGroup(id).visible !== visible);
    if (!changed) return false;
    command('visibility', [...drawingIds, ...groupIds], () => {
      for (const id of drawingIds) requireDrawing(id).visible = visible;
      for (const id of groupIds) requireGroup(id).visible = visible;
      selection = selection.filter(id => {
        const drawing = drawings.find(item => item.id === id);
        return drawing ? effectiveVisible(drawing) : false;
      });
    });
    return true;
  }

  function setLocked(target, locked) {
    requireBoolean(locked, 'locked');
    const ids = Array.isArray(target) ? [...target] : [target];
    if (ids.length === 0) return false;
    const drawingIds = [];
    const groupIds = [];
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') fail('invalid-target', 'target must be a non-empty id', { id });
      if (groupById(id)) groupIds.push(id);
      else {
        requireDrawing(id);
        drawingIds.push(id);
      }
    }
    const changed = drawingIds.some(id => requireDrawing(id).locked !== locked)
      || groupIds.some(id => requireGroup(id).locked !== locked);
    if (!changed) return false;
    command('lock', [...drawingIds, ...groupIds], () => {
      for (const id of drawingIds) requireDrawing(id).locked = locked;
      for (const id of groupIds) requireGroup(id).locked = locked;
    });
    return true;
  }

  function createGroup(input) {
    const raw = typeof input === 'string' ? { name: input } : input;
    if (!isObject(raw)) fail('invalid-group', 'group must be an object or a name');
    const name = requireString(raw.name, 'group.name', { max: 200 });
    let parentId = null;
    if (raw.parentId !== undefined && raw.parentId !== null) parentId = requireString(raw.parentId, 'group.parentId', { max: 128 });
    if (parentId !== null) assertGroupsUnlocked([requireGroup(parentId)]);
    const group = { id: nextId('group'), name, parentId, visible: true, locked: false };
    if (raw.visible !== undefined) group.visible = requireBoolean(raw.visible, 'group.visible');
    if (raw.locked !== undefined) group.locked = requireBoolean(raw.locked, 'group.locked');
    command('group-create', [group.id], () => {
      groups.push(group);
    });
    return clone(group);
  }

  function setGroupParent(groupId, parentId) {
    const group = requireGroup(groupId);
    let parent = null;
    if (parentId !== null) {
      requireString(parentId, 'parentId', { max: 128 });
      parent = requireGroup(parentId);
      if (parentId === groupId) fail('group-cycle', 'A group cannot be its own parent', { id: groupId });
      const ancestors = groupAncestors(parentId);
      if (ancestors.some(item => item.id === groupId)) fail('group-cycle', 'Group nesting would create a cycle', { id: groupId });
    }
    assertGroupsUnlocked([group]);
    if (parent) assertGroupsUnlocked([parent]);
    if (group.parentId === parentId) return false;
    command('group-parent', [groupId], () => {
      group.parentId = parentId;
    });
    return true;
  }

  function addToGroup(groupId, target) {
    const group = requireGroup(groupId);
    const ids = Array.isArray(target) ? [...target] : [target];
    if (!ids.length) return false;
    const drawingTargets = [];
    const groupTargets = [];
    for (const id of ids) {
      if (groupById(id)) {
        if (id === groupId) fail('group-cycle', 'A group cannot contain itself', { id });
        const ancestors = groupAncestors(groupId);
        if (ancestors.some(item => item.id === id)) fail('group-cycle', 'Group nesting would create a cycle', { id });
        groupTargets.push(id);
      } else {
        requireDrawing(id);
        drawingTargets.push(id);
      }
    }
    assertGroupsUnlocked([group, ...groupTargets.map(id => requireGroup(id))]);
    const drawingBlockers = drawingTargets.filter(id => effectiveLocked(requireDrawing(id)));
    if (drawingBlockers.length) fail('locked', 'Locked drawings cannot be moved between groups', { blockers: drawingBlockers });
    const changed = drawingTargets.some(id => requireDrawing(id).groupId !== groupId)
      || groupTargets.some(id => requireGroup(id).parentId !== groupId);
    if (!changed) return false;
    command('group-membership', [...drawingTargets, ...groupTargets], () => {
      for (const id of drawingTargets) requireDrawing(id).groupId = groupId;
      for (const id of groupTargets) requireGroup(id).parentId = groupId;
    });
    return true;
  }

  function removeFromGroup(target) {
    const ids = Array.isArray(target) ? [...target] : [target];
    const drawingTargets = [];
    const groupTargets = [];
    for (const id of ids) {
      if (groupById(id)) groupTargets.push(id);
      else {
        requireDrawing(id);
        drawingTargets.push(id);
      }
    }
    if (!drawingTargets.length && !groupTargets.length) return false;
    assertGroupsUnlocked(groupTargets.map(id => requireGroup(id)));
    const drawingBlockers = drawingTargets.filter(id => effectiveLocked(requireDrawing(id)));
    if (drawingBlockers.length) fail('locked', 'Locked drawings cannot be removed from a group', { blockers: drawingBlockers });
    const changed = drawingTargets.some(id => requireDrawing(id).groupId !== null)
      || groupTargets.some(id => requireGroup(id).parentId !== null);
    if (!changed) return false;
    command('group-membership', [...drawingTargets, ...groupTargets], () => {
      for (const id of drawingTargets) requireDrawing(id).groupId = null;
      for (const id of groupTargets) requireGroup(id).parentId = null;
    });
    return true;
  }

  function getGroup(id) {
    return clone(requireGroup(id));
  }

  function listGroups() {
    return clone(groups);
  }

  function getGroupMembers(groupId, options = {}) {
    requireGroup(groupId);
    const recursive = options.recursive !== false;
    const ids = recursive ? descendantGroupIds(groupId) : new Set([groupId]);
    return clone(drawingsInGroups(ids));
  }

  function ungroup(groupId) {
    const group = requireGroup(groupId);
    const parentId = group.parentId;
    const subtree = descendantGroupIds(groupId);
    const blockers = [...groupLockBlockers(group)];
    for (const id of subtree) {
      const child = groupById(id);
      if (child && child.locked && !blockers.includes(child.id)) blockers.push(child.id);
    }
    for (const drawing of drawingsInGroups(subtree)) {
      if (effectiveLocked(drawing) && !blockers.includes(drawing.id)) blockers.push(drawing.id);
    }
    if (blockers.length) fail('locked', `Group ${groupId} cannot be ungrouped while locked`, { blockers });
    command('ungroup', [groupId], () => {
      for (const drawing of drawings) if (drawing.groupId === groupId) drawing.groupId = parentId;
      for (const child of groups) if (child.parentId === groupId) child.parentId = parentId;
      groups = groups.filter(item => item.id !== groupId);
    });
    return true;
  }

  function removeGroup(groupId, options = {}) {
    const group = requireGroup(groupId);
    if (options.confirm !== true) fail('confirmation-required', 'Deleting a group requires explicit confirmation', { id: groupId });
    const subtree = descendantGroupIds(groupId);
    const blockers = [
      ...groupLockBlockers(group),
      ...groups.filter(item => subtree.has(item.id) && item.locked).map(item => item.id),
      ...drawingsInGroups(subtree).filter(effectiveLocked).map(drawing => drawing.id),
    ].filter((id, index, list) => list.indexOf(id) === index);
    if (blockers.length) fail('locked', 'Blocked objects prevent group deletion', { blockers });
    command('group-delete', [...subtree], () => {
      drawings = drawings.filter(drawing => drawing.groupId === null || !subtree.has(drawing.groupId));
      groups = groups.filter(group => !subtree.has(group.id));
      selection = selection.filter(id => drawings.some(drawing => drawing.id === id));
    });
    return true;
  }

  function saveStyle(input) {
    if (!isObject(input)) fail('invalid-style', 'style definition must be an object');
    const type = input.type;
    const spec = DRAWING_TOOLS[type];
    if (!spec) fail('unknown-type', `Unknown drawing type: ${String(type)}`, { field: 'type' });
    const name = requireString(input.name, 'style.name', { max: 200 });
    const style = completeStyle(spec.family, input.style ?? {});
    const saved = { id: nextId('style'), name, type, style };
    styles.push(saved);
    emit('style-save', [saved.id]);
    return clone(saved);
  }

  function listStyles(type) {
    const source = type === undefined ? styles : styles.filter(style => style.type === type);
    return clone(source);
  }

  function resolveStyleFor(ids, styleOrId) {
    let saved = null;
    if (typeof styleOrId === 'string') {
      saved = styles.find(style => style.id === styleOrId);
      if (!saved) fail('unknown-style', `Unknown saved style: ${styleOrId}`, { id: styleOrId });
      for (const id of ids) {
        if (requireDrawing(id).type !== saved.type) {
          fail('incompatible-style', `Style ${saved.id} is not compatible with drawing ${id}`, { id, styleId: saved.id });
        }
      }
      return { saved: true, style: saved.style };
    }
    if (!isObject(styleOrId)) fail('invalid-style', 'style must be an object or a saved style id');
    for (const id of ids) {
      const drawing = requireDrawing(id);
      validateStyle(DRAWING_TOOLS[drawing.type].family, styleOrId);
    }
    return { saved: false, style: styleOrId };
  }

  function applyStyle(target, styleOrId) {
    const ids = expandTargets(target);
    if (!ids.length) return false;
    assertUnblocked(ids, 'style changes');
    const resolved = resolveStyleFor(ids, styleOrId);
    command('style', ids, () => {
      for (const id of ids) {
        const drawing = requireDrawing(id);
        drawing.style = resolved.saved
          ? clone(resolved.style)
          : completeStyle(DRAWING_TOOLS[drawing.type].family, { ...drawing.style, ...clone(resolved.style) });
      }
    });
    return true;
  }

  function updateBatch(updates) {
    if (!Array.isArray(updates)) fail('invalid-patch', 'updates must be an array', { field: 'updates' });
    const ids = updates.map((entry, index) => {
      if (!isObject(entry)) fail('invalid-patch', 'each update must be an object', { field: `updates.${index}` });
      return requireString(entry.id, `updates.${index}.id`);
    });
    if (new Set(ids).size !== ids.length) fail('invalid-patch', 'drawing IDs must be unique', { field: 'updates' });
    if (!ids.length) return false;
    const currentById = new Map(drawings.map(drawing => [drawing.id, drawing]));
    for (const id of ids) if (!currentById.has(id)) fail('unknown-drawing', `Unknown drawing: ${id}`, { id });
    const blockers = ids.filter(id => effectiveLocked(currentById.get(id)));
    if (blockers.length) fail('locked', 'Locked drawings prevent geometry or property changes', { blockers, operation: 'geometry or property changes' });
    const candidates = updates.map(({ id, patch }) => {
      const current = currentById.get(id);
      return prepareDrawing(buildUpdateCandidate(current, patch), { id, type: current.type });
    });
    const changed = candidates.filter((candidate, index) => !equal(currentById.get(ids[index]), candidate));
    if (!changed.length) return false;
    command('update', changed.map(candidate => candidate.id), () => {
      const byId = new Map(changed.map(candidate => [candidate.id, candidate]));
      drawings = drawings.map(drawing => {
        const next = byId.get(drawing.id) ?? drawing;
        currentById.set(next.id, next);
        return next;
      });
      selection = selection.filter(id => {
        const drawing = currentById.get(id);
        return drawing ? effectiveVisible(drawing) : false;
      });
    });
    return true;
  }

  function updateMany(target, patch) {
    return updateBatch(expandTargets(target).map(id => ({ id, patch })));
  }

  function setFavorite(type, enabled = true) {
    if (!DRAWING_TOOLS[type]) fail('unknown-type', `Unknown drawing type: ${String(type)}`, { field: 'type' });
    requireBoolean(enabled, 'enabled');
    if (enabled) favorites.add(type);
    else favorites.delete(type);
    emit('favorite', [type]);
    return enabled;
  }

  function isFavorite(type) {
    return favorites.has(type);
  }

  function listFavorites() {
    return [...favorites];
  }

  function setRepeatMode(enabled) {
    repeatMode = requireBoolean(enabled, 'enabled');
    emit('repeat-mode', []);
    return repeatMode;
  }

  function getRepeatMode() {
    return repeatMode;
  }

  function roundToStep(price, step) {
    const quotient = price / step;
    const rounded = Math.sign(quotient) * Math.round(Math.abs(quotient));
    return normalizeZero(rounded * step);
  }

  function snapPrice(price, options = {}) {
    if (isObject(price)) {
      options = price;
      price = options.price;
    }
    if (!isNumber(price)) fail('invalid-price', 'price must be a finite number', { field: 'price' });
    const mode = options.mode ?? 'free';
    if (!['free', 'weak', 'strong'].includes(mode)) fail('invalid-snap-mode', 'mode must be free, weak or strong', { field: 'mode' });
    const threshold = options.threshold === undefined ? 0 : options.threshold;
    if (!isNumber(threshold) || threshold < 0) fail('invalid-threshold', 'threshold must be a finite non-negative number', { field: 'threshold' });
    const rounding = options.rounding === true;
    const step = options.step;
    if (rounding && (!isNumber(step) || step <= 0)) {
      fail('invalid-step', 'Rounding requires an explicitly provided positive finite step', { field: 'step' });
    }
    if (step !== undefined && (!isNumber(step) || step <= 0)) fail('invalid-step', 'step must be a positive finite number', { field: 'step' });

    let snapped = false;
    let result = price;
    let reason = null;
    if (mode !== 'free') {
      const paneId = options.paneId;
      const scaleId = options.scaleId;
      const targetY = adapter.priceToY(price, binding(paneId, scaleId));
      if (!isNumber(targetY)) {
        reason = 'scale-unavailable';
      } else {
        let best = null;
        for (const candidate of options.candidates ?? []) {
          const values = isNumber(candidate)
            ? [{ price: candidate }]
            : isObject(candidate)
              ? ['open', 'high', 'low', 'close', 'value'].filter(field => isNumber(candidate[field])).map(field => ({ price: candidate[field] }))
              : [];
          for (const value of values) {
            const y = adapter.priceToY(value.price, binding(paneId, scaleId));
            if (!isNumber(y)) continue;
            const distance = Math.abs(y - targetY);
            if (mode === 'weak' && distance > threshold) continue;
            if (best === null || distance < best.distance) best = { distance, price: value.price };
          }
        }
        if (best) {
          result = best.price;
          snapped = true;
        } else {
          reason = 'snap-unavailable';
        }
      }
    }
    if (rounding) {
      result = roundToStep(result, step);
    }
    return { price: result, snapped, mode, reason: snapped ? null : reason };
  }

  function snapX(logical, options = {}) {
    if (isObject(logical)) {
      options = logical;
      logical = options.logical ?? options.x;
    }
    if (!isNumber(logical)) fail('invalid-logical', 'logical must be a finite number', { field: 'logical' });
    // The x axis belongs to the pane: a derived pane counts its own elements.
    const xBinding = { paneId: options.paneId };
    const count = adapter.getIndexCount(xBinding);
    if (!Number.isInteger(count) || count <= 0) return null;
    const magnet = options.magnet === true;
    if (magnet) {
      const nearest = Math.min(count - 1, Math.max(0, Math.round(logical)));
      const threshold = options.threshold;
      if (!isNumber(threshold) || Math.abs(logical - nearest) <= threshold) {
        const slot = adapter.getSlot(nearest, xBinding);
        if (slot && typeof slot.barId === 'string') return { anchorBarId: slot.barId, offset: 0 };
        return null;
      }
    }
    const index = Math.min(count - 1, Math.max(0, Math.floor(logical)));
    const slot = adapter.getSlot(index, xBinding);
    if (!slot || typeof slot.barId !== 'string') return null;
    return { anchorBarId: slot.barId, offset: normalizeZero(logical - index) };
  }

  // Pending geometry of drawings being dragged (id -> patch). Never exported, never undoable, not notified: the
  // caller requests a render; the drag's commit is the one real update.
  function setDragPreview(updates) {
    dragPreview = new Map((updates ?? []).map(({ id, patch }) => [id, patch]));
  }

  function layout(target) {
    let drawing;
    if (typeof target === 'string') {
      drawing = requireDrawing(target);
      // A drag in progress shows the drawing at its pending position without touching the document or the undo stack.
      const pending = dragPreview.get(target);
      if (pending) drawing = normalizeDrawing({ ...drawing, ...pending });
    }
    else if (isObject(target)) {
      if (!DRAWING_TOOLS[target.type]) fail('unknown-type', `Unknown drawing type: ${String(target.type)}`, { field: 'type' });
      drawing = target;
    } else {
      fail('invalid-target', 'layout expects a drawing id or drawing');
    }
    const result = buildLayout(drawing, adapter);
    result.visible = effectiveVisible(drawing);
    result.locked = effectiveLocked(drawing);
    result.style = clone(drawing.style);
    result.props = clone(drawing.props);
    const order = drawings.findIndex(item => item.id === drawing.id);
    if (order >= 0) result.order = order;
    return result;
  }
  function previewLayout(raw) {
    return layout(normalizeDrawing(raw));
  }


  function getGeometry(id) {
    return layout(id);
  }

  function getMeasure(id) {
    const drawing = requireDrawing(id);
    const measured = buildLayout(drawing, adapter);
    if (measured.measure) return clone(measured.measure);
    const resolved = drawing.anchors.map(anchor => resolveAnchor(anchor, adapter, binding(drawing.paneId, drawing.scaleId)));
    if (resolved.length < 2) fail('not-measurable', `Drawing ${id} has fewer than two anchors`, { id });
    return clone(measureAnchors(resolved, adapter, binding(drawing.paneId, drawing.scaleId)));
  }

  function distanceToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
  }

  function pointInPolygon(px, py, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = points[i].x;
      const yi = points[i].y;
      const xj = points[j].x;
      const yj = points[j].y;
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function boundsIntersect(a, b) {
    return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
  }

  function primitiveHit(primitive, point, radius) {
    switch (primitive.kind) {
      case 'segment':
      case 'line':
      case 'ray':
        return distanceToSegment(point.x, point.y, primitive.x1, primitive.y1, primitive.x2, primitive.y2) <= radius;
      case 'polyline': {
        for (let i = 1; i < primitive.points.length; i += 1) {
          const previous = primitive.points[i - 1];
          const current = primitive.points[i];
          if (distanceToSegment(point.x, point.y, previous.x, previous.y, current.x, current.y) <= radius) return true;
        }
        return false;
      }
      case 'marker': {
        const effective = radius + (primitive.width ?? 0) / 2;
        for (let i = 1; i < primitive.points.length; i += 1) {
          const previous = primitive.points[i - 1];
          const current = primitive.points[i];
          if (distanceToSegment(point.x, point.y, previous.x, previous.y, current.x, current.y) <= effective) return true;
        }
        return primitive.points.some(item => Math.hypot(point.x - item.x, point.y - item.y) <= effective);
      }
      case 'bezier': {
        for (let i = 1; i < primitive.points.length; i += 1) {
          const previous = primitive.points[i - 1];
          const current = primitive.points[i];
          if (distanceToSegment(point.x, point.y, previous.x, previous.y, current.x, current.y) <= radius) return true;
        }
        return false;
      }
      case 'polygon': {
        const points = primitive.points;
        for (let i = 0; i < points.length; i += 1) {
          const current = points[i];
          const next = points[(i + 1) % points.length];
          if (distanceToSegment(point.x, point.y, current.x, current.y, next.x, next.y) <= radius) return true;
        }
        return pointInPolygon(point.x, point.y, points);
      }
      case 'ellipse': {
        const dx = (point.x - primitive.cx) / (primitive.rx || 1);
        const dy = (point.y - primitive.cy) / (primitive.ry || 1);
        const value = dx * dx + dy * dy;
        if (value <= 1) return true;
        return Math.abs(Math.sqrt(value) - 1) * Math.min(primitive.rx || 1, primitive.ry || 1) <= radius;
      }
      case 'circle':
        return Math.abs(Math.hypot(point.x - primitive.cx, point.y - primitive.cy) - primitive.r) <= radius;
      case 'arc': {
        const angle = Math.atan2(point.y - primitive.cy, point.x - primitive.cx);
        let delta = angle - primitive.startAngle;
        const sweep = primitive.endAngle - primitive.startAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const within = sweep >= 0 ? delta >= 0 && delta <= sweep : delta <= 0 && delta >= sweep;
        return within && Math.abs(Math.hypot(point.x - primitive.cx, point.y - primitive.cy) - primitive.r) <= radius;
      }
      case 'text': {
        const width = Math.max(4, String(primitive.text).length * 7);
        return point.x >= primitive.x - radius && point.x <= primitive.x + width + radius
          && point.y >= primitive.y - 12 - radius && point.y <= primitive.y + 4 + radius;
      }
      default:
        return false;
    }
  }

  function hitTest(point, options = {}) {
    if (!isObject(point) || !isNumber(point.x) || !isNumber(point.y)) {
      fail('invalid-point', 'point must contain finite x and y', { field: 'point' });
    }
    const radius = Math.max(4, isNumber(options.radius) ? options.radius : isNumber(point.radius) ? point.radius : 4);
    const paneId = options.paneId;
    for (let i = drawings.length - 1; i >= 0; i -= 1) {
      const drawing = drawings[i];
      if (!effectiveVisible(drawing)) continue;
      if (paneId !== undefined && drawing.paneId !== paneId) continue;
      const rect = adapter.getVisibleRect({ paneId: drawing.paneId, scaleId: drawing.scaleId });
      const geometry = buildLayout(drawing, adapter);
      if (!geometry.resolved) continue;
      if (!geometry.bounds || !boundsIntersect(geometry.bounds, rect)) continue;
      const handleRadius = radius;
      for (const handle of geometry.handles) {
        if (Math.hypot(point.x - handle.x, point.y - handle.y) <= handleRadius) {
          return { id: drawing.id, part: 'handle', anchorIndex: handle.anchorIndex, x: handle.x, y: handle.y };
        }
      }
      for (const primitive of geometry.primitives) {
        if (primitiveHit(primitive, point, radius)) return { id: drawing.id, part: 'body', primitive: primitive.kind };
      }
      for (const label of geometry.labels) {
        if (primitiveHit({ kind: 'text', ...label }, point, radius)) return { id: drawing.id, part: 'body', primitive: 'text' };
      }
    }
    return null;
  }

  function panelsSummary() {
    const panels = new Map();
    for (const drawing of drawings) {
      if (!panels.has(drawing.paneId)) panels.set(drawing.paneId, new Set());
      panels.get(drawing.paneId).add(drawing.scaleId);
    }
    return [...panels.entries()].map(([paneId, scales]) => ({ paneId, scaleIds: [...scales] }));
  }

  function exportDocument() {
    return {
      schemaVersion: DRAWINGS_SCHEMA_VERSION,
      format: DRAWINGS_FORMAT,
      context: clone(context),
      panels: panelsSummary(),
      drawings: clone(drawings),
      order: drawings.map(drawing => drawing.id),
      groups: clone(groups),
      selection: [...selection],
      styles: clone(styles),
      favorites: [...favorites],
      repeatMode,
    };
  }

  function normalizeImportedGroup(raw, groupIds) {
    if (!isObject(raw)) fail('invalid-import', 'group must be an object');
    const id = requireString(raw.id, 'group.id', { max: 128 });
    const name = requireString(raw.name, 'group.name', { max: 200 });
    let parentId = null;
    if (raw.parentId !== undefined && raw.parentId !== null) parentId = requireString(raw.parentId, 'group.parentId', { max: 128 });
    if (parentId !== null && !groupIds.has(parentId)) fail('invalid-import', `Unknown parent group: ${parentId}`, { id: parentId });
    const visible = raw.visible === undefined ? true : requireBoolean(raw.visible, 'group.visible');
    const locked = raw.locked === undefined ? false : requireBoolean(raw.locked, 'group.locked');
    return { id, name, parentId, visible, locked };
  }

  function assertNoGroupCycles(importedGroups) {
    const byId = new Map(importedGroups.map(group => [group.id, group]));
    for (const group of importedGroups) {
      const seen = new Set([group.id]);
      let current = group;
      while (current.parentId !== null) {
        const parent = byId.get(current.parentId);
        if (!parent) fail('invalid-import', `Unknown parent group: ${current.parentId}`, { id: current.parentId });
        if (seen.has(parent.id)) fail('invalid-import', 'Group nesting contains a cycle', { id: parent.id });
        seen.add(parent.id);
        current = parent;
      }
    }
  }

  function normalizeImportedStyle(raw, drawingTypeSet) {
    if (!isObject(raw)) fail('invalid-import', 'style must be an object');
    const id = requireString(raw.id, 'style.id', { max: 128 });
    const name = requireString(raw.name, 'style.name', { max: 200 });
    const type = raw.type;
    if (!DRAWING_TOOLS[type]) fail('unknown-type', `Unknown drawing type: ${String(type)}`, { field: 'style.type' });
    void drawingTypeSet;
    const style = completeStyle(DRAWING_TOOLS[type].family, raw.style ?? {});
    return { id, name, type, style };
  }

  function importDocument(document) {
    assertNotReconciling();
    if (transaction) fail('transaction-active', 'Cannot import while a drag transaction is open');
    if (!isObject(document)) fail('invalid-import', 'document must be an object');
    if (document.schemaVersion !== DRAWINGS_SCHEMA_VERSION) {
      fail('unsupported-version', `Unsupported drawings schema version: ${String(document.schemaVersion)}`, {
        field: 'schemaVersion',
        expected: DRAWINGS_SCHEMA_VERSION,
      });
    }
    if (document.format !== DRAWINGS_FORMAT) fail('invalid-format', 'Document format is not drawings', { field: 'format' });
    if (!isObject(document.context)) fail('incompatible-context', 'Document context is missing', { field: 'context' });
    for (const key of ['instrumentId', 'interval', 'sourceId', 'view']) {
      if (document.context[key] !== context[key]) {
        fail('incompatible-context', `Document context ${key} does not match this chart`, { field: `context.${key}` });
      }
    }
    if (!Array.isArray(document.groups)) fail('invalid-import', 'groups must be an array', { field: 'groups' });
    if (!Array.isArray(document.drawings)) fail('invalid-import', 'drawings must be an array', { field: 'drawings' });

    const usedIds = new Set();
    const groupIds = new Set();
    const importedGroups = document.groups.map(raw => {
      const id = isObject(raw) ? requireString(raw.id, 'group.id', { max: 128 }) : null;
      if (id !== null && groupIds.has(id)) fail('duplicate-id', `Duplicate group id: ${id}`, { id });
      if (id !== null) groupIds.add(id);
      return raw;
    });
    void importedGroups;
    const normalizedGroups = document.groups.map(raw => normalizeImportedGroup(raw, groupIds));
    for (const group of normalizedGroups) {
      if (usedIds.has(group.id)) fail('duplicate-id', `Duplicate id: ${group.id}`, { id: group.id });
      usedIds.add(group.id);
    }
    assertNoGroupCycles(normalizedGroups);

    const importedDrawings = [];
    for (const raw of document.drawings) {
      if (!isObject(raw)) fail('invalid-import', 'drawing must be an object');
      const id = requireString(raw.id, 'drawing.id', { max: 128 });
      if (usedIds.has(id)) fail('duplicate-id', `Duplicate id: ${id}`, { id });
      const drawing = normalizeDrawing({ ...raw, id }, { id });
      if (drawing.groupId !== null && !groupIds.has(drawing.groupId)) {
        fail('incompatible-group', `Unknown group: ${drawing.groupId}`, { id: drawing.groupId });
      }
      usedIds.add(id);
      importedDrawings.push(drawing);
    }

    let orderedDrawings = importedDrawings;
    if (document.order !== undefined) {
      if (!Array.isArray(document.order) || document.order.length !== importedDrawings.length) {
        fail('invalid-import', 'order must list every drawing once', { field: 'order' });
      }
      const byId = new Map(importedDrawings.map(drawing => [drawing.id, drawing]));
      const ordered = [];
      const seen = new Set();
      for (const id of document.order) {
        if (typeof id !== 'string' || !byId.has(id) || seen.has(id)) {
          fail('invalid-import', 'order must list every drawing once', { field: 'order' });
        }
        seen.add(id);
        ordered.push(byId.get(id));
      }
      orderedDrawings = ordered;
    }

    const importedStyles = [];
    if (document.styles !== undefined) {
      if (!Array.isArray(document.styles)) fail('invalid-import', 'styles must be an array', { field: 'styles' });
      for (const raw of document.styles) {
        const style = normalizeImportedStyle(raw);
        if (usedIds.has(style.id)) fail('duplicate-id', `Duplicate id: ${style.id}`, { id: style.id });
        usedIds.add(style.id);
        importedStyles.push(style);
      }
    }

    let importedFavorites = new Set();
    if (document.favorites !== undefined) {
      if (!Array.isArray(document.favorites)) fail('invalid-import', 'favorites must be an array', { field: 'favorites' });
      for (const type of document.favorites) {
        if (!DRAWING_TOOLS[type]) fail('unknown-type', `Unknown favorite type: ${String(type)}`, { field: 'favorites' });
        importedFavorites.add(type);
      }
    }
    if (document.repeatMode !== undefined) requireBoolean(document.repeatMode, 'repeatMode');

    const before = capture();
    transition(before, { drawings: orderedDrawings, groups: normalizedGroups, selection: [] });
    styles = importedStyles;
    favorites = importedFavorites;
    repeatMode = document.repeatMode === true;
    undoStack.length = 0;
    redoStack.length = 0;
    emit('import', drawings.map(drawing => drawing.id));
    return exportDocument();
  }

  function snapshot() {
    return {
      context: clone(context),
      drawings: clone(drawings),
      groups: clone(groups),
      selection: [...selection],
      styles: clone(styles),
      favorites: [...favorites],
      repeatMode,
      canUndo: canUndo(),
      canRedo: canRedo(),
    };
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') fail('invalid-listener', 'listener must be a function');
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(listener);
    };
  }
  function captureRestoreState() {
    if (transaction) fail('transaction-active', 'Cannot restore while a drag transaction is open');
    // History entries are immutable snapshots; only the stacks are replaced on import.
    return { document: exportDocument(), selection: [...selection], undo: [...undoStack], redo: [...redoStack], counters: { ...counters } };
  }

  function rollbackRestoreState(checkpoint) {
    importDocument(checkpoint.document);
    selection = [...checkpoint.selection];
    undoStack.length = 0;
    redoStack.length = 0;
    for (const entry of checkpoint.undo) undoStack.push(entry);
    for (const entry of checkpoint.redo) redoStack.push(entry);
    Object.assign(counters, checkpoint.counters);
  }


  return {
    [DRAWING_RESTORE_HOOKS]: { capture: captureRestoreState, rollback: rollbackRestoreState },
    add,
    get,
    list,
    update,
    updateBatch,
    updateMany,
    remove,
    clear,
    clearAll,
    undo,
    redo,
    canUndo,
    canRedo,
    beginTransaction,
    endTransaction,
    cancelTransaction,
    createGroup,
    renameGroup,
    ungroup,
    removeGroup,
    setGroupParent,
    addToGroup,
    removeFromGroup,
    getGroup,
    listGroups,
    getGroupMembers,
    select,
    selectMany,
    getSelection,
    bringForward: () => reorder('forward'),
    sendBackward: () => reorder('backward'),
    bringToFront: () => reorder('front'),
    sendToBack: () => reorder('back'),
    setOrder,
    setVisibility,
    setLocked,
    removeSelected,
    saveStyle,
    listStyles,
    applyStyle,
    setFavorite,
    isFavorite,
    listFavorites,
    setRepeatMode,
    getRepeatMode,
    export: exportDocument,
    import: importDocument,
    snapshot,
    subscribe,
    hitTest,
    layout,
    setDragPreview,
    previewLayout,
    getGeometry,
    getMeasure,
    snapPrice,
    snapX,
    context: () => clone(context),
    order: () => drawings.map(drawing => drawing.id),
    selectedByZ,
  };
}

export const DRAWINGS_PITCHFORK_VARIANTS = PITCHFORK_VARIANTS;
