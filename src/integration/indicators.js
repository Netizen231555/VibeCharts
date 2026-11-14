import { computeIndicator, listIndicatorTypes } from '../indicators/engine.js';
import { createModuleScope } from '../core/module-scope.js';

function sameFields(left, right) {
  return left !== null && typeof left === 'object' && !Array.isArray(left) &&
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(right).every(key => Object.hasOwn(left, key) && left[key] === right[key]);
}

function stylePatch(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(style))) throw new TypeError('indicator style must be an object');
  for (const [key, value] of Object.entries(style)) {
    if (key !== 'color' && key !== 'lineWidth' && key !== 'upColor' && key !== 'downColor') throw new Error(`Unknown indicator style: ${key}`);
    if (value === undefined) continue;
    if ((key === 'color' || key === 'upColor' || key === 'downColor') && (typeof value !== 'string' || !value)) throw new TypeError(`indicator style ${key} must be a nonempty string`);
    if (key === 'lineWidth' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw new TypeError('indicator style lineWidth must be positive and finite');
  }
  return { ...style };
}

function outputStyle(style, type) {
  // Sign colours exist only on histograms; line outputs of the same indicator ignore them.
  if (type === 'histogram') {
    const { lineWidth, ...histogramStyle } = style;
    return histogramStyle;
  }
  const { upColor, downColor, ...lineStyle } = style;
  return lineStyle;
}

export function attachIndicators(chart, { alerts, chartId, invalidateOnDestroy = true, suppressAlertEffects = () => false } = {}) {
  const instances = new Map();
  let counter = 0, updating = false, pending = null;
  const sourceRef = (id, parameters) => ({
    kind: 'indicator', indicatorId: id,
    ...(chartId ? { chartId } : {}),
    ...(parameters === undefined ? {} : { params: parameters })
  });
  const calculationRef = id => ({ ...sourceRef(id), cause: 'calculation' });
  const sameDefinition = (left, right) => Boolean(left && right &&
    left.type === right.type && left.sourceSeriesId === right.sourceSeriesId &&
    sameFields(left.parameters, right.parameters));
  function notifyAlert(callback) {
    if (chart._restoreEvents) chart._restoreEvents.push({ kind: 'callback', callback });
    else callback();
  }

  function clearCalculationError(instance) {
    if (!instance.computationFailed) return;
    notifyAlert(() => alerts?.markSourceAvailable(calculationRef(instance.id)));
    instance.computationFailed = false;
  }

  function outputMetadata(source, units, parameters) {
    if (!source) return undefined;
    const metadata = { ...source };
    const kind = units === 'source' ? (parameters.sourceField === 'volume' ? 'volume' : 'price') : units;
    if (kind !== 'price') {
      delete metadata.currency;
      delete metadata.priceStep;
      delete metadata.priceUnit;
      if (kind === 'volume') {
        if (source.volumeUnit !== undefined) metadata.priceUnit = source.volumeUnit;
      } else metadata.priceUnit = kind;
    }
    return metadata;
  }
  function rowsFor(sourceId) {
    const points = new Map(chart.series(sourceId).data().map(point => [point.barId, point]));
    return chart.timeline.listSlots().map(slot => ({ ...slot, ...points.get(slot.barId) }));
  }
  function calculate(instance) {
    return computeIndicator(instance.type, instance.parameters, rowsFor(instance.sourceSeriesId));
  }
  function changes(instance, result, sourceMetadata) {
    const metadata = instance.definition;
    return Object.entries(result.outputs).map(([name, points]) => {
      const output = outputMetadata(sourceMetadata, metadata.outputs[name].units, result.parameters);
      return { seriesId: instance.outputSeries[name], operation: 'setData',
        points: points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })),
        ...(output ? { metadata: output } : {}) };
    });
  }
  function reportErrors(instance, result) {
    if (!result.errors.length) {
      if (!suppressAlertEffects()) clearCalculationError(instance);
      return;
    }
    if (!suppressAlertEffects() && !instance.computationFailed) {
      notifyAlert(() => alerts?.markSourceRemoved(calculationRef(instance.id), 'indicator-computation-error'));
      instance.computationFailed = true;
    }
    chart.surface.emit('error', {
      chartId: chart.id, operation: 'indicator', indicatorId: instance.id,
      error: new Error(`Indicator "${instance.id}" calculation failed; inspect its result errors`)
    });
  }
  function refresh(selected = [...instances.values()]) {
    if (updating || selected.length === 0) return;
    const results = selected.map(instance => [instance, calculate(instance)]);
    const series = results.flatMap(([instance, result]) => changes(instance, result, chart.series(instance.sourceSeriesId).metadata()));
    updating = true;
    try { chart.applyBatch({ series }); }
    finally { updating = false; }
    for (const [instance, result] of results) instance.result = result;
    for (const [instance, result] of results) reportErrors(instance, result);
  }
  function add(spec) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new TypeError('indicator spec is required');
    for (const key of Object.keys(spec)) {
      if (!['id', 'type', 'source', 'pane', 'parameters', 'style', 'priceScaleId'].includes(key)) throw new Error(`Unknown indicator option: ${key}`);
    }
    const metadata = listIndicatorTypes().find(item => item.id === spec.type);
    if (!metadata) throw new Error(`Unknown indicator type: ${spec.type}`);
    if (spec.source == null || spec.pane == null) throw new Error('indicator source and pane are required');
    const source = chart._resolveSeries(spec.source, 'chart.addIndicator');
    if (chart._seriesById.get(source.id) !== source || [...instances.values()].some(instance => Object.values(instance.outputSeries).includes(source.id))) {
      throw new Error('indicator source must identify an existing source series');
    }
    const pane = chart._resolvePane(spec.pane, 'chart.addIndicator');
    const sourceSeriesId = source.id;
    const style = Object.fromEntries(Object.entries(stylePatch(spec.style ?? {})).filter(([, value]) => value !== undefined));
    const id = spec.id ?? `indicator-${++counter}`;
    if (typeof id !== 'string' || !id || instances.has(id)) throw new Error('indicator id must be unique and nonempty');
    const instance = { id, type: spec.type, definition: metadata, parameters: spec.parameters ?? {}, sourceSeriesId, paneId: pane.id, style, outputSeries: {}, visible: true, locked: false, result: null };
    const result = calculate(instance);
    const created = [];
    try {
      for (const [name, output] of Object.entries(metadata.outputs)) {
        const type = name === 'histogram' || spec.type === 'volume' || spec.type === 'delta' ? 'histogram' : 'line';
        const outputMeta = outputMetadata(source.metadata(), output.units, result.parameters);
        // Delta is signed, so without an explicit colour it follows the theme rise/fall colours.
        const signDefaults = spec.type === 'delta' && style.color === undefined && style.upColor === undefined && style.downColor === undefined
          ? { upColor: chart._theme.up, downColor: chart._theme.down } : {};
        const series = chart.addSeries(type, { id: `${id}:${name}`, priceScaleId: spec.priceScaleId ?? 'right', title: `${id} ${name}`, ...(outputMeta ? { metadata: outputMeta } : {}), ...signDefaults, ...outputStyle(style, type) }, pane);
        created.push(series);
        instance.outputSeries[name] = series.id;
      }
      updating = true;
      try { chart.applyBatch({ series: changes(instance, result, source.metadata()) }); }
      finally { updating = false; }
    } catch (error) {
      for (const series of created.reverse()) chart.removeSeries(series);
      throw error;
    }
    instance.parameters = result.parameters;
    instance.result = result;
    const handle = {
      id,
      getState: () => ({ id, type: instance.type, parameters: structuredClone(instance.parameters), source: sourceSeriesId, pane: instance.paneId, style: { ...instance.style }, visible: instance.visible, locked: instance.locked, outputSeries: { ...instance.outputSeries } }),
      getResult: () => structuredClone(instance.result),
      getErrors: () => instance.result.errors.map(error => ({ ...error })),
      setParameters(parameters) {
        if (instances.get(id) !== instance) throw new Error(`indicator ${id} has been removed`);
        if (instance.locked) throw new Error(`indicator ${id} is locked`);
        if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('parameters must be an object');
        const result = calculate({ ...instance, parameters: { ...instance.parameters, ...parameters } });
        const previous = { parameters: instance.parameters, result: instance.result };
        instance.parameters = result.parameters;
        instance.result = result;
        updating = true;
        try { chart.applyBatch({ series: changes(instance, result, source.metadata()) }); }
        catch (error) {
          instance.parameters = previous.parameters;
          instance.result = previous.result;
          throw error;
        } finally { updating = false; }
        if (!sameFields(previous.parameters, result.parameters)) {
          alerts?.markSourceRemoved(sourceRef(id, previous.parameters), 'indicator-definition-changed');
        }
        reportErrors(instance, result);
      },
      setStyle(patch) {
        if (instances.get(id) !== instance) throw new Error(`indicator ${id} has been removed`);
        if (instance.locked) throw new Error(`indicator ${id} is locked`);
        const validated = stylePatch(patch);
        for (const seriesId of Object.values(instance.outputSeries)) {
          const series = chart.series(seriesId);
          series.setOptions(outputStyle(validated, series.type));
        }
        const next = { ...instance.style };
        for (const [key, value] of Object.entries(validated)) {
          if (value === undefined) delete next[key];
          else next[key] = value;
        }
        instance.style = next;
      },
      setVisible(value) {
        if (typeof value !== 'boolean') throw new TypeError('visible must be boolean');
        for (const seriesId of Object.values(instance.outputSeries)) chart.series.setVisible(seriesId, value);
        instance.visible = value;
      },
      setLocked(value) { if (typeof value !== 'boolean') throw new TypeError('locked must be boolean'); instance.locked = value; },
      remove() {
        if (instances.get(id) !== instance) return;
        if (instance.locked) throw new Error(`indicator ${id} is locked`);
        instances.delete(id);
        notifyAlert(() => {
          if (!sameDefinition(instance, instances.get(id))) alerts?.markSourceRemoved(sourceRef(id), 'indicator-removed');
        });
        clearCalculationError(instance);
        for (const seriesId of Object.values(instance.outputSeries)) chart.series.remove(seriesId);
      }
    };
    instance.handle = handle;
    instances.set(id, instance);
    reportErrors(instance, result);
    return handle;
  }
  function beginReplacement() {
    if (chart._restoreEvents) throw new Error('Chart transaction already in progress');
    const savedInstances = new Map(instances);
    const failures = new Map([...instances.values()].map(instance => [instance, instance.computationFailed]));
    const savedSeries = new Map(chart._seriesById);
    const panes = chart._panes.map(pane => ({
      pane, series: [...pane.series], scales: [...pane.priceScales],
    }));
    chart._restoreEvents = [];
    let active = true;
    return {
      commit() {
        if (!active) throw new Error('Indicator transaction is no longer active');
        active = false;
        const events = chart._restoreEvents;
        chart._restoreEvents = null;
        for (const event of events) {
          if (event.kind === 'hook' && event.name === 'onSeriesRemoved') {
            const owner = [...savedInstances.values()].find(instance => Object.values(instance.outputSeries).includes(event.payload.id));
            if (owner && sameDefinition(owner, instances.get(owner.id)) && chart._seriesById.has(event.payload.id)) continue;
          }
          if (event.kind === 'hook') chart._notifyModules(event.name, event.payload);
          else if (event.kind === 'callback') {
            try { event.callback(); } catch (error) { chart._reportError(error, 'indicatorNotification'); }
          } else chart._emit(event.name, event.payload);
        }
      },
      rollback() {
        if (!active) throw new Error('Indicator transaction is no longer active');
        active = false;
        chart._restoreEvents = null;
        instances.clear();
        for (const [id, instance] of savedInstances) instances.set(id, instance);
        for (const [instance, failed] of failures) instance.computationFailed = failed;
        chart._seriesById.clear();
        for (const [id, series] of savedSeries) chart._seriesById.set(id, series);
        for (const { pane, series, scales } of panes) {
          pane.series.clear();
          for (const item of series) pane.series.add(item);
          pane.priceScales.clear();
          for (const [id, scale] of scales) pane.priceScales.set(id, scale);
        }
        chart._refreshPriceScales();
        chart.requestRender();
      },
    };
  }
  const api = { add, get: id => instances.get(id)?.handle ?? null, list: () => [...instances.values()].map(instance => instance.handle.getState()), beginReplacement };
  const scope = createModuleScope(chart, 'indicators', api, { results: { add: {}, get: {} } });
  const detach = chart.attach({ name: 'indicators', api: scope.api, hooks: {
    onExportState: () => api.list(),
    onValidateRestore(snapshot) {
      const saved = snapshot.modules?.indicators;
      if (saved === undefined) return;
      if (!Array.isArray(saved) || saved.length !== instances.size) throw new Error('Restore requires the same indicator instances to be staged first');
      const seen = new Set();
      for (const entry of saved) {
        const instance = instances.get(entry?.id);
        if (!instance || seen.has(entry.id) || entry.type !== instance.type || entry.source !== instance.sourceSeriesId ||
            entry.pane !== instance.paneId || !sameFields(entry.parameters, instance.parameters) || !sameFields(entry.style, instance.style) ||
            !sameFields(entry.outputSeries, instance.outputSeries) ||
            typeof entry.visible !== 'boolean' || typeof entry.locked !== 'boolean') {
          throw new Error(`Cannot restore indicator ${entry?.id ?? ''}: incompatible or unstaged instance`);
        }
        seen.add(entry.id);
      }
    },
    onRestoreState(snapshot) {
      for (const entry of snapshot.modules?.indicators ?? []) {
        const handle = instances.get(entry.id).handle;
        handle.setVisible(entry.visible);
        handle.setLocked(entry.locked);
      }
    },
    onBeforeDataCommit(change) {
      pending = null;
      if (updating || instances.size === 0) return;
      const oldSlots = change.kind === 'replace' || change.timelineOp === 'remove' ? null : chart.timeline.listSlots();
      const slots = change.kind === 'replace' || change.timelineOp === 'remove' ? change.slots :
        change.timelineOp === 'prepend' ? [...change.slots, ...oldSlots] :
        change.timelineOp === 'append' ? [...oldSlots, ...change.slots] : oldSlots;
      const input = new Map(change.series.map(entry => [entry.series.id, entry.prepared]));
      const contributions = [], results = [];
      for (const instance of instances.values()) {
        const source = input.get(instance.sourceSeriesId);
        if (change.kind !== 'replace' && !change.timelineOp && !source) continue;
        for (const outputId of Object.values(instance.outputSeries)) {
          if (input.has(outputId)) throw new Error(`Indicator output ${outputId} is managed by the indicator`);
        }
        const current = change.kind === 'replace' ? [] : chart.series(instance.sourceSeriesId).data();
        const data = new Map((source?.operation === 'setData' ? [] : current).map(point => [point.barId, point]));
        for (const point of source?.points ?? []) data.set(point.barId, point);
        const rows = slots.map(slot => ({ ...slot, ...data.get(slot.barId) }));
        const result = computeIndicator(instance.type, instance.parameters, rows);
        results.push([instance, result]);
        contributions.push(...changes(instance, result, source?.metadata ?? chart.series(instance.sourceSeriesId).metadata()));
      }
      pending = results;
      return contributions;
    },
    onDataChange() {
      if (updating || !pending) return;
      const completed = pending;
      pending = null;
      for (const [instance, result] of completed) instance.result = result;
      for (const [instance, result] of completed) reportErrors(instance, result);
    },
    onTimelineChange: change => { if (!change.precommitted) refresh(); },
    onHistoryRemoved: change => { if (!change.precommitted) refresh(); },
    onReset: () => refresh(),
    onHistoryPreview: plan => ({ affectsIndicators: instances.size > 0 && plan.removedBarIds.length > 0 }),
    onBeforeSeriesRemove(series) {
      if ([...instances.values()].some(instance => Object.values(instance.outputSeries).includes(series.id))) {
        throw new Error('Remove the indicator before removing its output series');
      }
    },
    onSeriesRemoved(series) {
      for (const instance of [...instances.values()]) {
        if (instance.sourceSeriesId !== series.id) continue;
        instances.delete(instance.id);
        alerts?.markSourceRemoved(sourceRef(instance.id), 'indicator-removed');
        clearCalculationError(instance);
        for (const seriesId of Object.values(instance.outputSeries)) chart.series.remove(seriesId);
      }
    },
    onDestroy() {
      try {
        if (invalidateOnDestroy) {
          for (const instance of instances.values()) {
            alerts?.markSourceRemoved(sourceRef(instance.id), 'indicator-removed');
            clearCalculationError(instance);
          }
        }
        instances.clear();
      } finally {
        scope.dispose();
      }
    }
  } });
  let detachAdd;
  try {
    detachAdd = chart.attach({ name: 'addIndicator', api: scope.api.add });
    const detachGet = chart.attach({ name: 'indicator', api: scope.api.get });
    return () => { detachGet(); detachAdd(); detach(); };
  } catch (error) { detachAdd?.(); detach(); throw error; }
}
