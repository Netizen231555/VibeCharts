import { fail } from './errors.js';
import {
  isPlainObject,
  requireArray,
  requireBoolean,
  requireString,
  toJsonClone,
  uniqueBy,
} from './util.js';
import { normalizeAnchor } from './anchors.js';
import { clearChildren, createElement, focusElement, listen, setAttr } from './dom.js';

export const TREE_UNDO_LIMIT = 50;
export const NODE_KINDS = ['chart', 'group', 'drawing', 'indicator', 'series', 'alert'];
const EXTERNAL_KINDS = ['drawing', 'indicator', 'series', 'alert'];
const KIND_LABEL = {
  chart: 'Chart',
  group: 'Group',
  drawing: 'Drawing',
  indicator: 'Indicator',
  series: 'Series',
  alert: 'Alert',
};
const TREE_HELP =
  'Chart object tree. Arrow keys move focus; Alt+ArrowUp or Alt+ArrowDown reorder; Right expands a group; Left collapses; Enter selects; v toggles visibility; l toggles lock; F2 renames a group or drawing; Delete asks for confirmation.';

export function chartNodeId(chartId) {
  return `chart:${chartId}`;
}

export function externalNodeId(kind, chartId, refId) {
  return `${kind}:${chartId}:${refId}`;
}

export const isExternalKind = (kind) => EXTERNAL_KINDS.includes(kind);

/**
 * Structural validation used by `restoreState` and template import. Returns a
 * normalized detached copy; any invalid parent, cycle, duplicate id or anchor
 * rejects the whole tree.
 */
export function validateTreeNodes(nodes, chartIds, code = 'invalid-state') {
  requireArray(nodes, 'tree.nodes', code);
  const knownCharts = new Set(chartIds);
  const normalized = nodes.map((raw, index) => {
    const field = `tree.nodes[${index}]`;
    if (!isPlainObject(raw)) fail(code, `${field} must be an object`, { field });
    const id = requireString(raw.id, `${field}.id`, code);
    const kind = requireString(raw.kind, `${field}.kind`, code);
    if (!NODE_KINDS.includes(kind)) fail(code, `${field}.kind is not a supported node kind`, { field: `${field}.kind` });
    const chartId = requireString(raw.chartId, `${field}.chartId`, code);
    if (!knownCharts.has(chartId)) fail(code, `${field}.chartId references unknown chart "${chartId}"`, { field: `${field}.chartId` });
    const name = requireString(raw.name, `${field}.name`, code);
    const visible = raw.visible === undefined ? true : requireBoolean(raw.visible, `${field}.visible`, code);
    const locked = raw.locked === undefined ? false : requireBoolean(raw.locked, `${field}.locked`, code);
    const expanded = raw.expanded === undefined ? true : requireBoolean(raw.expanded, `${field}.expanded`, code);
    const parentId = raw.parentId === null || raw.parentId === undefined ? null : requireString(raw.parentId, `${field}.parentId`, code);
    const node = { id, kind, chartId, name, parentId, visible, locked, expanded };
    if (kind === 'chart') {
      if (id !== chartNodeId(chartId)) fail(code, `${field}.id must be "${chartNodeId(chartId)}" for its chart`, { field: `${field}.id` });
      if (parentId !== null) fail(code, `${field} is a chart root and cannot have a parent`, { field: `${field}.parentId` });
      node.refId = chartId;
    } else {
      node.refId = requireString(raw.refId, `${field}.refId`, code);
    }
    if (raw.status !== undefined) node.status = requireString(raw.status, `${field}.status`, code, true);
    if (raw.anchors !== undefined) {
      requireArray(raw.anchors, `${field}.anchors`, code);
      node.anchors = raw.anchors.map((anchor, anchorIndex) =>
        normalizeAnchor(anchor, `${field}.anchors[${anchorIndex}]`, code),
      );
    }
    if (raw.spec !== undefined) node.spec = toJsonClone(raw.spec, `${field}.spec`, { code });
    return node;
  });

  uniqueBy(normalized, 'tree.nodes', 'id', code);
  const byId = new Map(normalized.map((node) => [node.id, node]));
  const externalRefs = new Set();
  for (const node of normalized) {
    if (node.id !== `${node.kind}:${node.chartId}:${node.refId}` && node.kind !== 'group' && node.kind !== 'chart') {
      fail(code, `tree node id "${node.id}" does not match its kind, chart and reference`, { field: `tree.nodes.${node.id}.id` });
    }
    if (node.kind === 'group' && !node.id.startsWith('group:')) {
      fail(code, `group node id "${node.id}" must start with "group:"`, { field: `tree.nodes.${node.id}.id` });
    }
    if (node.parentId !== null) {
      const parent = byId.get(node.parentId);
      if (!parent) fail(code, `tree node "${node.id}" references missing parent "${node.parentId}"`, { field: `tree.nodes.${node.id}.parentId` });
      if (parent.kind !== 'chart' && parent.kind !== 'group') {
        fail(code, `tree node "${node.id}" cannot be nested in a ${parent.kind}`, { field: `tree.nodes.${node.id}.parentId` });
      }
      if (parent.chartId !== node.chartId) {
        fail(code, `tree node "${node.id}" cannot be nested under another chart`, { field: `tree.nodes.${node.id}.parentId` });
      }
    }
    if (isExternalKind(node.kind)) {
      const key = `${node.kind}\u0000${node.chartId}\u0000${node.refId}`;
      if (externalRefs.has(key)) fail(code, `tree contains duplicate ${node.kind} reference "${node.refId}"`, { field: `tree.nodes.${node.id}.refId` });
      externalRefs.add(key);
    }
  }

  for (const node of normalized) {
    const visited = new Set([node.id]);
    let current = node;
    while (current.parentId !== null) {
      if (visited.has(current.parentId)) fail(code, `tree contains a cycle at "${node.id}"`, { field: `tree.nodes.${node.id}.parentId` });
      visited.add(current.parentId);
      current = byId.get(current.parentId);
    }
  }

  for (const chartId of chartIds) {
    const root = normalized.filter((node) => node.kind === 'chart' && node.chartId === chartId);
    if (root.length !== 1) fail(code, `tree must contain exactly one root node for chart "${chartId}"`, { field: 'tree.nodes' });
  }

  return normalized;
}

const childMapOf = (nodes) => {
  const map = new Map();
  for (const node of nodes) {
    const list = map.get(node.parentId) ?? [];
    list.push(node);
    map.set(node.parentId, list);
  }
  return map;
};

const flattenOrder = (map) => {
  const output = [];
  const visit = (parentId) => {
    for (const child of map.get(parentId) ?? []) {
      output.push(child);
      visit(child.id);
    }
  };
  visit(null);
  return output;
};

const alertStatusText = (entry) => {
  if (typeof entry.status === 'string') return entry.status;
  if (entry.status && typeof entry.status.state === 'string') return entry.status.state;
  if (typeof entry.evaluation?.status === 'string') return entry.evaluation.status;
  return 'unknown';
};
const alertStatusLabel = (node, error) => `${node.status ?? 'unknown'}${error ? `; source unavailable: ${error}` : ''}`;

export class TreeStore {
  constructor({ getChart, emit, chartIds = [], captureComparison = null, removeComparison = null, restoreComparison = null, isAuxiliarySeries = null }) {
    this.getChart = getChart;
    this.emit = emit ?? (() => {});
    this.captureComparison = captureComparison;
    this.removeComparison = removeComparison;
    this.restoreComparison = restoreComparison;
    this.isAuxiliarySeries = isAuxiliarySeries;
    this.nodes = [];
    this.alertSourceErrors = new Map();
    this.chartNames = new Map();
    for (const chartId of chartIds) this.ensureChartRoot(chartId);
    this.undoStack = [];
    this.selectedId = null;
    this.focusedId = null;
    this.renamingId = null;
    this.pendingDelete = null;
    this.alertEditor = null;
    this.container = null;
    this.editorContainer = null;
    this.elements = new Map();
    this.unlisten = [];
  }

  ensureChartRoot(chartId) {
    const id = chartNodeId(chartId);
    let root = this.nodes.find((node) => node.id === id);
    if (!root) {
      root = {
        id,
        kind: 'chart',
        chartId,
        name: this.chartNames.get(chartId) ?? `Chart ${chartId}`,
        parentId: null,
        refId: chartId,
        visible: true,
        locked: false,
        expanded: true,
      };
      this.nodes.push(root);
    }
    return root;
  }

  setChartName(chartId, name) {
    this.chartNames.set(chartId, name);
    const root = this.nodes.find((node) => node.kind === 'chart' && node.chartId === chartId);
    if (root) root.name = name;
  }

  requireNode(id) {
    const node = this.nodes.find((entry) => entry.id === id);
    if (!node) fail('unknown-object', `Unknown tree object: ${id}`, { field: 'id' });
    return node;
  }

  get(id) {
    const node = this.nodes.find((entry) => entry.id === id);
    return node ? toJsonClone(node, 'node') : null;
  }

  list() {
    return this.nodes.map((node) => toJsonClone(node, 'node'));
  }

  replaceNodes(nodes, focusedId = null) {
    this.nodes = toJsonClone(nodes, 'tree.nodes');
    this.alertSourceErrors.clear();
    this.selectedId = null;
    this.focusedId = focusedId;
    this.undoStack = [];
    this.pendingDelete = null;
    this.renamingId = null;
    this.alertEditor = null;
    this.render();
  }

  chartRoot(chartId) {
    return this.nodes.find((node) => node.kind === 'chart' && node.chartId === chartId) ?? null;
  }

  parentOf(node) {
    return node.parentId === null ? null : this.nodes.find((entry) => entry.id === node.parentId) ?? null;
  }

  ancestorsOf(node) {
    const ancestors = [];
    let parent = this.parentOf(node);
    while (parent) {
      ancestors.push(parent);
      parent = this.parentOf(parent);
    }
    return ancestors;
  }

  effectiveVisible(id) {
    const node = this.requireNode(id);
    return node.visible && this.ancestorsOf(node).every((ancestor) => ancestor.visible);
  }

  effectiveLocked(id) {
    const node = this.requireNode(id);
    return node.locked || this.ancestorsOf(node).some((ancestor) => ancestor.locked);
  }

  assertAncestorsUnlocked(node) {
    const locked = this.ancestorsOf(node).find((ancestor) => ancestor.locked);
    if (locked) {
      fail('object-locked', `Cannot edit "${node.name}": ancestor "${locked.name}" is locked`, {
        field: 'id',
        lockedId: locked.id,
      });
    }
  }

  assertEditable(node) {
    if (node.kind === 'chart') fail('unsupported', 'The chart root cannot be edited', { field: 'id' });
    if (node.kind === 'alert') fail('alert-managed', 'Alerts are edited through chart-alerts operations', { field: 'id' });
    const locked = [node, ...this.ancestorsOf(node)].find((entry) => entry.locked);
    if (locked) {
      fail('object-locked', `Cannot edit "${node.name}": "${locked.name}" is locked`, {
        field: 'id',
        lockedId: locked.id,
      });
    }
  }

  subtree(id) {
    const node = this.requireNode(id);
    const output = [node];
    const map = childMapOf(this.nodes);
    const visit = (current) => {
      for (const child of map.get(current.id) ?? []) {
        output.push(child);
        visit(child);
      }
    };
    visit(node);
    return output;
  }

  pushUndo(action, { nativeCharts = [] } = {}) {
    if (this.undoStack.length >= TREE_UNDO_LIMIT) this.undoStack.shift();
    const entry = {
      action,
      nodes: toJsonClone(this.nodes, 'tree.nodes'),
      selectedId: this.selectedId,
      focusedId: this.focusedId,
      payloads: {},
    };
    const charts = [...new Set(nativeCharts)];
    if (charts.length > 0) {
      entry.nativeCharts = charts;
      entry.nativeDocuments = this.captureNativeDocuments(charts);
    }
    this.undoStack.push(entry);
  }

  /** Drawing capability is native when it owns groups and its own document. */
  nativeGroupApi(chart) {
    const drawings = chart?.drawings;
    return drawings && typeof drawings.listGroups === 'function' ? drawings : null;
  }

  nativeGroupNodeId(chartId, refId) {
    return `group:${chartId}:native:${refId}`;
  }

  nativeGroupTarget(node) {
    return node.kind === 'drawing' || (node.kind === 'group' && node.refId !== node.id);
  }

  captureNativeDocuments(chartIds) {
    const documents = {};
    for (const chartId of chartIds) {
      const drawings = this.getChart(chartId)?.drawings;
      if (typeof drawings?.exportDocument === 'function') {
        documents[chartId] = toJsonClone(drawings.exportDocument(), 'drawings');
      } else if (typeof drawings?.export === 'function') {
        documents[chartId] = toJsonClone(drawings.export(), 'drawings');
      } else {
        fail('adapter-unsupported', 'Drawing export is required to undo native group changes', {
          field: 'drawings',
          chartId,
        });
      }
    }
    return documents;
  }

  restoreNativeDocuments(entry) {
    for (const chartId of entry.nativeCharts ?? []) {
      const document = entry.nativeDocuments?.[chartId];
      const drawings = this.getChart(chartId)?.drawings;
      if (!document) continue;
      if (typeof drawings?.importDocument === 'function') drawings.importDocument(toJsonClone(document, 'drawings'));
      else if (typeof drawings?.import === 'function') drawings.import(toJsonClone(document, 'drawings'));
      else fail('adapter-unsupported', 'Drawing import is required to undo native group changes', { field: 'drawings', chartId });
    }
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  render({ preserveEditor = false } = {}) {
    if (!this.container) return;
    const active = this.container.ownerDocument?.activeElement;
    const treeHadFocus = this.container.contains?.(active) === true;
    const editorHadFocus = this.editorContainer?.contains?.(active) === true;
    clearChildren(this.container);
    this.elements.clear();
    const list = createElement(this.container, 'ul', {
      className: 'cw-tree',
      attributes: { role: 'tree', 'aria-label': 'Chart objects', 'aria-describedby': 'cw-tree-help' },
    });
    const help = createElement(this.container, 'p', { className: 'cw-visually-hidden', attributes: { id: 'cw-tree-help', text: TREE_HELP } });
    help.textContent = TREE_HELP;
    const roots = this.nodes.filter((node) => node.parentId === null);
    for (const root of roots) this.renderNode(list, root, 1);
    this.renderConfirmation();
    if (preserveEditor && this.alertEditor && !this.nodes.some(node =>
      node.kind === 'alert' && node.chartId === this.alertEditor.chartId && node.refId === this.alertEditor.alertId)) {
      const chartId = this.alertEditor.chartId;
      this.alertEditor = null;
      this.renderAlertEditor();
      if (editorHadFocus) this.focusedId = chartNodeId(chartId);
    } else if (!preserveEditor) this.renderAlertEditor();
    else if (this.alertEditor) {
      const node = this.nodes.find(entry => entry.kind === 'alert' && entry.chartId === this.alertEditor.chartId && entry.refId === this.alertEditor.alertId);
      if (node && this.alertEditor.statusNode) this.alertEditor.statusNode.textContent = `Status: ${alertStatusLabel(node, this.alertSourceErrors.get(node.id))}`;
      if (node && this.alertEditor.pauseNode) this.alertEditor.pauseNode.textContent = node.status === 'paused' ? 'Resume alert' : 'Pause alert';
    }
    const focused = this.focusedId ? this.elements.get(this.focusedId) : null;
    if (focused && (!preserveEditor || treeHadFocus || (editorHadFocus && !this.alertEditor))) focusElement(focused);
  }

  renderConfirmation() {
    if (!this.pendingDelete || !this.container) return;
    const node = this.nodes.find((entry) => entry.id === this.pendingDelete.id);
    if (!node) {
      this.pendingDelete = null;
      return;
    }
    const subtree = this.subtree(node.id).filter((entry) => entry !== node);
    const region = createElement(this.container, 'div', {
      className: 'cw-tree-confirm',
      attributes: { role: 'alertdialog', 'aria-label': `Confirm deleting ${node.name}` },
    });
    const message = createElement(region, 'p', { className: 'cw-tree-confirm-text' });
    message.textContent = subtree.length
      ? `Delete "${node.name}" and its ${subtree.length} descendant object${subtree.length === 1 ? '' : 's'}?`
      : `Delete "${node.name}"?`;
    const confirm = createElement(region, 'button', {
      className: 'cw-button',
      attributes: { type: 'button', 'data-action': 'confirm-delete', 'data-node-id': node.id, 'aria-label': `Confirm deleting ${node.name}` },
      text: 'Delete',
    });
    confirm.textContent = 'Delete';
    const cancel = createElement(region, 'button', {
      className: 'cw-button',
      attributes: { type: 'button', 'data-action': 'cancel-delete', 'data-node-id': node.id, 'aria-label': 'Cancel deletion' },
      text: 'Cancel',
    });
    cancel.textContent = 'Cancel';
  }

  renderAlertEditor() {
    if (!this.editorContainer) return;
    clearChildren(this.editorContainer);
    if (!this.alertEditor) return;
    const { chartId, alertId } = this.alertEditor;
    const node = this.nodes.find((entry) => entry.kind === 'alert' && entry.chartId === chartId && entry.refId === alertId);
    if (!node) {
      this.alertEditor = null;
      return;
    }
    const region = createElement(this.editorContainer, 'section', {
      className: 'cw-alert-editor',
      attributes: { role: 'region', 'aria-label': 'Alert editor' },
    });
    const heading = createElement(region, 'h3', { text: `Alert ${node.name}` });
    heading.textContent = `Alert ${node.name}`;
    const status = createElement(region, 'p', { className: 'cw-alert-status', attributes: { role: 'status' } });
    status.textContent = `Status: ${alertStatusLabel(node, this.alertSourceErrors.get(node.id))}`;
    this.alertEditor.statusNode = status;
    const alerts = this.getChart(chartId)?.alerts;
    if (typeof alerts?.get !== 'function' || typeof alerts?.update !== 'function') {
      createElement(region, 'p', { text: 'Alert editing is unavailable: the chart adapter does not provide alert operations.' });
      return;
    }
    const editor = this.alertEditor;
    const definition = editor.definition;
    if (editor.error) {
      createElement(region, 'p', { text: `Unable to open alert: ${editor.error}`, attributes: { role: 'alert' } });
      return;
    }
    if (!definition || !Number.isSafeInteger(editor.revision)) {
      createElement(region, 'p', { text: 'Alert editing is unavailable: the definition or revision is missing.', attributes: { role: 'alert' } });
      return;
    }
    if (definition.authority === 'backend' && typeof alerts.backendUpdate !== 'function') {
      createElement(region, 'p', { text: 'Alert editing is unavailable: the backend update operation is missing.', attributes: { role: 'alert' } });
      return;
    }
    const rule = createElement(region, 'p', { className: 'cw-alert-rule' });
    rule.textContent = `${definition.operation}; ${definition.mode}; authority: ${definition.authority}; revision: ${this.alertEditor.revision}`;
    const form = createElement(region, 'form', { attributes: { 'aria-label': 'Edit alert' } });
    const message = createElement(form, 'p', { attributes: { role: 'status', 'aria-live': 'polite' } });
    const errors = createElement(form, 'div', { attributes: { role: 'alert', 'aria-live': 'assertive' } });
    const inputs = new Map();
    const addField = (path, labelText, value, numeric = false) => {
      const label = createElement(form, 'label', { text: labelText, style: { display: 'block', marginBlock: '0.5em' } });
      const input = createElement(label, 'input', { attributes: { name: path, type: 'text', ...(numeric ? { inputmode: 'decimal' } : {}) }, style: { display: 'block', maxWidth: '100%', boxSizing: 'border-box' } });
      input.value = editor.draft[path] ?? (value === null ? '' : String(value));
      input.addEventListener('input', () => { editor.draft[path] = input.value; });
      const error = createElement(label, 'span', { style: { display: 'block' } });
      error.id = `cw-alert-error-${encodeURIComponent(chartId)}-${encodeURIComponent(alertId)}-${encodeURIComponent(path)}`;
      inputs.set(path, { input, error });
    };
    addField('name', 'Name', definition.name);
    addField('hysteresis', 'Hysteresis', definition.hysteresis, true);
    for (const side of ['left', 'right']) {
      if (definition[side]?.kind === 'constant') addField(`${side}.value`, `${side === 'left' ? 'Left' : 'Right'} level`, definition[side].value, true);
    }
    createElement(form, 'button', { text: 'Save alert', attributes: { type: 'submit' } });
    const pause = createElement(form, 'button', { text: node.status === 'paused' ? 'Resume alert' : 'Pause alert', attributes: { type: 'button' } });
    editor.pauseNode = pause;
    const remove = createElement(form, 'button', { text: 'Delete alert', attributes: { type: 'button' } });
    const confirmation = createElement(form, 'section', { attributes: { role: 'alertdialog', 'aria-label': 'Confirm alert deletion', hidden: '' } });
    createElement(confirmation, 'p', { text: 'Delete this alert?' });
    const confirm = createElement(confirmation, 'button', { text: 'Confirm deletion', attributes: { type: 'button' } });
    const cancel = createElement(confirmation, 'button', { text: 'Cancel deletion', attributes: { type: 'button' } });
    const refresh = (result, action) => {
      editor.revision = result.revision;
      const updated = alerts.get(alertId);
      editor.definition = updated.definition;
      node.name = updated.definition.name || `Alert ${alertId}`;
      node.status = alertStatusText(updated);
      if (updated.evaluation?.sourceError) this.alertSourceErrors.set(node.id, updated.evaluation.sourceError);
      else this.alertSourceErrors.delete(node.id);
      heading.textContent = `Alert ${node.name}`;
      status.textContent = `Status: ${alertStatusLabel(node, this.alertSourceErrors.get(node.id))}`;
      pause.textContent = node.status === 'paused' ? 'Resume alert' : 'Pause alert';
      const treeItem = this.elements.get(node.id);
      const treeName = treeItem?.querySelector?.('.cw-node-name');
      const treeStatus = treeItem?.querySelector?.('.cw-node-status');
      if (treeName) treeName.textContent = node.name;
      if (treeStatus) treeStatus.textContent = ` — ${alertStatusLabel(node, this.alertSourceErrors.get(node.id))}`;
      if (treeItem) setAttr(treeItem, 'aria-label', this.accessibleName(node));
      rule.textContent = `${definition.operation}; ${definition.mode}; authority: ${definition.authority}; revision: ${result.revision}`;
      message.textContent = `Alert ${action} at revision ${result.revision}.`;
    };
    pause.addEventListener('click', () => {
      errors.textContent = '';
      message.textContent = '';
      try {
        const action = node.status === 'paused' ? 'resume' : 'pause';
        const method = definition.authority === 'backend' ? `backend${action === 'pause' ? 'Pause' : 'Resume'}` : action;
        if (typeof alerts[method] !== 'function') throw new Error(`Alert ${action} is unavailable.`);
        const result = alerts[method](alertId, editor.revision);
        if (definition.authority === 'backend' && result.outcome !== 'confirmed') {
          errors.textContent = 'The backend outcome is unknown. Reconcile the alert before editing again.';
          return;
        }
        refresh(result, action === 'pause' ? 'paused' : 'resumed');
      } catch (error) { errors.textContent = error.message; }
    });
    remove.addEventListener('click', () => {
      confirmation.removeAttribute('hidden');
      focusElement(confirm);
    });
    cancel.addEventListener('click', () => {
      confirmation.setAttribute('hidden', '');
      focusElement(remove);
    });
    confirm.addEventListener('click', () => {
      errors.textContent = '';
      message.textContent = '';
      try {
        let result;
        if (definition.authority === 'backend') {
          if (typeof alerts.backendDelete !== 'function') throw new Error('Alert deletion is unavailable.');
          result = alerts.backendDelete(alertId, editor.revision);
          if (result.outcome !== 'confirmed') {
            errors.textContent = 'The backend outcome is unknown. Reconcile the alert before editing again.';
            return;
          }
        } else {
          if (typeof alerts.remove !== 'function') throw new Error('Alert deletion is unavailable.');
          if (alerts.get(alertId).revision !== editor.revision) throw new Error('The alert changed since it was read. Reopen it before deleting.');
          result = alerts.remove(alertId);
          if (result.removed !== true) throw new Error('Alert deletion was not confirmed.');
        }
        this.alertEditor = null;
        this.syncChart(chartId);
        this.selectedId = chartNodeId(chartId);
        this.focusedId = this.selectedId;
        this.render();
        this.emit({ type: 'tree', action: 'alert-delete', chartId, alertId });
      } catch (error) { errors.textContent = error.message; }
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      errors.textContent = '';
      message.textContent = '';
      for (const { input, error } of inputs.values()) {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
        error.textContent = '';
      }
      const number = (path) => {
        const value = inputs.get(path).input.value.trim();
        return value === '' ? NaN : Number(value);
      };
      const name = inputs.get('name').input.value;
      const patch = { name: name === '' ? null : name, hysteresis: number('hysteresis') };
      for (const side of ['left', 'right']) {
        if (inputs.has(`${side}.value`)) patch[side] = { ...definition[side], value: number(`${side}.value`) };
      }
      try {
        const result = definition.authority === 'backend'
          ? alerts.backendUpdate(alertId, patch, editor.revision)
          : alerts.update(alertId, patch, editor.revision);
        if (definition.authority === 'backend' && result.outcome !== 'confirmed') {
          errors.textContent = 'The backend outcome is unknown. Reconcile the alert before editing again.';
          return;
        }
        refresh(result, 'saved');
      } catch (error) {
        errors.textContent = error.message;
        for (const field of error.fields ?? []) {
          const target = inputs.get(field.path);
          if (!target) continue;
          target.error.textContent = field.message;
          target.input.setAttribute('aria-invalid', 'true');
          target.input.setAttribute('aria-describedby', target.error.id);
        }
      }
    });
  }

  renderNode(container, node, level) {
    const item = createElement(container, 'li', {
      className: `cw-node cw-kind-${node.kind}`,
      attributes: {
        role: 'treeitem',
        'data-node-id': node.id,
        'aria-level': level,
        'aria-selected': this.selectedId === node.id ? 'true' : 'false',
        tabindex: (this.focusedId ?? this.nodes.find(entry => entry.parentId === null)?.id) === node.id ? '0' : '-1',
        'aria-label': this.accessibleName(node),
      },
    });
    item.dataset.nodeId = node.id;
    const children = this.nodes.filter((entry) => entry.parentId === node.id);
    if (children.length > 0 || node.kind === 'group') {
      setAttr(item, 'aria-expanded', node.expanded ? 'true' : 'false');
      if (this.focusedId === node.id) setAttr(item, 'tabindex', '0');
    }
    const name = createElement(item, 'span', { className: 'cw-node-name', text: node.name });
    name.textContent = node.name;
    name.dataset.nodeId = node.id;
    const stateLabel = node.kind === 'group' ? '' : ` ${this.visibleLabel(node)}${node.locked ? ', locked' : ''}`;
    const state = createElement(item, 'span', { className: 'cw-node-state', text: stateLabel.trim() });
    state.textContent = stateLabel.trim();
    state.dataset.nodeId = node.id;
    if (node.status !== undefined) {
      const status = createElement(item, 'span', { className: 'cw-node-status', text: node.status });
      status.textContent = ` — ${alertStatusLabel(node, this.alertSourceErrors.get(node.id))}`;
      status.dataset.nodeId = node.id;
    }
    if (this.renamingId === node.id) {
      const input = createElement(item, 'input', {
        className: 'cw-rename-input',
        attributes: { type: 'text', 'aria-label': `New name for ${node.name}` },
      });
      input.value = node.name;
      if (input.dataset) input.dataset.renameInput = 'true';
      if (input.dataset) input.dataset.nodeId = node.id;
      focusElement(input);
    }
    this.elements.set(node.id, item);
    if (children.length > 0 && node.expanded) {
      const group = createElement(item, 'ul', { className: 'cw-node-children', attributes: { role: 'group' } });
      for (const child of children) this.renderNode(group, child, level + 1);
    }
  }

  visibleLabel(node) {
    return this.effectiveVisible(node.id) ? '' : 'hidden';
  }

  accessibleName(node) {
    const parts = [`${KIND_LABEL[node.kind]} ${node.name}`];
    if (node.kind !== 'chart' && node.visible === false) parts.push('hidden');
    if (node.kind !== 'chart' && node.visible !== false && !this.ancestorsOf(node).every((a) => a.visible)) parts.push('hidden by group');
    if (node.locked) parts.push('locked');
    if (node.kind === 'indicator' || node.kind === 'series') parts.push(this.visibleLabel(node) === '' ? 'visible' : 'hidden');
    if (node.status !== undefined) parts.push(`status ${node.status}`);
    if (this.alertSourceErrors.has(node.id)) parts.push(`source unavailable: ${this.alertSourceErrors.get(node.id)}`);
    if (this.selectedId === node.id) parts.push('selected');
    return parts.join(', ');
  }

  flattenVisible() {
    const map = childMapOf(this.nodes);
    const output = [];
    const visit = (parentId) => {
      for (const child of map.get(parentId) ?? []) {
        output.push(child);
        if ((child.kind === 'group' || child.kind === 'chart') && child.expanded) visit(child.id);
      }
    };
    visit(null);
    return output;
  }

  setFocus(id) {
    this.focusedId = id;
    if (!this.container) return;
    for (const [nodeId, element] of this.elements) {
      if (element && typeof element.setAttribute === 'function') element.setAttribute('tabindex', nodeId === id ? '0' : '-1');
    }
    const element = this.elements.get(id);
    if (element) focusElement(element);
  }

  select(id) {
    const node = this.requireNode(id);
    this.selectedId = id;
    this.focusedId = id;
    this.emit({ type: 'tree', action: 'select', id, chartId: node.chartId });
    if (node.kind === 'alert') {
      this.openAlertEditor(node.chartId, node.refId);
      return;
    }
    this.render();
  }

  openAlertEditor(chartId, alertId) {
    const node = this.nodes.find((entry) => entry.kind === 'alert' && entry.chartId === chartId && entry.refId === alertId);
    if (!node) fail('unknown-object', `Unknown alert: ${alertId}`, { field: 'alertId' });
    const chart = this.getChart(chartId);
    let record = null;
    let readError = null;
    try {
      if (typeof chart?.alerts?.get === 'function') record = chart.alerts.get(alertId);
    } catch (error) {
      readError = error.message;
    }
    this.alertEditor = { chartId, alertId, revision: record?.revision ?? null, definition: record?.definition ?? null, error: readError, draft: {} };
    this.selectedId = node.id;
    if (chart?.alertUI && chart.alertUI.selectedId() !== alertId) chart.alertUI.select(alertId);
    else if (!chart?.alertUI && typeof chart?.alerts?.select === 'function') chart.alerts.select(alertId);
    this.emit({ type: 'alertSelect', chartId, alertId });
    this.render();
  }

  createGroup(name, options = {}) {
    requireString(name, 'name');
    const chartId = options.chartId;
    if (typeof chartId !== 'string' || !chartId) fail('invalid-argument', 'chartId is required to create a group', { field: 'chartId' });
    const root = this.chartRoot(chartId);
    if (!root) fail('unknown-chart', `Unknown chart: ${chartId}`, { field: 'chartId' });
    const parentId = options.parentId ?? root.id;
    const parent = this.requireNode(parentId);
    if (parent.kind !== 'group' && parent.kind !== 'chart') fail('invalid-move', 'A group can only live under a chart or another group', { field: 'parentId' });
    if (parent.chartId !== chartId) fail('invalid-move', 'A group cannot belong to another chart', { field: 'parentId' });
    this.assertAncestorsUnlocked(parent);
    const native = this.nativeGroupApi(this.getChart(chartId));
    if (native) {
      const nativeParentId = parent.kind === 'group' ? parent.refId : null;
      if (parent.kind === 'group' && (!nativeParentId || nativeParentId === parent.id)) {
        fail('adapter-unsupported', 'Parent group is not backed by the drawing store', { field: 'parentId' });
      }
      if (typeof native.createGroup !== 'function') {
        fail('adapter-unsupported', 'drawings.createGroup is required for store-backed groups', { field: 'drawings.createGroup' });
      }
      this.pushUndo('create-group', { nativeCharts: [chartId] });
      let created;
      try {
        created = native.createGroup({ name, parentId: nativeParentId ?? null });
      } catch (error) {
        this.undoStack.pop();
        throw error;
      }
      if (!created || typeof created.id !== 'string' || created.id.length === 0) {
        this.undoStack.pop();
        fail('chart-adapter', 'drawings.createGroup must return a group with an id', { field: 'drawings.createGroup' });
      }
      const id = this.nativeGroupNodeId(chartId, created.id);
      if (this.nodes.some((node) => node.id === id)) {
        this.undoStack.pop();
        fail('duplicate-object', `Group "${created.id}" already exists in the object tree`, { field: 'id' });
      }
      const node = {
        id,
        kind: 'group',
        chartId,
        name: created.name ?? name,
        parentId,
        refId: created.id,
        visible: created.visible !== false,
        locked: created.locked === true,
        expanded: true,
      };
      this.nodes.push(node);
      this.nodes = flattenOrder(childMapOf(this.nodes));
      this.selectedId = id;
      this.focusedId = id;
      this.emit({ type: 'tree', action: 'create-group', id, chartId });
      this.render();
      return toJsonClone(node, 'group');
    }
    let counter = 1;
    let id = `group:${chartId}:g${counter}`;
    while (this.nodes.some((node) => node.id === id)) id = `group:${chartId}:g${++counter}`;
    this.pushUndo('create-group');
    const node = { id, kind: 'group', chartId, name, parentId, refId: id, visible: true, locked: false, expanded: true };
    this.nodes.push(node);
    this.nodes = flattenOrder(childMapOf(this.nodes));
    this.selectedId = id;
    this.focusedId = id;
    this.emit({ type: 'tree', action: 'create-group', id, chartId });
    this.render();
    return toJsonClone(node, 'group');
  }

  rename(id, name) {
    const node = this.requireNode(id);
    requireString(name, 'name');
    if (node.kind !== 'group' && node.kind !== 'drawing') {
      fail('unsupported', `Renaming a ${node.kind} is not supported by the object tree`, { field: 'id' });
    }
    this.assertEditable(node);
    const native = this.nativeGroupApi(this.getChart(node.chartId));
    const nativeGroup = node.kind === 'group' && native && node.refId !== node.id;
    this.pushUndo('rename', nativeGroup ? { nativeCharts: [node.chartId] } : {});
    if (nativeGroup) {
      if (typeof native.renameGroup !== 'function') {
        this.undoStack.pop();
        fail('adapter-unsupported', 'drawing store renameGroup is required to rename a store-backed group', {
          field: 'renameGroup',
        });
      }
      try {
        native.renameGroup(node.refId, name);
      } catch (error) {
        this.undoStack.pop();
        throw error;
      }
    }
    // Drawing names are workspace labels: drawings have no name
    // property, so renaming never mutates drawing geometry or capability state.
    node.name = name;
    if (node.kind === 'chart') this.setChartName(node.chartId, name);
    this.renamingId = null;
    this.emit({ type: 'tree', action: 'rename', id, chartId: node.chartId });
    this.render();
  }

  startRename(id) {
    const node = this.requireNode(id);
    if (node.kind !== 'group' && node.kind !== 'drawing') fail('unsupported', `Renaming a ${node.kind} is not supported`, { field: 'id' });
    this.assertEditable(node);
    this.renamingId = id;
    this.render();
  }

  commitRename(name) {
    if (!this.renamingId) fail('invalid-operation', 'No rename is in progress', { field: 'renamingId' });
    this.rename(this.renamingId, name);
  }

  cancelRename() {
    this.renamingId = null;
    this.render();
  }

  move(id, { parentId, index }) {
    const node = this.requireNode(id);
    if (node.kind !== 'drawing' && node.kind !== 'group') {
      fail('invalid-move', `A ${node.kind} cannot be moved inside the drawing tree`, { field: 'id' });
    }
    this.assertEditable(node);
    const root = this.chartRoot(node.chartId);
    const targetParentId = parentId ?? root.id;
    const parent = this.requireNode(targetParentId);
    if (parent.kind !== 'group' && parent.kind !== 'chart') fail('invalid-move', 'Target parent must be a chart or group', { field: 'parentId' });
    if (parent.chartId !== node.chartId) fail('invalid-move', 'Objects cannot move between charts', { field: 'parentId' });
    if (parent.id === node.id || this.ancestorsOf(parent).some((ancestor) => ancestor.id === node.id)) {
      fail('invalid-move', `Cannot move "${node.name}" into its own descendant`, { field: 'parentId' });
    }
    this.assertAncestorsUnlocked(parent);

    const chart = this.getChart(node.chartId);
    const native = this.nativeGroupApi(chart);
    const targetRef = parent.kind === 'group' ? parent.refId : null;
    let nativeCall = null;
    if (native) {
      if (parent.kind === 'group' && (!targetRef || targetRef === parent.id)) {
        fail('adapter-unsupported', 'Target group is not backed by the drawing store', { field: 'parentId' });
      }
      if (node.kind === 'group' && (!node.refId || node.refId === node.id)) {
        fail('adapter-unsupported', 'Group is not backed by the drawing store', { field: 'id' });
      }
      if (node.kind === 'drawing') {
        if (targetRef === null) {
          if (typeof native.removeFromGroup !== 'function') {
            fail('adapter-unsupported', 'drawings.removeFromGroup is required', { field: 'drawings.removeFromGroup' });
          }
          nativeCall = () => native.removeFromGroup([node.refId]);
        } else {
          if (typeof native.addToGroup !== 'function') {
            fail('adapter-unsupported', 'drawings.addToGroup is required', { field: 'drawings.addToGroup' });
          }
          nativeCall = () => native.addToGroup(targetRef, [node.refId]);
        }
      } else {
        if (typeof native.setGroupParent !== 'function') {
          fail('adapter-unsupported', 'drawings.setGroupParent is required', { field: 'drawings.setGroupParent' });
        }
        nativeCall = () => native.setGroupParent(node.refId, targetRef);
      }
    }

    const map = childMapOf(this.nodes);
    const siblings = map.get(targetParentId) ?? [];
    const insertAt = index === undefined ? siblings.length : Math.max(0, Math.min(Number(index), siblings.length));
    this.pushUndo('move', native ? { nativeCharts: [node.chartId] } : {});
    if (nativeCall) {
      try {
        nativeCall();
      } catch (error) {
        const entry = this.undoStack.pop();
        this.restoreNativeDocuments(entry);
        throw error;
      }
    }
    const oldSiblings = (map.get(node.parentId) ?? []).filter((entry) => entry !== node);
    map.set(node.parentId, oldSiblings);
    const newSiblings = [...(map.get(targetParentId) ?? [])].filter((entry) => entry !== node);
    const boundedIndex = Math.max(0, Math.min(insertAt, newSiblings.length));
    newSiblings.splice(boundedIndex, 0, node);
    map.set(targetParentId, newSiblings);
    const nextNodes = flattenOrder(map);
    try {
      if (node.kind === 'drawing') this.applyDrawingOrder(node.chartId, nextNodes);
    } catch (error) {
      const entry = this.undoStack.pop();
      if (native) this.restoreNativeDocuments(entry);
      throw error;
    }
    node.parentId = targetParentId;
    this.nodes = nextNodes;
    this.emit({ type: 'tree', action: 'move', id, chartId: node.chartId });
    this.render();
  }

  moveBy(id, delta) {
    const node = this.requireNode(id);
    if (!Number.isSafeInteger(delta) || delta === 0) fail('invalid-argument', 'delta must be a non-zero integer', { field: 'delta' });
    if (node.parentId === null) fail('invalid-move', 'A chart root cannot be reordered', { field: 'id' });
    this.assertEditable(node);
    const siblings = this.nodes.filter((entry) => entry.parentId === node.parentId);
    const index = siblings.indexOf(node);
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    this.move(id, { parentId: node.parentId, index: target });
  }

  setVisible(id, visible) {
    const node = this.requireNode(id);
    requireBoolean(visible, 'visible');
    if (node.kind === 'chart') fail('unsupported', 'The chart root cannot be hidden', { field: 'id' });
    if (node.kind === 'alert') fail('alert-managed', 'Alert visibility follows the alert definition', { field: 'id' });
    this.assertEditable(node);
    const native = this.nativeGroupApi(this.getChart(node.chartId));
    if (native && this.nativeGroupTarget(node) && typeof native.setVisibility === 'function') {
      this.pushUndo('visibility', { nativeCharts: [node.chartId] });
      try {
        native.setVisibility(node.refId, visible);
      } catch (error) {
        this.undoStack.pop();
        throw error;
      }
      node.visible = visible;
      this.emit({ type: 'tree', action: 'visibility', id, chartId: node.chartId });
      this.render();
      return;
    }
    this.pushUndo('visibility');
    if (node.kind !== 'group') this.applyExternal(node, { visible }, 'visibility');
    node.visible = visible;
    this.emit({ type: 'tree', action: 'visibility', id, chartId: node.chartId });
    this.render();
  }

  setLocked(id, locked) {
    const node = this.requireNode(id);
    requireBoolean(locked, 'locked');
    this.assertAncestorsUnlocked(node);
    const native = this.nativeGroupApi(this.getChart(node.chartId));
    if (native && this.nativeGroupTarget(node) && typeof native.setLocked === 'function') {
      this.pushUndo('lock', { nativeCharts: [node.chartId] });
      try {
        native.setLocked(node.refId, locked);
      } catch (error) {
        this.undoStack.pop();
        throw error;
      }
      node.locked = locked;
      this.emit({ type: 'tree', action: 'lock', id, chartId: node.chartId });
      this.render();
      return;
    }
    this.pushUndo('lock');
    if (node.kind === 'chart' || node.kind === 'group') {
      node.locked = locked;
    } else {
      this.applyExternal(node, { locked }, 'lock');
      node.locked = locked;
    }
    this.emit({ type: 'tree', action: 'lock', id, chartId: node.chartId });
    this.render();
  }

  toggleVisible(id) {
    this.setVisible(id, !this.requireNode(id).visible);
  }

  toggleLocked(id) {
    this.setLocked(id, !this.requireNode(id).locked);
  }

  /** External adapter effects for drawings, indicators, series and alerts. */
  applyExternal(node, patch, action) {
    const chart = this.getChart(node.chartId);
    if (!chart) fail('unknown-chart', `Unknown chart: ${node.chartId}`, { field: 'chartId' });
    if (node.kind === 'drawing') {
      if (!this.drawingSnapshot(chart, node.refId)) return;
      if (typeof chart.drawings?.update !== 'function') fail('adapter-unsupported', 'drawings.update is required for drawing tree edits', { field: 'drawings.update' });
      const safePatch = {};
      if (patch.visible !== undefined) safePatch.visible = patch.visible;
      if (patch.locked !== undefined) safePatch.locked = patch.locked;
      if (Object.keys(safePatch).length > 0) chart.drawings.update(node.refId, safePatch);
      return;
    }
    if (node.kind === 'indicator') {
      const handle = this.indicatorHandle(chart, node.refId);
      if (patch.locked !== undefined) {
        if (handle && typeof handle.setLocked === 'function') {
          handle.setLocked(patch.locked);
          return;
        }
        fail('adapter-unsupported', `Indicator "${node.refId}" does not expose setLocked`, { field: 'indicator' });
      }
      if (patch.visible !== undefined) {
        if (handle && typeof handle.setVisible === 'function') {
          handle.setVisible(patch.visible);
          return;
        }
        fail('adapter-unsupported', `Indicator "${node.refId}" does not expose setVisible`, { field: 'indicator' });
      }
      fail('adapter-unsupported', `Indicator "${node.refId}" cannot apply ${Object.keys(patch).join(', ')}`, { field: 'indicator' });
    }
    if (node.kind === 'series') {
      if (typeof chart.series?.setVisible === 'function' && patch.visible !== undefined) {
        chart.series.setVisible(node.refId, patch.visible);
        return;
      }
      fail('adapter-unsupported', `Series "${node.refId}" does not expose setVisible`, { field: 'series' });
    }
    fail('alert-managed', 'Alert state is owned by the alerts capability', { field: 'id' });
  }

  /** Capability drawings get() throws for unknown ids; list() is the safe probe. */
  drawingSnapshot(chart, refId) {
    if (typeof chart.drawings?.list === 'function') {
      return chart.drawings.list().find((entry) => entry.id === refId) ?? null;
    }
    if (typeof chart.drawings?.get === 'function') return chart.drawings.get(refId);
    return null;
  }

  indicatorHandle(chart, refId) {
    if (typeof chart.indicator === 'function') {
      const handle = chart.indicator(refId);
      if (handle) return handle;
    }
    if (chart.indicators && typeof chart.indicators.get === 'function') return chart.indicators.get(refId) ?? null;
    return null;
  }

  syncDrawingOrder(chartId) {
    this.applyDrawingOrder(chartId, this.nodes);
  }

  applyDrawingOrder(chartId, nodes) {
    const chart = this.getChart(chartId);
    if (!chart) return;
    const ids = nodes.filter((node) => node.kind === 'drawing' && node.chartId === chartId).map((node) => node.refId);
    if (ids.length < 2) return;
    if (typeof chart.drawings?.setOrder !== 'function') {
      fail('adapter-unsupported', 'drawings.setOrder is required to keep z-order in sync', { field: 'drawings.setOrder' });
    }
    chart.drawings.setOrder(ids);
  }

  requestDelete(id) {
    const node = this.requireNode(id);
    if (node.kind === 'chart') fail('unsupported', 'Remove the chart through workspace.removeChart', { field: 'id' });
    if (node.kind === 'alert') fail('alert-managed', 'Alerts are removed through chart-alerts operations', { field: 'id' });
    const blocked = this.subtree(id).filter((entry) => entry.locked || this.effectiveLocked(entry.id));
    if (blocked.length > 0) {
      const ids = [...new Set(blocked.map((entry) => entry.id))];
      this.emit({
        type: 'error',
        action: 'delete',
        field: 'id',
        chartId: node.chartId,
        message: `Cannot delete "${node.name}": locked object ${ids.join(', ')}`,
        blocked: ids,
      });
      return { id, blocked: ids, pending: false };
    }
    this.pendingDelete = { id };
    this.render();
    return { id, blocked: [], pending: true };
  }

  confirmDelete() {
    if (!this.pendingDelete) fail('invalid-operation', 'No deletion is pending', { field: 'pendingDelete' });
    const { id } = this.pendingDelete;
    this.pendingDelete = null;
    this.deleteNode(id, { confirm: true });
  }

  cancelDelete() {
    this.pendingDelete = null;
    this.render();
  }

  /** Public deletion entry. Requires explicit confirmation. */
  delete(id, options = {}) {
    return this.deleteNode(id, options);
  }

  focusAfterRemoval(node, removedIds, flattenedBefore, indexBefore) {
    const flattenedAfter = this.flattenVisible();
    let nextFocus = null;
    if (indexBefore === -1) {
      nextFocus = node.parentId;
    } else {
      for (let index = Math.max(indexBefore, 0); index < flattenedBefore.length; index += 1) {
        const candidate = flattenedBefore[index];
        if (!removedIds.has(candidate.id) && this.nodes.some((entryNode) => entryNode.id === candidate.id)) {
          nextFocus = candidate.id;
          break;
        }
      }
    }
    if (!nextFocus && flattenedAfter.length > 0) nextFocus = flattenedAfter[flattenedAfter.length - 1].id;
    this.focusedId = nextFocus;
  }

  deleteNode(id, { confirm } = {}) {
    const node = this.requireNode(id);
    if (node.kind === 'chart') fail('unsupported', 'Remove the chart through workspace.removeChart', { field: 'id' });
    if (node.kind === 'alert') fail('alert-managed', 'Alerts are removed through chart-alerts operations', { field: 'id' });
    if (confirm !== true) {
      fail('confirmation-required', `Deleting "${node.name}" requires explicit confirmation`, { field: 'confirm' });
    }
    const subtree = this.subtree(id);
    const blocked = subtree.filter((entry) => entry.locked || this.effectiveLocked(entry.id));
    if (blocked.length > 0) {
      fail('object-locked', `Cannot delete "${node.name}": locked descendant "${blocked[0].name}"`, {
        field: 'id',
        blocked: blocked.map((entry) => entry.id),
      });
    }
    const chart = this.getChart(node.chartId);
    const native = this.nativeGroupApi(chart);
    const nativeGroup = node.kind === 'group' && native && node.refId !== node.id;
    const flattenedBefore = this.flattenVisible();
    const indexBefore = flattenedBefore.findIndex((entry) => entry.id === id);
    if (nativeGroup) {
      if (typeof native.removeGroup !== 'function') {
        fail('adapter-unsupported', 'drawings.removeGroup is required for store-backed groups', {
          field: 'drawings.removeGroup',
        });
      }
      this.pushUndo('delete', { nativeCharts: [node.chartId] });
      try {
        native.removeGroup(node.refId, { confirm: true });
      } catch (error) {
        this.undoStack.pop();
        throw error;
      }
      const removedIds = new Set(subtree.map((candidate) => candidate.id));
      this.nodes = this.nodes.filter((candidate) => !removedIds.has(candidate.id));
      if (this.renamingId && removedIds.has(this.renamingId)) this.renamingId = null;
      if (this.selectedId && removedIds.has(this.selectedId)) this.selectedId = null;
      this.focusAfterRemoval(node, removedIds, flattenedBefore, indexBefore);
      this.emit({ type: 'tree', action: 'delete', id, chartId: node.chartId, removed: [...removedIds] });
      this.render();
      return { id, removed: [...removedIds] };
    }
    const entry = {
      action: 'delete',
      nodes: toJsonClone(this.nodes, 'tree.nodes'),
      selectedId: this.selectedId,
      focusedId: this.focusedId,
      payloads: {},
    };
    const nativeCharts = new Set();
    for (const candidate of subtree) {
      if (candidate.kind !== 'drawing') continue;
      const candidateChart = this.getChart(candidate.chartId);
      if (typeof candidateChart?.drawings?.exportDocument === 'function' || typeof candidateChart?.drawings?.export === 'function') {
        nativeCharts.add(candidate.chartId);
      }
    }
    if (nativeCharts.size > 0) {
      entry.nativeCharts = [...nativeCharts];
      entry.nativeDocuments = this.captureNativeDocuments(nativeCharts);
    }
    const removed = [];
    try {
      for (const candidate of subtree) {
        if (!isExternalKind(candidate.kind)) continue;
        const payload = this.captureExternal(candidate);
        entry.payloads[candidate.id] = payload;
        this.removeExternal(candidate);
        removed.push(candidate);
      }
    } catch (error) {
      for (const candidate of removed.reverse()) {
        const payload = entry.payloads[candidate.id];
        this.restoreExternal(candidate, payload, { silent: true });
      }
      throw error;
    }
    this.undoStack.push(entry);
    if (this.undoStack.length > TREE_UNDO_LIMIT) this.undoStack.shift();
    const removedIds = new Set(subtree.map((candidate) => candidate.id));
    this.nodes = this.nodes.filter((candidate) => !removedIds.has(candidate.id));
    if (this.renamingId && removedIds.has(this.renamingId)) this.renamingId = null;
    if (this.selectedId && removedIds.has(this.selectedId)) this.selectedId = null;

    this.focusAfterRemoval(node, removedIds, flattenedBefore, indexBefore);
    for (const chartId of new Set(subtree.map((candidate) => candidate.chartId))) {
      if (entry.nativeCharts?.includes(chartId)) continue;
      this.syncDrawingOrder(chartId);
    }
    this.emit({ type: 'tree', action: 'delete', id, chartId: node.chartId, removed: [...removedIds] });
    this.render();
    return { id, removed: [...removedIds] };
  }

  captureExternal(node) {
    const chart = this.getChart(node.chartId);
    if (!chart) fail('unknown-chart', `Unknown chart: ${node.chartId}`, { field: 'chartId' });
    if (node.kind === 'drawing') {
      const drawing = this.drawingSnapshot(chart, node.refId);
      if (!drawing) fail('unknown-object', `Drawing "${node.refId}" is not available`, { field: 'refId' });
      return { kind: 'drawing', data: drawing };
    }
    if (node.kind === 'indicator') {
      return { kind: 'indicator', spec: toJsonClone({ ...(node.spec ?? {}), id: node.refId }, 'spec') };
    }
    if (node.kind === 'series') {
      const comparison = this.captureComparison?.(node.chartId, node.refId);
      if (comparison) return { kind: 'comparison', data: comparison };
      const series = typeof chart.series?.list === 'function' ? chart.series.list().find((entry) => entry.id === node.refId) : null;
      if (series && typeof chart.series === 'function') {
        const source = chart.series(node.refId);
        const metadata = source.metadata();
        const descriptor = chart.getState().series.find(entry => entry.id === node.refId);
        return {
          kind: 'series',
          data: {
            type: series.type,
            paneId: series.paneId,
            options: {
              id: series.id, priceScaleId: series.priceScaleId, visible: series.visible,
              ...(descriptor?.title == null ? {} : { title: descriptor.title }),
              ...(descriptor?.lastValueVisible === undefined ? {} : { lastValueVisible: descriptor.lastValueVisible }),
              ...source.options(),
              ...(metadata === null ? {} : { metadata }),
            },
          },
          points: source.data(),
        };
      }
      return { kind: 'series', data: series ?? { id: node.refId } };
    }
    fail('alert-managed', 'Alerts are removed through chart-alerts operations', { field: 'id' });
  }

  removeExternal(node) {
    const chart = this.getChart(node.chartId);
    if (!chart) fail('unknown-chart', `Unknown chart: ${node.chartId}`, { field: 'chartId' });
    if (node.kind === 'drawing') {
      if (typeof chart.drawings?.remove !== 'function') fail('adapter-unsupported', 'drawings.remove is required', { field: 'drawings' });
      chart.drawings.remove(node.refId);
      return;
    }
    if (node.kind === 'indicator') {
      const handle = this.indicatorHandle(chart, node.refId);
      if (!handle || typeof handle.remove !== 'function') fail('adapter-unsupported', `Indicator "${node.refId}" cannot be removed`, { field: 'indicator' });
      handle.remove();
      return;
    }
    if (node.kind === 'series') {
      const comparison = this.captureComparison?.(node.chartId, node.refId);
      if (comparison) {
        this.removeComparison(comparison.spec.id);
        return;
      }
      if (typeof chart.series?.remove !== 'function') fail('adapter-unsupported', 'series.remove is required', { field: 'series' });
      chart.series.remove(node.refId);
      return;
    }
    fail('alert-managed', 'Alerts are removed through chart-alerts operations', { field: 'id' });
  }

  restoreExternal(node, payload, { silent = false } = {}) {
    const chart = this.getChart(node.chartId);
    if (!chart) {
      if (silent) return;
      fail('unknown-chart', `Unknown chart: ${node.chartId}`, { field: 'chartId' });
    }
    try {
      if (payload.kind === 'comparison') {
        if (typeof this.restoreComparison !== 'function') fail('adapter-unsupported', 'Comparison restoration is unavailable', { field: 'comparison' });
        this.restoreComparison(payload.data);
        return;
      }
      if (payload.kind === 'drawing') {
        if (typeof chart.drawings?.add !== 'function') fail('adapter-unsupported', 'drawings.add is required to undo deletion', { field: 'drawings' });
        chart.drawings.add(payload.data);
        return;
      }
      if (payload.kind === 'indicator') {
        if (typeof chart.addIndicator !== 'function') fail('adapter-unsupported', 'addIndicator is required to undo indicator deletion', { field: 'addIndicator' });
        chart.addIndicator(payload.spec);
        return;
      }
      if (payload.kind === 'series') {
        if (typeof chart.series?.add !== 'function') fail('adapter-unsupported', 'series.add is required to undo series deletion', { field: 'series' });
        const restored = chart.series.add(payload.data);
        if (payload.points) restored.setData(payload.points);
        return;
      }
      fail('unsupported', 'This object cannot be restored', { field: 'kind' });
    } catch (error) {
      if (!silent) throw error;
    }
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) fail('undo-unavailable', 'No tree operation to undo', { field: 'undo' });
    const nativeRestored = new Set();
    try {
      for (const chartId of entry.nativeCharts ?? []) {
        const document = entry.nativeDocuments?.[chartId];
        const drawings = this.getChart(chartId)?.drawings;
        const importer =
          typeof drawings?.importDocument === 'function'
            ? (value) => drawings.importDocument(value)
            : typeof drawings?.import === 'function'
              ? (value) => drawings.import(value)
              : null;
        if (!document || !importer) {
          fail('undo-failed', `Cannot restore drawing state for chart "${chartId}"`, { field: 'undo', chartId });
        }
        importer(toJsonClone(document, 'drawings'));
        nativeRestored.add(chartId);
      }
      const current = new Map(this.nodes.map((node) => [node.id, node]));
      const restored = [];
      for (const node of entry.nodes) {
        if (current.has(node.id)) {
          restored.push(toJsonClone(node, 'node'));
          continue;
        }
        if (isExternalKind(node.kind) && !nativeRestored.has(node.chartId)) {
          const payload = entry.payloads?.[node.id];
          if (!payload) fail('undo-failed', `Cannot restore "${node.name}"`, { field: 'undo' });
          this.restoreExternal(node, payload);
        }
        restored.push(toJsonClone(node, 'node'));
      }
      this.nodes = restored;
      this.selectedId = entry.selectedId;
      this.focusedId = entry.focusedId;
      this.renamingId = null;
      this.pendingDelete = null;
      this.applyModelToAdapters(nativeRestored);
      this.emit({ type: 'tree', action: 'undo' });
      this.render();
    } catch (error) {
      this.undoStack.push(entry);
      throw error;
    }
    return this.list();
  }

  applyModelToAdapters(skipCharts = new Set()) {
    for (const chartId of new Set(this.nodes.filter((node) => node.kind === 'chart').map((node) => node.chartId))) {
      const chart = this.getChart(chartId);
      if (!chart) continue;
      const skip = skipCharts.has(chartId);
      const native = this.nativeGroupApi(chart);
      for (const node of this.nodes) {
        if (node.chartId !== chartId) continue;
        if (node.kind === 'drawing') {
          if (skip) continue;
          const exists = this.drawingSnapshot(chart, node.refId);
          if (exists && typeof chart.drawings.update === 'function') {
            chart.drawings.update(node.refId, { visible: node.visible, locked: node.locked });
          }
        } else if (node.kind === 'group' && native && node.refId !== node.id) {
          if (skip) continue;
          if (typeof native.setVisibility === 'function') native.setVisibility(node.refId, node.visible);
          if (typeof native.setLocked === 'function') native.setLocked(node.refId, node.locked);
        } else if (node.kind === 'indicator') {
          const handle = this.indicatorHandle(chart, node.refId);
          if (handle && typeof handle.setVisible === 'function') handle.setVisible(node.visible);
        } else if (node.kind === 'series') {
          if (typeof chart.series?.setVisible === 'function') chart.series.setVisible(node.refId, node.visible);
        }
      }
      if (!skip) {
        try {
          this.syncDrawingOrder(chartId);
        } catch (error) {
          if (error?.code !== 'adapter-unsupported') throw error;
        }
      }
    }
  }

  syncChart(chartId, { preserveEditor = false } = {}) {
    const previousVisible = this.flattenVisible().map(node => node.id);
    const previousFocus = previousVisible.indexOf(this.focusedId);
    const root = this.chartRoot(chartId);
    if (!root) return;
    const chart = this.getChart(chartId);
    if (!chart) return;
    const state = typeof chart.getState === 'function' ? chart.getState() : {};
    const native = this.nativeGroupApi(chart);
    const groupNodeByRef = new Map();
    if (native) {
      if (typeof native.listGroups !== 'function') {
        fail('adapter-unsupported', 'drawings.listGroups must be a function', { field: 'drawings.listGroups' });
      }
      const groups = native.listGroups();
      if (!Array.isArray(groups)) fail('chart-adapter', 'drawings.listGroups() must return an array', { field: 'drawings.listGroups' });
      const nativeRefs = new Set();
      for (const group of groups) {
        if (!isPlainObject(group)) fail('chart-adapter', 'drawing groups must be objects', { field: 'drawings.groups' });
        const refId = group.id === undefined || group.id === null ? '' : String(group.id);
        if (!refId) fail('chart-adapter', 'drawing groups must have stable ids', { field: 'drawings.groups.id' });
        nativeRefs.add(refId);
        const id = this.nativeGroupNodeId(chartId, refId);
        const parentRef = group.parentId === undefined || group.parentId === null ? null : String(group.parentId);
        const parentNodeId = parentRef === null ? root.id : this.nativeGroupNodeId(chartId, parentRef);
        const name = requireString(group.name, `drawings.groups[${refId}].name`, 'chart-adapter');
        const visible = group.visible !== false;
        const locked = group.locked === true;
        let node = this.nodes.find((candidate) => candidate.id === id);
        if (!node) {
          node = { id, kind: 'group', chartId, parentId: parentNodeId, refId, name, visible, locked, expanded: true };
          this.nodes.push(node);
        } else {
          node.name = name;
          node.visible = visible;
          node.locked = locked;
          node.parentId = parentNodeId;
        }
        groupNodeByRef.set(refId, id);
      }
      this.nodes = this.nodes.filter(
        (node) => !(node.kind === 'group' && node.chartId === chartId && node.refId !== node.id && !nativeRefs.has(node.refId)),
      );
      for (const group of groups) {
        const parentRef = group.parentId === undefined || group.parentId === null ? null : String(group.parentId);
        if (parentRef !== null && !nativeRefs.has(parentRef)) {
          fail('chart-adapter', `drawing group "${group.id}" references missing parent "${parentRef}"`, {
            field: 'drawings.groups',
          });
        }
      }
    }

    const drawings = typeof chart.drawings?.list === 'function' ? chart.drawings.list() : [];
    const moduleState = isPlainObject(state.modules) ? state.modules : {};
    const indicators = Array.isArray(state.indicators)
      ? state.indicators
      : Array.isArray(moduleState.indicators)
        ? moduleState.indicators
        : [];
    const indicatorOutputs = new Set(indicators.flatMap(indicator => Object.values(indicator.outputSeries ?? {})));
    const series = (typeof chart.series?.list === 'function' ? chart.series.list() : Array.isArray(state.series) ? state.series : [])
      .filter(entry => !indicatorOutputs.has(entry.id) && !this.isAuxiliarySeries?.(chartId, entry.id));
    const alerts = chart.alerts && typeof chart.alerts.list === 'function' ? chart.alerts.list() : [];
    const collections = [
      ['drawing', drawings],
      ['indicator', indicators],
      ['series', series],
      ['alert', alerts],
    ];
    for (const [kind, entries] of collections) {
      if (!Array.isArray(entries)) continue;
      const desired = new Set();
      for (const entry of entries) {
        if (!isPlainObject(entry)) fail('chart-adapter', `${kind} list entries must be objects`, { field: `${kind}s` });
        const refId = entry.id === undefined || entry.id === null ? '' : String(entry.id);
        if (!refId) fail('chart-adapter', `${kind} entries must have a stable id`, { field: `${kind}s.id` });
        const id = externalNodeId(kind, chartId, refId);
        desired.add(id);
        let node = this.nodes.find((candidate) => candidate.id === id);
        const alertName = kind === 'alert' ? entry.definition?.name : null;
        const name =
          typeof entry.name === 'string' && entry.name
            ? entry.name
            : typeof alertName === 'string' && alertName
              ? alertName
              : typeof entry.type === 'string' && entry.type
                ? `${entry.type} ${refId}`
                : `${KIND_LABEL[kind]} ${refId}`;
        let parentId = root.id;
        if (kind === 'drawing' && native) {
          const groupId = entry.groupId === undefined || entry.groupId === null ? null : String(entry.groupId);
          if (groupId !== null) {
            const groupNodeId = groupNodeByRef.get(groupId);
            if (!groupNodeId) {
              fail('chart-adapter', `drawing "${refId}" references missing group "${groupId}"`, {
                field: `drawings[${refId}].groupId`,
              });
            }
            parentId = groupNodeId;
          }
        }
        if (!node) {
          node = {
            id,
            kind,
            chartId,
            parentId,
            refId,
            name,
            visible: entry.visible !== false,
            locked: entry.locked === true,
            expanded: false,
          };
          if (kind === 'drawing' && Array.isArray(entry.anchors)) {
            node.anchors = entry.anchors.filter(anchor => anchor.anchorBarId !== undefined).map((anchor, index) => normalizeAnchor(anchor, `drawings[${refId}].anchors[${index}]`));
          }
          if (kind === 'indicator') {
            node.spec = toJsonClone(
              entry.spec ?? {
                id: refId,
                type: entry.type ?? refId,
                parameters: entry.parameters ?? {},
                source: entry.source,
                pane: entry.pane,
                style: entry.style ?? {},
              },
              `indicators[${refId}].spec`,
            );
          }
          if (kind === 'alert') {
            node.status = alertStatusText(entry);
            if (entry.evaluation?.sourceError) this.alertSourceErrors.set(id, entry.evaluation.sourceError);
            else this.alertSourceErrors.delete(id);
          }
          this.nodes.push(node);
        } else {
          node.name = name;
          node.visible = entry.visible !== false;
          node.locked = entry.locked === true;
          node.parentId = parentId;
          if (kind === 'drawing' && Array.isArray(entry.anchors)) {
            node.anchors = entry.anchors.filter(anchor => anchor.anchorBarId !== undefined).map((anchor, index) => normalizeAnchor(anchor, `drawings[${refId}].anchors[${index}]`));
          }
          if (kind === 'alert') {
            node.status = alertStatusText(entry);
            if (entry.evaluation?.sourceError) this.alertSourceErrors.set(id, entry.evaluation.sourceError);
            else this.alertSourceErrors.delete(id);
          }
        }
      }
      this.nodes = this.nodes.filter(
        (node) => !(node.kind === kind && node.chartId === chartId && !desired.has(node.id)),
      );
    }
    this.nodes = flattenOrder(childMapOf(this.nodes));
    const liveIds = new Set(this.nodes.map(node => node.id));
    if (this.focusedId && !liveIds.has(this.focusedId)) {
      const visible = this.flattenVisible();
      this.focusedId = visible[Math.min(Math.max(previousFocus, 0), visible.length - 1)]?.id ?? null;
    }
    for (const id of this.alertSourceErrors.keys()) if (!liveIds.has(id)) this.alertSourceErrors.delete(id);
    this.render({ preserveEditor });
  }

  removeChart(chartId) {
    const root = this.chartRoot(chartId);
    if (!root) return;
    const removed = new Set(this.subtree(root.id).map((node) => node.id));
    this.nodes = this.nodes.filter((node) => !removed.has(node.id));
    for (const id of removed) this.alertSourceErrors.delete(id);
    if (this.focusedId && removed.has(this.focusedId)) this.focusedId = null;
    if (this.selectedId && removed.has(this.selectedId)) this.selectedId = null;
    if (this.alertEditor && this.alertEditor.chartId === chartId) this.alertEditor = null;
    for (const entry of this.undoStack) {
      entry.nodes = entry.nodes.filter((node) => node.chartId !== chartId);
      if (entry.payloads) {
        for (const key of Object.keys(entry.payloads)) {
          if (key.startsWith(`chart:${chartId}`) || key.includes(`:${chartId}:`)) delete entry.payloads[key];
        }
      }
    }
    this.emit({ type: 'tree', action: 'remove-chart', chartId });
    this.render();
  }

  handleKey({ key, id, altKey = false, shiftKey = false } = {}) {
    if (typeof key !== 'string') fail('invalid-argument', 'key is required', { field: 'key' });
    const targetId = id ?? this.focusedId;
    if (!targetId) {
      const first = this.flattenVisible()[0];
      if (!first) return { preventDefault: false };
      this.setFocus(first.id);
      return { preventDefault: true };
    }
    const node = this.requireNode(targetId);
    const flattened = this.flattenVisible();
    const index = flattened.findIndex((entry) => entry.id === targetId);
    const moveFocus = (nextIndex) => {
      if (nextIndex < 0 || nextIndex >= flattened.length) return;
      this.focusedId = flattened[nextIndex].id;
      this.render();
    };
    if (altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      this.moveBy(targetId, key === 'ArrowUp' ? -1 : 1);
      return { preventDefault: true };
    }
    if (key === 'ArrowDown') {
      moveFocus(index + 1);
      return { preventDefault: true };
    }
    if (key === 'ArrowUp') {
      moveFocus(index - 1);
      return { preventDefault: true };
    }
    if (key === 'Home') {
      moveFocus(0);
      return { preventDefault: true };
    }
    if (key === 'End') {
      moveFocus(flattened.length - 1);
      return { preventDefault: true };
    }
    if (key === 'ArrowRight') {
      if ((node.kind === 'group' || node.kind === 'chart') && !node.expanded) {
        node.expanded = true;
        this.render();
      } else if ((node.kind === 'group' || node.kind === 'chart') && index + 1 < flattened.length && flattened[index + 1].parentId === node.id) {
        this.setFocus(flattened[index + 1].id);
      }
      return { preventDefault: true };
    }
    if (key === 'ArrowLeft') {
      if ((node.kind === 'group' || node.kind === 'chart') && node.expanded) {
        node.expanded = false;
        this.render();
      } else if (node.parentId) {
        this.setFocus(node.parentId);
        this.render();
      }
      return { preventDefault: true };
    }
    if (key === 'Enter' || key === ' ') {
      this.select(targetId);
      return { preventDefault: true };
    }
    if (key === 'Escape') {
      if (this.renamingId) this.cancelRename();
      else if (this.pendingDelete) this.cancelDelete();
      return { preventDefault: true };
    }
    if (key === 'F2') {
      this.startRename(targetId);
      return { preventDefault: true };
    }
    if (key === 'Delete' || key === 'Backspace') {
      this.requestDelete(targetId);
      return { preventDefault: true };
    }
    if (key.toLowerCase() === 'v') {
      this.toggleVisible(targetId);
      return { preventDefault: true };
    }
    if (key.toLowerCase() === 'l') {
      this.toggleLocked(targetId);
      return { preventDefault: true };
    }
    return { preventDefault: false, shiftKey };
  }

  attach(container, { editorContainer = null } = {}) {
    this.detachDom();
    this.container = container;
    this.editorContainer = editorContainer;
    if (container) {
      this.unlisten.push(
        listen(container, 'click', (event) => this.onClick(event)),
        listen(container, 'keydown', (event) => this.onKeydown(event)),
      );
    }
    this.render();
  }

  onClick(event) {
    const data = event?.target?.dataset ?? {};
    const action = data.action;
    const nodeId = data.nodeId ?? this.focusedId;
    if (action === 'confirm-delete') return this.confirmDelete();
    if (action === 'cancel-delete') return this.cancelDelete();
    if (nodeId) {
      this.setFocus(nodeId);
      this.select(nodeId);
    }
    return undefined;
  }

  onKeydown(event) {
    const data = event?.target?.dataset ?? {};
    if (data.renameInput) {
      if (event.key === 'Enter') {
        const value = event.target.value;
        this.commitRename(value);
        event.preventDefault?.();
      } else if (event.key === 'Escape') {
        this.cancelRename();
        event.preventDefault?.();
      }
      return;
    }
    const result = this.handleKey({
      key: event.key,
      id: data.nodeId ?? this.focusedId,
      altKey: Boolean(event.altKey),
      shiftKey: Boolean(event.shiftKey),
    });
    if (result.preventDefault) event.preventDefault?.();
  }

  detachDom() {
    for (const off of this.unlisten) off();
    this.unlisten = [];
    if (this.container) clearChildren(this.container);
    if (this.editorContainer) clearChildren(this.editorContainer);
    this.container = null;
    this.editorContainer = null;
    this.elements.clear();
  }

  destroy() {
    this.detachDom();
    this.nodes = [];
    this.alertSourceErrors.clear();
    this.undoStack = [];
    this.selectedId = null;
    this.focusedId = null;
    this.pendingDelete = null;
    this.alertEditor = null;
    this.renamingId = null;
  }
}
