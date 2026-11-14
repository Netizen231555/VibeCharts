/**
 * Semantic display model for local alerts.
 *
 * This module deliberately contains no DOM, no HTML strings, and no rendering
 * choices. Every user-supplied string (alert name, indicator id, series id) is
 * emitted as a `{ text, external: true }` value. Consumers MUST insert it with
 * `textContent`-style APIs and MUST NOT parse it as markup. The model is frozen
 * so a renderer cannot mutate alert state through it.
 */
import { AlertError } from './errors.js';

const OPERATION_LABELS = Object.freeze({
  above: 'is above',
  below: 'is below',
  crossUp: 'crosses up through',
  crossDown: 'crosses down through'
});

const MODE_LABELS = Object.freeze({
  once: 'Once',
  repeating: 'Repeating'
});

const STATUS_LABELS = Object.freeze({
  active: 'Active',
  paused: 'Paused',
  completed: 'Completed',
  expired: 'Expired',
  error: 'Error',
  unknown: 'Unknown'
});

const ACTION_IDS = Object.freeze(['edit', 'pause', 'resume', 'delete']);

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** External text is data, never markup. */
function externalText(value, fallback = '') {
  if (typeof value === 'string') return { text: value, external: true };
  if (value === null || value === undefined) return { text: fallback, external: true };
  return { text: String(value), external: true };
}

function plainText(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function numberText(value) {
  return Number.isFinite(value) ? String(value) : '';
}

function paramsText(params) {
  if (!params || typeof params !== 'object') return '';
  const keys = Object.keys(params).sort();
  return keys.map(key => `${key}=${JSON.stringify(params[key])}`).join(', ');
}

function describeSource(source, role) {
  const units = source.units ?? null;
  if (source.kind === 'series') {
    return freeze({
      role,
      kind: 'series',
      key: `series:${source.seriesId}:${source.field}`,
      text: `Series "${source.seriesId}" ${source.field}${units ? ` (${units})` : ''}`,
      external: true,
      units
    });
  }
  if (source.kind === 'indicator') {
    const params = paramsText(source.params);
    return freeze({
      role,
      kind: 'indicator',
      key: `indicator:${source.indicatorId}:${source.output}@${source.semanticVersion}`,
      text: `Indicator "${source.indicatorId}" ${source.formula}(${params}) ${source.output} v${source.semanticVersion}` +
        (units ? ` (${units})` : ''),
      external: true,
      units
    });
  }
  if (source.kind === 'constant') {
    return freeze({
      role,
      kind: 'constant',
      key: 'constant',
      text: `Constant ${numberText(source.value)}${units ? ` ${units}` : ''}`,
      external: true,
      units,
      value: source.value
    });
  }
  const points = source.drawingType === 'horizontal'
    ? `${source.price}`
    : source.points.map(point =>
        `${point.anchorBarId}${point.offset >= 0 ? '+' : ''}${point.offset}@${point.price}`
      ).join(' -> ');
  const scaleText = source.drawingType === 'horizontal' ? '' : `${source.scale} `;
  const labels = {
    horizontal: 'Horizontal level',
    segment: 'Segment',
    ray: 'Ray'
  };
  return freeze({
    role,
    kind: 'drawing',
    key: `drawing:${source.drawingType}`,
    text: `${labels[source.drawingType]} ${scaleText}${points}${units ? ` (${units})` : ''}`,
    external: true,
    units,
    drawingType: source.drawingType,
    scale: source.scale ?? null
  });
}

function ruleText(definition) {
  const left = describeSource(definition.left, 'left').text;
  const right = describeSource(definition.right, 'right').text;
  const operation = OPERATION_LABELS[definition.operation] ?? definition.operation;
  return `${left} ${operation} ${right}`;
}

/**
 * A linear or logarithmic price line for a horizontal/constant threshold.
 * For a comparison between two dynamic sources there is no line; callers get a
 * comparison model instead of a fabricated price.
 *
 * When a log scale is requested and the stored price is non-positive the line
 * is not displayable; the stored value is still reported unchanged.
 */
export function alertLineModel(record, options = {}) {
  const definition = record.definition;
  const scale = options.scale === 'log' ? 'log' : 'linear';
  let threshold = null;
  if (definition.right.kind === 'constant' || definition.right.kind === 'drawing') {
    threshold = definition.right;
  } else if (definition.left.kind === 'constant' || definition.left.kind === 'drawing') {
    threshold = definition.left;
  }
  if (!threshold) {
    return freeze({
      kind: 'comparison',
      alertId: definition.id,
      alertName: externalText(definition.name ?? definition.id),
      displayable: true,
      reason: null,
      text: ruleText(definition),
      scale,
      value: null,
      units: definition.right.units ?? definition.left.units ?? null,
      status: record.evaluation.status
    });
  }
  let value = null;
  let drawingKind = null;
  if (threshold.kind === 'constant') {
    value = threshold.value;
  } else {
    drawingKind = threshold.drawingType;
    // A constant horizontal drawing has one price. Inclined drawings have a
    // threshold at a bar, not at a fixed level, so they are represented as a
    // comparison line only.
    if (threshold.drawingType !== 'horizontal') {
      return freeze({
        kind: 'comparison',
        displayable: true,
        reason: null,
        text: ruleText(definition),
        scale,
        value: null,
        units: threshold.units ?? null,
        status: record.evaluation.status,
        drawingType: null
      });
    }
    value = threshold.price;
  }
  const invalidLog = scale === 'log' && !(typeof value === 'number' && value > 0);
  return freeze({
    kind: 'level',
    alertId: definition.id,
    alertName: externalText(definition.name ?? definition.id),
    source: describeSource(threshold, 'threshold'),
    displayable: !invalidLog,
    reason: invalidLog ? 'log-scale-requires-positive-level' : null,
    text: invalidLog
      ? `${ruleText(definition)} (line hidden: log scale requires a positive level)`
      : ruleText(definition),
    scale,
    value,
    units: threshold.units ?? null,
    status: record.evaluation.status,
    drawingType: drawingKind
  });
}

function actionList(record, labels) {
  const name = plainText(record.definition.name, record.definition.id);
  const paused = record.evaluation.status === 'paused';
  return freeze([
    {
      id: 'edit',
      role: 'button',
      label: labels.edit ?? 'Edit',
      ariaLabel: `Edit alert ${name}`,
      tabIndex: 0
    },
    {
      id: paused ? 'resume' : 'pause',
      role: 'button',
      label: paused ? (labels.resume ?? 'Resume') : (labels.pause ?? 'Pause'),
      ariaLabel: `${paused ? 'Resume' : 'Pause'} alert ${name}`,
      tabIndex: 0
    },
    {
      id: 'delete',
      role: 'button',
      label: labels.delete ?? 'Delete',
      ariaLabel: `Delete alert ${name}`,
      tabIndex: 0
    }
  ]);
}

/**
 * One semantic list row and keyboard target. `selected` is renderer state; all
 * mutation still goes through the engine revision checks.
 */
export function describeAlert(record, options = {}) {
  const definition = record.definition;
  const name = plainText(definition.name, definition.id);
  const status = record.evaluation.status;
  const statusInfo = {
    status,
    reason: record.evaluation.reason,
    sourceError: record.evaluation.sourceError ? externalText(record.evaluation.sourceError) : null,
    completed: record.evaluation.completed === true,
    delivery: record.delivery ?? null
  };
  return freeze({
    id: definition.id,
    revision: definition.revision,
    selected: options.selected === true,
    name: externalText(name),
    authority: definition.authority,
    status,
    statusLabel: STATUS_LABELS[status] ?? status,
    rule: {
      operation: definition.operation,
      operationLabel: OPERATION_LABELS[definition.operation] ?? definition.operation,
      text: ruleText(definition)
    },
    mode: {
      code: definition.mode,
      label: MODE_LABELS[definition.mode] ?? definition.mode
    },
    observationMode: definition.observationMode,
    hysteresis: definition.hysteresis,
    sources: [
      describeSource(definition.left, 'left'),
      describeSource(definition.right, 'right')
    ],
    state: statusInfo,
    actions: actionList(record, options.labels ?? {}),
    line: alertLineModel(record, options),
    keyboard: {
      role: 'option',
      tabIndex: 0,
      ariaLabel: `${name}, ${definition.operation}, ${STATUS_LABELS[status] ?? status}`,
      ariaSelected: options.selected === true,
      controls: 'alert-editor'
    }
  });
}

/**
 * Stateful presentation adapter over an alert engine. It never evaluates
 * alerts, never sends network requests, and never builds markup.
 */
export function createAlertListModel(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('createAlertListModel: options object is required');
  }
  const { engine } = options;
  if (!engine || typeof engine.list !== 'function' || typeof engine.get !== 'function' ||
      typeof engine.subscribe !== 'function') {
    throw new TypeError('createAlertListModel: engine must provide list/get/subscribe');
  }
  if (options.onError !== undefined && typeof options.onError !== 'function') {
    throw new TypeError('createAlertListModel: onError must be a function');
  }
  const labels = Object.freeze({ ...(options.labels ?? {}) });
  let scale = options.scale === 'log' ? 'log' : 'linear';
  let selectedId = options.selectedId ?? null;
  if (selectedId !== null && typeof selectedId !== 'string') {
    throw new TypeError('createAlertListModel: selectedId must be a string or null');
  }
  function hasAlert(id) {
    return engine.list().some(record => record.id === id);
  }
  if (selectedId !== null && !hasAlert(selectedId)) selectedId = null;
  const listeners = new Set();
  const errorsByAlert = new Map();
  let listenerErrorCount = 0;
  let lastListenerError = null;

  function editorErrors(id) {
    return errorsByAlert.get(id) ?? null;
  }

  function snapshot() {
    return engine.list().map(record =>
      describeAlert(record, { selected: record.id === selectedId, labels, scale })
    );
  }

  function notify(event) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        listenerErrorCount += 1;
        lastListenerError = error;
        if (options.onError) {
          try { options.onError({ operation: 'alert-ui-listener', error }); }
          catch (reportError) { lastListenerError = new AggregateError([error, reportError], 'alert UI error reporter failed'); }
        }
      }
    }
  }

  const unsubscribeEngine = engine.subscribe(event => {
    if (selectedId !== null && !hasAlert(selectedId)) selectedId = null;
    notify({ type: 'alerts-changed', event });
  });

  return freeze({
    list() {
      return freeze(snapshot());
    },
    get(id) {
      const record = engine.get(id);
      return record ? describeAlert(record, { selected: id === selectedId, labels, scale }) : null;
    },
    selectedId() {
      return selectedId;
    },
    select(id) {
      if (id !== null && (typeof id !== 'string' || !hasAlert(id))) return null;
      selectedId = id;
      notify({ type: 'selection-changed', selectedId });
      return selectedId;
    },
    line(id, nextOptions = {}) {
      const record = engine.get(id);
      if (!record) return null;
      return alertLineModel(record, {
        scale: nextOptions.scale === 'log' || nextOptions.scale === 'linear' ? nextOptions.scale : scale
      });
    },
    setScale(nextScale) {
      scale = nextScale === 'log' ? 'log' : 'linear';
      notify({ type: 'scale-changed', scale });
    },
    edit(id, patch, expectedRevision) {
      try {
        const updated = engine.update(id, patch, expectedRevision);
        errorsByAlert.delete(id);
        notify({ type: 'edit-errors', alertId: id });
        return describeAlert(updated, { selected: id === selectedId, labels, scale });
      } catch (error) {
        if (error instanceof AlertError) {
          const fields = error.fields.map((field, index) => {
            const errorId = `alert-error-${encodeURIComponent(id)}-${encodeURIComponent(field.path)}-${index}`;
            return {
              path: field.path,
              message: externalText(field.message),
              errorId,
              ariaInvalid: true,
              ariaDescribedBy: errorId
            };
          });
          errorsByAlert.set(id, freeze({
            message: externalText(error.message),
            role: 'alert',
            fields
          }));
          notify({ type: 'edit-errors', alertId: id });
        }
        throw error;
      }
    },
    editorErrors(id) {
      return editorErrors(id);
    },
    pause(id, expectedRevision) {
      return describeAlert(engine.pause(id, expectedRevision), { selected: id === selectedId, labels, scale });
    },
    resume(id, expectedRevision) {
      return describeAlert(engine.resume(id, expectedRevision), { selected: id === selectedId, labels, scale });
    },
    remove(id) {
      const removed = engine.remove(id);
      errorsByAlert.delete(id);
      if (selectedId === id) selectedId = null;
      return { removed: removed?.removed === true, id };
    },
    getKeyboardTargets() {
      const targets = [];
      for (const entry of snapshot()) {
        targets.push({ kind: 'alert', id: entry.id, role: 'option', tabIndex: 0, ariaLabel: entry.keyboard.ariaLabel });
        for (const action of entry.actions) {
          targets.push({
            kind: 'action',
            id: `${entry.id}:${action.id}`,
            alertId: entry.id,
            action: action.id,
            role: 'button',
            tabIndex: 0,
            ariaLabel: action.ariaLabel
          });
        }
      }
      return freeze(targets);
    },
    getDiagnostics() {
      return { listenerErrorCount, lastListenerError };
    },
    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('subscribe: listener must be a function');
      }
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
      };
    },
    dispose() {
      unsubscribeEngine();
      listeners.clear();
    }
  });
}

export { ACTION_IDS, OPERATION_LABELS, MODE_LABELS, STATUS_LABELS, describeSource };
