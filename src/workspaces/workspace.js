import { WorkspaceError, fail } from './errors.js';
import {
  clearChildren,
  createElement,
  documentOf,
  removeElement,
  setAttr,
  setStyle,
} from './dom.js';
import { isPlainObject, requireString, toJsonClone } from './util.js';
import { cellStyle, normalizeLayout, placeNewChart } from './layout.js';
import { anchorFromLogical, logicalFromAnchor, readScale } from './anchors.js';
import { createSyncController } from './sync.js';
import { TreeStore } from './tree.js';
import { STATE_KIND, STATE_VERSION, validateSnapshot } from './state.js';
import { TEMPLATE_KINDS, TEMPLATE_VERSION, validateTemplateDocument, validateTheme } from './templates.js';
import { comparisonFromState, computeComparison, computePrimaryComparison, normalizeComparison, readPrimaryComparison } from './comparison.js';
import { createMarkerView, validateMarkerCoordinates, validateMarkerSet } from './markers.js';
import { exportChartPng } from './png.js';

const EMPTY_LAYOUT = () => ({ type: 'grid', rows: 1, columns: 1, cells: [] });
const REQUIRED_ADAPTER_METHODS = [
  'subscribe',
  'indexScale',
  'priceScale',
  'applyOptions',
  'addIndicator',
  'getState',
  'restoreState',
  'destroy',
];

/**
 * Multi-chart workspace. The host owns the container, the chart factory, data,
 * storage and synchronisation mappings; the workspace owns layout, object tree,
 * templates, comparisons, markers and PNG export for its charts.
 */
export function createWorkspace(container, options = {}) {
  if (!container || typeof container !== 'object') fail('invalid-argument', 'container is required', { field: 'container' });
  if (!documentOf(container) || typeof documentOf(container).createElement !== 'function') {
    fail('invalid-argument', 'container must belong to a document with createElement', { field: 'container' });
  }
  if (!isPlainObject(options)) fail('invalid-argument', 'options must be an object', { field: 'options' });
  if (typeof options.createChart !== 'function') {
    fail('invalid-argument', 'options.createChart must be a function', { field: 'createChart' });
  }
  if (options.onChange !== undefined && typeof options.onChange !== 'function') {
    fail('invalid-argument', 'options.onChange must be a function', { field: 'onChange' });
  }
  if (options.theme !== undefined && !isPlainObject(options.theme)) {
    fail('invalid-argument', 'options.theme must be an object', { field: 'theme' });
  }
  if (options.clusterDistance !== undefined && (!Number.isSafeInteger(options.clusterDistance) || options.clusterDistance < 0)) {
    fail('invalid-argument', 'options.clusterDistance must be a non-negative integer', { field: 'clusterDistance' });
  }

  let charts = new Map();
  const comparisons = new Map();
  const markerState = new Map();
  const listeners = new Set();
  const syncControllers = new Set();
  const syncGroupOwners = new Map();
  let layout = EMPTY_LAYOUT();
  let theme = options.theme === undefined ? {} : toJsonClone(options.theme, 'theme');
  let preferences = {};
  let destroyed = false;
  let lastStatus = '';
  let lastAlert = '';

  const root = createElement(container, 'div', {
    className: 'cw-workspace',
    attributes: { 'data-workspace': 'chart-workspace' },
  });
  if (root?.dataset) root.dataset.workspace = 'chart-workspace';
  const grid = createElement(root, 'div', {
    className: 'cw-grid',
    attributes: { role: 'group', 'aria-label': 'Chart workspace layout' },
  });
  const sidebar = createElement(root, 'aside', { className: 'cw-sidebar', attributes: { 'aria-label': 'Workspace objects' } });
  const treeHost = createElement(sidebar, 'div', { className: 'cw-tree-host' });
  const comparisonHost = createElement(sidebar, 'section', { className: 'cw-comparisons', attributes: { 'aria-label': 'Chart comparisons' } });
  const alertHost = createElement(sidebar, 'div', { className: 'cw-alert-host' });
  const statusHost = createElement(sidebar, 'div', {
    className: 'cw-announcer cw-status',
    attributes: { role: 'status', 'aria-live': 'polite' },
  });
  const alertAnnouncer = createElement(sidebar, 'div', {
    className: 'cw-announcer cw-alert',
    attributes: { role: 'alert', 'aria-live': 'assertive' },
  });
  const templateActions = createElement(sidebar, 'div', { className: 'cw-template-actions', attributes: { 'aria-label': 'Workspace actions' } });

  function announce(message, { error = false } = {}) {
    const text = String(message);
    if (error) {
      lastAlert = text;
      if (alertAnnouncer) alertAnnouncer.textContent = text;
    } else {
      lastStatus = text;
      if (statusHost) statusHost.textContent = text;
    }
  }

  function emit(event) {
    if (destroyed && event?.type !== 'destroy') return;
    if (event && ['comparison', 'chartRemoved', 'restore'].includes(event.type)) renderComparisons();
    if (event?.type === 'error' && event.message) announce(event.message, { error: true });
    const payload = { ...event };
    for (const listener of [...listeners]) listener(payload);
    if (typeof options.onChange === 'function') options.onChange({ ...payload });
  }
  function renderComparisons() {
    if (!comparisonHost) return;
    const active = comparisonHost.ownerDocument?.activeElement;
    const focusedId = active?.dataset?.comparisonId;
    const focusedAction = active?.dataset?.comparisonAction;
    const hadFocus = comparisonHost.contains?.(active) === true;
    let restoreFocus = null;
    let firstControl = null;
    clearChildren(comparisonHost);
    if (!comparisons.size) {
      if (hadFocus) {
        comparisonHost.setAttribute('tabindex', '-1');
        comparisonHost.focus?.();
      }
      return;
    }
    createElement(comparisonHost, 'h2', { text: 'Comparisons' });
    const list = createElement(comparisonHost, 'ul', { attributes: { 'aria-label': 'Comparisons' } });
    for (const comparison of comparisons.values()) {
      const entry = charts.get(comparison.chartId);
      if (!entry) continue;
      const result = computeComparison(comparison, entry.instance);
      const primary = comparison.primary ? computePrimaryComparison(entry.instance, comparison.primary, comparison.baseSlot) : null;
      const item = createElement(list, 'li');
      const name = createElement(item, 'span');
      name.textContent = `${comparison.name} (${comparison.chartId}): ${result.normalization === 'available' ? 'available' : `unavailable: ${result.reason}`}`;
      if (primary) {
        const primaryStatus = createElement(item, 'span');
        primaryStatus.textContent = `; primary: ${primary.normalization === 'available' ? 'available' : `unavailable: ${primary.reason}`}`;
      }
      if (comparison.mode === 'percent') {
        const label = createElement(item, 'label');
        label.textContent = ` Base slot for ${comparison.name} `;
        const select = createElement(label, 'select', { attributes: { 'aria-label': `Base slot for ${comparison.name}` } });
        select.dataset.comparisonId = comparison.id;
        select.dataset.comparisonAction = 'base';
        const { slots } = readScale(entry.instance.indexScale());
        if (!slots.some(slot => slot.barId === comparison.baseSlot)) {
          const option = createElement(select, 'option');
          option.value = comparison.baseSlot;
          option.textContent = `${comparison.baseSlot} (unavailable)`;
        }
        for (const slot of slots) {
          const option = createElement(select, 'option');
          option.value = slot.barId;
          option.textContent = slot.barId;
        }
        select.value = comparison.baseSlot;
        select.addEventListener('change', () => {
          try { setComparisonBase(comparison.id, select.value); }
          catch (error) { emit({ type: 'error', action: 'comparisonBase', chartId: comparison.chartId, message: error.message }); renderComparisons(); }
        });
        firstControl ??= select;
        if (focusedId === comparison.id && focusedAction === 'base') restoreFocus = select;
      }
      const remove = createElement(item, 'button', { attributes: { type: 'button', 'aria-label': `Remove comparison ${comparison.name}` } });
      remove.textContent = 'Remove';
      remove.dataset.comparisonId = comparison.id;
      remove.dataset.comparisonAction = 'remove';
      remove.addEventListener('click', () => {
        try { removeComparison(comparison.id); }
        catch (error) { emit({ type: 'error', action: 'comparisonRemove', chartId: comparison.chartId, message: error.message }); }
      });
      firstControl ??= remove;
      if (focusedId === comparison.id && focusedAction === 'remove') restoreFocus = remove;
    }
    if (hadFocus) (restoreFocus ?? firstControl ?? comparisonHost).focus?.();
  }


  function assertAlive(operation) {
    if (destroyed) fail('destroyed', `Cannot ${operation}: workspace is destroyed`, { field: 'workspace' });
  }

  function getChart(chartId) {
    const entry = charts.get(chartId);
    return entry && entry.alive ? entry.instance : null;
  }

  function requireChart(chartId, field = 'chartId') {
    requireString(chartId, field);
    const entry = charts.get(chartId);
    if (!entry) fail('unknown-chart', `Unknown chart: ${chartId}`, { field });
    return entry;
  }

  function assertChartAdapter(chartId, instance) {
    if (!instance || typeof instance !== 'object') fail('chart-adapter', `Chart factory returned no chart for "${chartId}"`, { field: 'createChart' });
    for (const method of REQUIRED_ADAPTER_METHODS) {
      if (typeof instance[method] !== 'function') {
        fail('chart-adapter', `Chart "${chartId}" adapter is missing ${method}()`, { field: `chart.${method}`, chartId });
      }
    }
    if (!instance.drawings || typeof instance.drawings !== 'object') {
      fail('chart-adapter', `Chart "${chartId}" adapter is missing drawings`, { field: 'chart.drawings', chartId });
    }
    if (!instance.alerts || typeof instance.alerts !== 'object') {
      fail('chart-adapter', `Chart "${chartId}" adapter is missing alerts`, { field: 'chart.alerts', chartId });
    }
  }

  function createCell(chartId) {
    const cell = createElement(grid, 'div', {
      className: 'cw-cell',
      attributes: { 'data-chart-id': chartId, role: 'group', 'aria-label': `Chart ${chartId}` },
    });
    if (cell?.dataset) cell.dataset.chartId = chartId;
    setStyle(cell, { position: 'relative' });
    const mount = createElement(cell, 'div', { className: 'cw-chart-mount' });
    const markerHost = createElement(cell, 'div', { className: 'cw-marker-host' });
    setStyle(markerHost, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    const restoreStatus = createElement(cell, 'div', { className: 'cw-restore-status', attributes: { role: 'status', 'aria-live': 'polite' } });
    setStyle(restoreStatus, { position: 'absolute', left: '0', top: '0' });
    return { cell, mount, markerHost, restoreStatus };
  }

  function createChartEntry(chartId, chartOptions) {
    const parts = createCell(chartId);
    let instance;
    try {
      instance = options.createChart(parts.mount, { ...chartOptions });
      assertChartAdapter(chartId, instance);
    } catch (error) {
      removeElement(parts.cell);
      throw error;
    }
    return { id: chartId, instance, ...parts, alive: true, markerView: null, options: { ...chartOptions } };
  }

  function queueTreeRefresh(entry) {
    if (entry.treeRefreshQueued || destroyed || !entry.alive) return;
    entry.treeRefreshQueued = true;
    queueMicrotask(() => {
      entry.treeRefreshQueued = false;
      if (destroyed || !entry.alive) return;
      try {
        tree.syncChart(entry.id, { preserveEditor: true });
      } catch (error) {
        emit({ type: 'error', action: 'treeRefresh', chartId: entry.id, message: error.message });
      }
    });
  }

  function resolveRestoredViewport(entry) {
    if (!entry.restorePending) return;
    const scale = entry.instance.indexScale();
    const slots = readScale(scale).slots;
    const range = entry.restorePending.range;
    if (slots.length === 0) {
      entry.restoreStatus.textContent = entry.restorePending.received ? 'Chart data unavailable' : 'Waiting for chart data';
      return;
    }
    if (range) {
      const from = logicalFromAnchor(scale, range.from);
      const to = logicalFromAnchor(scale, range.to);
      if (from === null || to === null || from >= to) {
        entry.restoreStatus.textContent = 'Saved chart viewport is unavailable';
        return;
      }
      try { scale.setVisibleRange({ from, to }); } catch {
        entry.restoreStatus.textContent = 'Saved chart viewport is unavailable';
        return;
      }
    }
    entry.restorePending = null;
    entry.restoreStatus.textContent = '';
  }

  function attachMarkers(entry) {
    if (entry.markerView) return entry.markerView;
    entry.unsubscribeTreeData = entry.instance.subscribe('datachange', event => {
      if (entry.restorePending && (event?.timelineKind || ['timelineReplace', 'replace', 'historyRemove'].includes(event?.kind))) {
        entry.restorePending.received = true;
        resolveRestoredViewport(entry);
      }
      if (['seriesAdd', 'seriesRemove', 'seriesVisibility'].includes(event?.kind)) queueTreeRefresh(entry);
    });
    entry.unsubscribeRestoreResize = entry.instance.subscribe('resize', () => resolveRestoredViewport(entry));
    if (typeof entry.instance.drawings?.subscribe === 'function') {
      entry.unsubscribeTreeDrawings = entry.instance.drawings.subscribe(() => queueTreeRefresh(entry));
    }
    if (typeof entry.instance.alertUI?.subscribe === 'function' && !entry.unsubscribeAlertUI) {
      entry.unsubscribeAlertUI = entry.instance.alertUI.subscribe(event => {
        if (destroyed || !entry.alive) return;
        if (event.type === 'alerts-changed') {
          if (!entry.alertRefreshQueued) {
            entry.alertRefreshQueued = true;
            queueMicrotask(() => {
              entry.alertRefreshQueued = false;
              if (destroyed || !entry.alive) return;
              try {
                tree.syncChart(entry.id, { preserveEditor: true });
              } catch (error) {
                emit({ type: 'error', action: 'alertRefresh', chartId: entry.id, message: error.message });
              }
            });
          }
          return;
        }
        if (event.type !== 'selection-changed' || event.selectedId === null) return;
        if (tree.alertEditor?.chartId === entry.id && tree.alertEditor.alertId === event.selectedId) return;
        try {
          tree.syncChart(entry.id);
          tree.openAlertEditor(entry.id, event.selectedId);
        } catch (error) {
          emit({ type: 'error', action: 'alertSelect', chartId: entry.id, message: error.message });
        }
      });
    }
    const view = createMarkerView({
      container: entry.markerHost,
      chartId: entry.id,
      getChart: (chartId) => getChart(chartId),
      getDistance: () => markerState.get(entry.id)?.distance ?? options.clusterDistance,
      onSelect: (payload) => {
        if (destroyed) return;
        emit({ type: 'markerSelect', markerId: payload.markerId, chartId: payload.chartId, barId: payload.barId });
      },
    });
    entry.markerView = view;
    const state = markerState.get(entry.id);
    view.setMarkers(state ? state.markers : [], { distance: state?.distance });
    return view;
  }

  function applyLayout() {
    if (!layout) return;
    setStyle(grid, {
      display: 'grid',
      gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
      gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
    });
    setAttr(grid, 'data-rows', layout.rows);
    setAttr(grid, 'data-columns', layout.columns);
    const cells = new Map(layout.cells.map((cell) => [cell.id, cell]));
    for (const entry of charts.values()) {
      const cell = cells.get(entry.id);
      if (cell) setStyle(entry.cell, cellStyle(cell));
    }
  }

  function addChart(chartId, chartOptions = {}) {
    assertAlive('add a chart');
    requireString(chartId, 'id');
    if (charts.has(chartId)) fail('duplicate-chart', `Chart "${chartId}" already exists in this workspace`, { field: 'id' });
    if (!isPlainObject(chartOptions)) fail('invalid-argument', 'chartOptions must be an object', { field: 'chartOptions' });
    const nextLayout = normalizeLayout(placeNewChart(layout, chartId), [...charts.keys(), chartId]);
    const entry = createChartEntry(chartId, { ...chartOptions, id: chartId });
    charts.set(chartId, entry);
    attachMarkers(entry);
    if (!markerState.has(chartId)) markerState.set(chartId, { markers: [], distance: options.clusterDistance });
    layout = nextLayout;
    applyLayout();
    tree.ensureChartRoot(chartId);
    if (typeof chartOptions.name === 'string' && chartOptions.name.length > 0) tree.setChartName(chartId, chartOptions.name);
    if (Object.keys(theme).length > 0) entry.instance.applyOptions(toJsonClone(theme, 'theme'));
    try {
      tree.syncChart(chartId);
    } catch (error) {
      tree.render();
      throw error;
    }
    emit({ type: 'chartAdded', chartId });
    return entry.instance;
  }

  function removeChart(chartId) {
    assertAlive('remove a chart');
    const entry = requireChart(chartId);
    const nextCharts = new Map(charts);
    nextCharts.delete(chartId);
    const remainingCells = layout.cells.filter((cell) => cell.id !== chartId);
    const nextLayout = normalizeLayout(
      { type: 'grid', rows: layout.rows, columns: layout.columns, cells: remainingCells },
      [...nextCharts.keys()],
    );
    entry.alive = false;
    charts.delete(chartId);
    if (entry.markerView) {
      entry.markerView.destroy();
      entry.markerView = null;
    }
    let firstError = null;
    try { entry.unsubscribeAlertUI?.(); } catch (error) { firstError = error; }
    try { entry.unsubscribeTreeData?.(); } catch (error) { firstError ??= error; }
    try { entry.unsubscribeRestoreResize?.(); } catch (error) { firstError ??= error; }
    try { entry.unsubscribeTreeDrawings?.(); } catch (error) { firstError ??= error; }
    markerState.delete(chartId);
    for (const [id, comparison] of [...comparisons]) if (comparison.chartId === chartId) comparisons.delete(id);
    tree.removeChart(chartId);
    try {
      entry.instance.destroy();
    } catch (error) {
      firstError ??= error;
    }
    removeElement(entry.cell);
    layout = nextLayout;
    applyLayout();
    emit({ type: 'chartRemoved', chartId });
    if (firstError) throw firstError;
  }

  function setLayout(nextLayout) {
    assertAlive('set layout');
    const normalized = normalizeLayout(nextLayout, [...charts.keys()]);
    layout = normalized;
    applyLayout();
    emit({ type: 'layout', layout: toJsonClone(layout, 'layout') });
    return toJsonClone(layout, 'layout');
  }

  function getLayout() {
    return toJsonClone(layout, 'layout');
  }

  function getState() {
    assertAlive('get state');
    const chartEntries = [];
    for (const entry of charts.values()) {
      const chartState = toJsonClone(entry.instance.getState(), `charts.${entry.id}.chartState`);
      if ('visibleRange' in chartState) chartState.visibleRange = null;
      if ('crosshair' in chartState) chartState.crosshair = null;
      const moduleDrawings =
        isPlainObject(chartState.modules) && isPlainObject(chartState.modules.drawings) ? chartState.modules.drawings : null;
      const context = isPlainObject(chartState.context)
        ? chartState.context
        : moduleDrawings && isPlainObject(moduleDrawings.context)
          ? moduleDrawings.context
          : null;
      const instrument =
        chartState.instrument ??
        (context && typeof context.instrumentId === 'string'
          ? {
              instrumentId: context.instrumentId,
              ...(typeof context.sourceId === 'string' ? { sourceId: context.sourceId } : {}),
            }
          : null);
      const scale = entry.instance.indexScale();
      readScale(scale);
      const rawRange = scale.getVisibleRange();
      const visibleRange = entry.restorePending?.range ?? (
        rawRange && Number.isFinite(rawRange.from) && Number.isFinite(rawRange.to) && rawRange.from < rawRange.to
          ? (() => {
              const from = anchorFromLogical(scale, rawRange.from);
              const to = anchorFromLogical(scale, rawRange.to);
              return from && to ? { from, to } : null;
            })()
          : null);
      const drawings =
        entry.instance.drawings && typeof entry.instance.drawings.list === 'function'
          ? toJsonClone(entry.instance.drawings.list(), `charts.${entry.id}.drawings`)
          : [];
      chartEntries.push({
        id: entry.id,
        chartState,
        context: context === null ? null : toJsonClone(context, `charts.${entry.id}.context`),
        instrument,
        interval: chartState.interval ?? (context && typeof context.interval === 'string' ? context.interval : null),
        settings: chartState.settings ?? chartState.options ?? {},
        visibleRange,
        drawings,
      });
    }
    const syncGroups = [];
    for (const controller of syncControllers) {
      for (const group of controller.listGroups()) syncGroups.push(toJsonClone(group, 'syncGroups'));
    }
    const snapshot = {
      kind: STATE_KIND,
      version: STATE_VERSION,
      layout: toJsonClone(layout, 'layout'),
      theme: toJsonClone(theme, 'theme'),
      charts: chartEntries,
      syncGroups,
      tree: { nodes: tree.list(), focusedId: tree.focusedId },
      comparisons: [...comparisons.values()].map((comparison) => ({
        id: comparison.id,
        chartId: comparison.chartId,
        name: comparison.name,
        mode: comparison.mode,
        instrument: comparison.instrument,
        primary: comparison.primary,
        ...(comparison.primary ? { primaryOriginalVisible: comparison.primaryOriginalVisible } : {}),
        points: [],
        mapping: comparison.mapping,
        baseSlot: comparison.baseSlot,
        units: comparison.units,
        currency: comparison.currency,
        base: null,
      })),
      markers: [...markerState].map(([chartId, state]) => ({
        chartId,
        markers: state.markers,
        ...(state.distance === undefined ? {} : { distance: state.distance }),
      })),
      preferences: toJsonClone(preferences, 'preferences'),
    };
    return toJsonClone(snapshot, 'state');
  }

  function restoreState(state) {
    assertAlive('restore state');
    const normalized = validateSnapshot(state);
    const staged = [];
    const stagedComparisons = new Map();
    try {
      for (const chartEntry of normalized.charts) {
        const entry = createChartEntry(chartEntry.id, {
          id: chartEntry.id,
          context: chartEntry.context,
          chartState: toJsonClone(chartEntry.chartState, `charts.${chartEntry.id}.chartState`),
          instrument: chartEntry.instrument,
          interval: chartEntry.interval,
          settings: chartEntry.settings,
          restore: true,
        });
        try {
          entry.instance.restoreState(toJsonClone(chartEntry.chartState, `charts.${chartEntry.id}.chartState`));
          const scale = entry.instance.indexScale();
          readScale(scale);
          entry.restorePending = { range: chartEntry.visibleRange, received: false };
          if (normalized.markers.some(marker => marker.chartId === entry.id && marker.markers.length)) validateMarkerCoordinates(entry.instance);
          if (Object.keys(normalized.theme).length > 0) entry.instance.applyOptions(toJsonClone(normalized.theme, 'theme'));
        } catch (error) {
          entry.alive = false;
          try {
            entry.instance.destroy();
          } catch (destroyError) {
            error.cause = destroyError;
          }
          removeElement(entry.cell);
          throw error;
        }
        staged.push({ entry, state: chartEntry });
      }
      for (const saved of normalized.comparisons) {
        const comparison = comparisonFromState(saved);
        const entry = staged.find(item => item.entry.id === comparison.chartId)?.entry;
        if (!entry) throw new Error(`Unknown comparison chart: ${comparison.chartId}`);
        const chart = entry.instance;
        const primarySourceExists = comparison.primary && chart.series?.list?.().some(series => series.id === comparison.primary.seriesId);
        if (primarySourceExists) readPrimaryComparison(chart, comparison.primary);
        const id = `comparison:${comparison.id}`;
        const existing = chart.series?.list?.().find(series => series.id === id);
        const calculated = computeComparison(comparison, chart);
        if (existing && (existing.type !== 'line' || existing.priceScaleId !== calculated.scale.id)) throw new Error(`Invalid comparison series: ${id}`);
        const series = existing
          ? (typeof chart.series === 'function' ? chart.series(id) : chart.series.get(id))
          : chart.addSeries('line', { id, priceScaleId: calculated.scale.id, title: comparison.name, metadata: comparisonMetadata(comparison) });
        series.setData(calculated.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })), comparisonMetadata(comparison));
        comparison.displaySeries = series;
        if (comparison.primary) {
          const owner = [...stagedComparisons.values()].find(item =>
            item.chartId === comparison.chartId && item.primary?.seriesId === comparison.primary.seriesId);
          if (owner && owner.primaryOriginalVisible !== comparison.primaryOriginalVisible) throw new Error('Conflicting primary visibility in snapshot');
          const primaryId = `comparison:${comparison.id}:primary`;
          const primaryDescriptor = chart.series.list().find(item => item.id === primaryId);
          const primarySource = primarySourceExists ? chart.series(comparison.primary.seriesId) : null;
          const metadata = primarySource?.metadata() ?? (primaryDescriptor ? chart.series(primaryId).metadata() : null);
          if (!metadata) throw new Error('Primary series metadata is required for its percentage display');
          if (primaryDescriptor && (primaryDescriptor.type !== 'line' || primaryDescriptor.priceScaleId !== calculated.scale.id)) throw new Error(`Invalid primary comparison series: ${primaryId}`);
          const primaryMetadata = { instrumentId: metadata.instrumentId, interval: metadata.interval, sourceId: metadata.sourceId, priceUnit: 'percent' };
          const primarySeries = primaryDescriptor ? chart.series(primaryId) : chart.addSeries('line', {
            id: primaryId, priceScaleId: calculated.scale.id, title: `${comparison.name} primary`, metadata: primaryMetadata,
          });
          const primary = computePrimaryComparison(chart, comparison.primary, comparison.baseSlot);
          primarySeries.setData(primary.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })), primaryMetadata);
          comparison.primaryDisplaySeries = primarySeries;
          if (primarySourceExists) chart.series.setVisible(comparison.primary.seriesId, false);
        }
        comparison.unsubscribeDisplay = watchComparison(chart, comparison.id);
        stagedComparisons.set(comparison.id, comparison);
      }
    } catch (error) {
      for (const { entry } of staged.reverse()) {
        entry.alive = false;
        try {
          entry.instance.destroy();
        } catch {
          // Staging rollback keeps the original workspace untouched; the original
          // failure is what the host needs to see.
        }
        removeElement(entry.cell);
      }
      throw error instanceof WorkspaceError
        ? error
        : new WorkspaceError('restore-failed', `Workspace restore failed: ${error.message}`, { field: 'state', cause: error });
    }

    const previousCharts = charts;
    const previousControllers = [...syncControllers];
    for (const controller of previousControllers) {
      syncControllers.delete(controller);
      controller.destroy();
    }
    for (const [groupId, owner] of [...syncGroupOwners]) if (previousControllers.includes(owner)) syncGroupOwners.delete(groupId);

    charts = new Map(staged.map(({ entry }) => [entry.id, entry]));
    layout = normalized.layout;
    theme = toJsonClone(normalized.theme, 'theme');
    preferences = toJsonClone(normalized.preferences, 'preferences');
    comparisons.clear();
    markerState.clear();
    for (const { entry, state: chartEntry } of staged) {
      const markerEntry = normalized.markers.find((marker) => marker.chartId === entry.id);
      markerState.set(entry.id, {
        markers: markerEntry ? markerEntry.markers : [],
        ...(markerEntry && markerEntry.distance !== undefined ? { distance: markerEntry.distance } : {}),
      });
    }
    for (const [id, comparison] of stagedComparisons) comparisons.set(id, comparison);
    tree.replaceNodes(normalized.tree.nodes, normalized.tree.focusedId);
    for (const { entry } of staged) tree.ensureChartRoot(entry.id);
    if (normalized.tree.nodes.length === 0) {
      for (const { entry } of staged) tree.syncChart(entry.id);
    }
    applyLayout();
    for (const { entry } of staged) attachMarkers(entry);
    for (const { entry } of staged) resolveRestoredViewport(entry);

    for (const [chartId, old] of previousCharts) {
      old.alive = false;
      try { old.unsubscribeAlertUI?.(); } catch (error) { emit({ type: 'error', action: 'alertUnsubscribe', chartId, message: error.message }); }
      try { old.unsubscribeTreeData?.(); } catch (error) { emit({ type: 'error', action: 'treeUnsubscribe', chartId, message: error.message }); }
      try { old.unsubscribeRestoreResize?.(); } catch (error) { emit({ type: 'error', action: 'viewportUnsubscribe', chartId, message: error.message }); }
      try { old.unsubscribeTreeDrawings?.(); } catch (error) { emit({ type: 'error', action: 'treeUnsubscribe', chartId, message: error.message }); }
      if (old.markerView) old.markerView.destroy();
      try {
        old.instance.destroy();
      } catch {
        // Old instances are being discarded; their destroy is idempotent per the
        // chart contract. A throw is reported by the host's own destroy path.
      }
      removeElement(old.cell);
      if (!charts.has(chartId)) markerState.delete(chartId);
    }

    if (normalized.syncGroups.length > 0) {
      createSyncController(workspace, { groups: normalized.syncGroups, mappings: [] });
    }
    tree.render();
    emit({ type: 'restore', charts: [...charts.keys()] });
    return { charts: [...charts.keys()] };
  }

  function setTheme(nextTheme) {
    assertAlive('set theme');
    const cloned = validateTheme(nextTheme, 'invalid-argument');
    const applied = [];
    try {
      for (const entry of charts.values()) {
        const state = entry.instance.getState();
        const previous = toJsonClone(state.options ?? state.settings ?? {}, `charts.${entry.id}.options`);
        applied.push({ entry, previous });
        entry.instance.applyOptions(toJsonClone(cloned, 'theme'));
      }
    } catch (error) {
      for (const { entry, previous } of applied.reverse()) entry.instance.applyOptions(previous);
      throw error;
    }
    const combined = { ...theme };
    for (const [key, value] of Object.entries(cloned)) {
      combined[key] = isPlainObject(value) && isPlainObject(combined[key]) ? { ...combined[key], ...value } : value;
    }
    theme = combined;
    emit({ type: 'theme', action: 'set' });
    return toJsonClone(theme, 'theme');
  }

  function getTheme() {
    return toJsonClone(theme, 'theme');
  }

  function setPreferences(next) {
    assertAlive('set preferences');
    if (!isPlainObject(next)) fail('invalid-argument', 'preferences must be an object', { field: 'preferences' });
    preferences = toJsonClone(next, 'preferences');
    emit({ type: 'preferences', action: 'change' });
    return toJsonClone(preferences, 'preferences');
  }

  function getPreferences() {
    return toJsonClone(preferences, 'preferences');
  }

  function exportPreferences() {
    assertAlive('export preferences');
    return { kind: 'preferences', version: TEMPLATE_VERSION, preferences: toJsonClone(preferences, 'preferences') };
  }

  async function savePreferences(write) {
    assertAlive('save preferences');
    if (typeof write !== 'function') fail('invalid-argument', 'write must be a function supplied by the host', { field: 'write' });
    const document = exportPreferences();
    try {
      await write(toJsonClone(document, 'preferences'));
    } catch (error) {
      emit({
        type: 'error',
        action: 'save',
        kind: 'preferences',
        field: 'write',
        message: `Saving preferences failed: ${error.message}`,
      });
      throw new WorkspaceError('preferences-save-failed', `Saving preferences failed: ${error.message}`, {
        field: 'write',
        cause: error,
      });
    }
    return document;
  }

  function exportTemplate(kind, context = {}) {
    assertAlive('export a template');
    if (!TEMPLATE_KINDS.includes(kind)) {
      fail('unsupported-template-kind', `Unsupported template kind: ${String(kind)}`, { field: 'kind', kind });
    }
    if (kind === 'layout') return { kind, version: TEMPLATE_VERSION, layout: toJsonClone(layout, 'layout') };
    if (kind === 'theme') return { kind, version: TEMPLATE_VERSION, theme: toJsonClone(theme, 'theme') };
    if (kind === 'preferences') return { kind, version: TEMPLATE_VERSION, preferences: toJsonClone(preferences, 'preferences') };
    if (kind === 'indicators') {
      const targetIds = context.chartId === undefined ? [...charts.keys()] : [requireChart(context.chartId).id];
      const chartDocs = targetIds.map((chartId) => {
        const entry = requireChart(chartId);
        const state = entry.instance.getState();
        const list = Array.isArray(state.indicators) ? state.indicators : state.modules?.indicators ?? [];
        return {
          chartId,
          indicators: list.map((indicator) => {
            requireString(indicator.id, `charts.${chartId}.indicators.id`);
            requireString(indicator.type, `charts.${chartId}.indicators.${indicator.id}.type`);
            return {
              id: indicator.id,
              type: indicator.type,
              source: indicator.source,
              pane: indicator.pane,
              style: toJsonClone(indicator.style ?? {}, `charts.${chartId}.indicators.${indicator.id}.style`),
              parameters: toJsonClone(indicator.parameters ?? {}, `charts.${chartId}.indicators.${indicator.id}.parameters`),
              ...(indicator.visible === undefined ? {} : { visible: indicator.visible }),
              ...(indicator.locked === undefined ? {} : { locked: indicator.locked }),
              ...(indicator.outputSeries && state.series ? {
                priceScaleId: state.series.find(series => series.id === Object.values(indicator.outputSeries)[0])?.priceScaleId ?? 'right',
              } : {}),
            };
          }),
        };
      });
      return { kind, version: TEMPLATE_VERSION, charts: chartDocs };
    }
    const chartId = requireChart(context.chartId).id;
    const entry = charts.get(chartId);
    const drawings = entry.instance.drawings;
    let document = null;
    if (typeof drawings?.exportDocument === 'function') document = toJsonClone(drawings.exportDocument(), 'drawings');
    else if (typeof drawings?.export === 'function') document = toJsonClone(drawings.export(), 'drawings');
    else if (typeof drawings?.list === 'function') {
      document = { version: 1, chartId, drawings: toJsonClone(drawings.list(), 'drawings') };
    }
    if (!document) {
      fail('adapter-unsupported', 'drawings export is required to export a drawings template', { field: 'drawings' });
    }
    return { kind, version: TEMPLATE_VERSION, chartId, document };
  }

  function replaceIndicators(entry, indicators, { lock = true } = {}) {
    const state = entry.instance.getState();
    const current = Array.isArray(state.indicators) ? state.indicators : state.modules?.indicators ?? [];
    for (const indicator of current) {
      const handle = typeof entry.instance.indicator === 'function' ? entry.instance.indicator(indicator.id) : null;
      if (!handle || typeof handle.remove !== 'function') {
        fail('adapter-unsupported', `Indicator "${indicator.id}" cannot be replaced`, { field: 'indicator', chartId: entry.id });
      }
      handle.remove();
    }
    for (const indicator of indicators) {
      const handle = entry.instance.addIndicator({
        id: indicator.id,
        type: indicator.type,
        source: indicator.source,
        pane: indicator.pane,
        style: toJsonClone(indicator.style, 'style'),
        parameters: toJsonClone(indicator.parameters, 'parameters'),
        ...(indicator.priceScaleId === undefined ? {} : { priceScaleId: indicator.priceScaleId }),
      });
      if (handle && handle.id !== undefined && handle.id !== indicator.id) {
        fail('adapter-unsupported', `Indicator factory returned "${handle.id}" instead of "${indicator.id}"`, {
          field: 'addIndicator',
          chartId: entry.id,
        });
      }
      if (indicator.visible === false && handle && typeof handle.setVisible === 'function') handle.setVisible(false);
      if (lock && indicator.locked === true && handle && typeof handle.setLocked === 'function') handle.setLocked(true);
    }
  }

  function applyTemplateDocument(normalized) {
    const kind = normalized.kind;
    if (kind === 'layout') {
      setLayout(normalized.layout);
      return null;
    }
    if (kind === 'theme') {
      setTheme(normalized.theme);
      return null;
    }
    if (kind === 'preferences') {
      preferences = toJsonClone(normalized.preferences, 'preferences');
      return null;
    }
    if (kind === 'indicators') {
      const snapshots = normalized.charts.map(chartDoc => {
        const entry = requireChart(chartDoc.chartId);
        return {
          entry, chartDoc,
          state: toJsonClone(entry.instance.getState(), `charts.${entry.id}.chartState`),
        };
      });
      // Validate adapter-specific indicator types, parameters, references and
      // options on detached charts before touching any live chart.
      for (const snapshot of snapshots) {
        const stage = createChartEntry(snapshot.entry.id, {
          ...snapshot.entry.options, id: snapshot.entry.id, chartState: snapshot.state, restore: true, validation: true,
        });
        try {
          stage.instance.restoreState(snapshot.state);
          replaceIndicators(stage, snapshot.chartDoc.indicators);
        } finally {
          stage.alive = false;
          try { stage.instance.destroy(); } finally { removeElement(stage.cell); }
        }
      }
      const transactions = [];
      try {
        for (const snapshot of snapshots) {
          const begin = snapshot.entry.instance.indicators?.beginReplacement;
          if (typeof begin !== 'function') fail('adapter-unsupported', 'Indicator template import requires indicators.beginReplacement()', { field: 'indicators', chartId: snapshot.entry.id });
          transactions.push({ entry: snapshot.entry, transaction: begin() });
        }
        for (const snapshot of snapshots) replaceIndicators(snapshot.entry, snapshot.chartDoc.indicators, { lock: false });
        for (const snapshot of snapshots) {
          for (const indicator of snapshot.chartDoc.indicators) {
            if (indicator.locked) snapshot.entry.instance.indicator(indicator.id).setLocked(true);
          }
        }
      } catch (error) {
        const failures = [];
        for (const { entry, transaction } of transactions.reverse()) {
          try { transaction.rollback(); } catch (rollbackError) { failures.push({ entry, rollbackError }); }
        }
        if (failures.length) {
          throw new WorkspaceError('template-rollback-failed', `Indicator template failed and rollback failed: ${failures[0].rollbackError.message}`, {
            field: 'indicators', chartId: failures[0].entry.id, cause: failures[0].rollbackError,
          });
        }
        throw error;
      }
      for (const { transaction } of transactions) transaction.commit();
      for (const chartDoc of normalized.charts) tree.syncChart(chartDoc.chartId);
      return normalized.charts.length === 1 ? normalized.charts[0].chartId : null;
    }
    const entry = requireChart(normalized.chartId);
    const drawings = entry.instance.drawings;
    const importer =
      typeof drawings?.importDocument === 'function'
        ? (value) => drawings.importDocument(value)
        : typeof drawings?.import === 'function'
          ? (value) => drawings.import(value)
          : null;
    if (!importer) {
      fail('adapter-unsupported', 'drawings import is required to apply a drawings template', { field: 'drawings.import' });
    }
    const previous =
      typeof drawings.exportDocument === 'function'
        ? drawings.exportDocument()
        : typeof drawings.export === 'function'
          ? drawings.export()
          : { version: 1, chartId: entry.id, drawings: drawings.list() };
    const chartState = toJsonClone(entry.instance.getState(), `charts.${entry.id}.chartState`);
    const stage = createChartEntry(entry.id, { ...entry.options, id: entry.id, chartState, restore: true, validation: true });
    try {
      stage.instance.restoreState(chartState);
      const stageDrawings = stage.instance.drawings;
      const validateImport = stageDrawings.importDocument ?? stageDrawings.import;
      if (typeof validateImport !== 'function') fail('adapter-unsupported', 'drawings import is required to validate a template', { field: 'drawings.import' });
      validateImport.call(stageDrawings, toJsonClone(normalized.document, 'document'));
    } finally {
      stage.alive = false;
      try { stage.instance.destroy(); } finally { removeElement(stage.cell); }
    }
    const document = toJsonClone(normalized.document, 'document');
    for (const key of ['styles', 'favorites', 'repeatMode']) {
      if (Object.hasOwn(previous, key)) document[key] = toJsonClone(previous[key], `drawings.${key}`);
      else delete document[key];
    }
    importer(document);
    tree.syncChart(entry.id);
    return entry.id;
  }

  function importTemplate(document) {
    assertAlive('import a template');
    let normalized;
    try {
      normalized = validateTemplateDocument(document, { chartIds: [...charts.keys()] });
    } catch (error) {
      emit({
        type: 'error',
        action: 'import',
        kind: isPlainObject(document) ? document.kind : undefined,
        field: error.field,
        message: error.message,
        chartId: isPlainObject(document) && typeof document.chartId === 'string' ? document.chartId : undefined,
      });
      throw error;
    }
    let chartId = normalized.chartId ?? null;
    try {
      const appliedChartId = applyTemplateDocument(normalized);
      if (appliedChartId) chartId = appliedChartId;
    } catch (error) {
      emit({
        type: 'error',
        action: 'import',
        kind: normalized.kind,
        field: error.field,
        message: error.message,
        chartId: error.chartId ?? chartId ?? undefined,
      });
      throw error;
    }
    emit({ type: 'template', action: 'import', kind: normalized.kind, chartId: chartId ?? undefined });
    return { kind: normalized.kind, action: 'import', chartId };
  }

  function comparisonMetadata(comparison) {
    const identity = comparison.instrument;
    if (!identity || ['instrumentId', 'interval', 'sourceId'].some(key => typeof identity[key] !== 'string' || !identity[key])) {
      throw new Error('Comparison instrumentId, interval and sourceId are required to label its scale');
    }
    return {
      instrumentId: identity.instrumentId, interval: identity.interval, sourceId: identity.sourceId,
      ...(comparison.mode === 'percent' ? { priceUnit: 'percent' } : {
        ...(comparison.units ? { priceUnit: comparison.units } : {}),
        ...(comparison.currency ? { currency: comparison.currency } : {}),
      }),
    };
  }

  function watchComparison(chart, id) {
    let refreshing = false;
    return chart.subscribe('datachange', event => {
      const comparison = comparisons.get(id);
      if (!event || !comparison || !comparison.displaySeries || refreshing) return;
      const timelineChanged = event.timelineKind || event.kind === 'timelineReplace' || event.kind === 'replace' || event.kind === 'historyRemove';
      const primaryChanged = comparison.primary && (event.seriesId === comparison.primary.seriesId || event.seriesIds?.includes(comparison.primary.seriesId));
      if (!timelineChanged && !primaryChanged) return;
      refreshing = true;
      try {
        if (timelineChanged) {
          const result = computeComparison(comparison, chart);
          comparison.displaySeries.setData(result.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })));
        }
        if (comparison.primary && comparison.primaryDisplaySeries) {
          const result = computePrimaryComparison(chart, comparison.primary, comparison.baseSlot);
          comparison.primaryDisplaySeries.setData(result.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })));
        }
        renderComparisons();
      } catch (error) {
        emit({ type: 'error', action: 'comparisonRefresh', chartId: comparison.chartId, message: error.message });
      } finally {
        refreshing = false;
      }
    });
  }

  function addComparison(chartId, spec) {
    assertAlive('add a comparison');
    const entry = requireChart(chartId);
    if (!isPlainObject(spec)) fail('invalid-argument', 'comparison spec must be an object', { field: 'spec' });
    requireString(spec.id, 'comparison.id');
    if (comparisons.has(spec.id)) fail('duplicate-comparison', `Comparison "${spec.id}" already exists`, { field: 'id' });
    const normalized = normalizeComparison(spec, { chart: entry.instance, field: `comparison "${spec.id}"` });
    normalized.chartId = chartId;
    if (normalized.mode === 'percent' && [...comparisons.values()].some(item =>
      item.chartId === chartId && item.mode === 'percent' && item.baseSlot !== normalized.baseSlot)) {
      fail('incompatible-base', 'Percentage comparisons on one chart must use the same base slot', { field: 'baseSlot' });
    }
    const calculated = computeComparison(normalized, entry.instance);
    const primaryResult = normalized.primary ? computePrimaryComparison(entry.instance, normalized.primary, normalized.baseSlot) : null;
    const primarySource = normalized.primary ? entry.instance.series(normalized.primary.seriesId) : null;
    const primaryMetadata = primarySource?.metadata();
    if (primaryResult && !primaryMetadata) throw new Error('Primary series metadata is required for its percentage display');
    if (typeof entry.instance.addSeries !== 'function') fail('chart-adapter', 'Chart does not support comparison series', { field: 'chart.addSeries' });
    const series = entry.instance.addSeries('line', {
      id: `comparison:${normalized.id}`, priceScaleId: calculated.scale.id, title: normalized.name, metadata: comparisonMetadata(normalized),
    });
    const siblings = normalized.primary ? [...comparisons.values()].filter(item =>
      item.chartId === chartId && item.primary?.seriesId === normalized.primary.seriesId) : [];
    const sourceDescriptor = normalized.primary ? entry.instance.series.list().find(item => item.id === normalized.primary.seriesId) : null;
    const originalVisible = siblings.length ? siblings[0].primaryOriginalVisible : sourceDescriptor?.visible !== false;
    let sourceHidden = false;
    let primarySeries = null;
    let unsubscribeDisplay;
    try {
      series.setData(calculated.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })));
      if (primaryResult) {
        const { instrumentId, interval, sourceId } = primaryMetadata;
        primarySeries = entry.instance.addSeries('line', {
          id: `comparison:${normalized.id}:primary`, priceScaleId: calculated.scale.id,
          title: `${normalized.name} primary`, metadata: { instrumentId, interval, sourceId, priceUnit: 'percent' },
        });
        primarySeries.setData(primaryResult.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })));
        if (!siblings.length) {
          entry.instance.series.setVisible(normalized.primary.seriesId, false);
          sourceHidden = true;
        }
      }
      unsubscribeDisplay = watchComparison(entry.instance, normalized.id);
    } catch (error) {
      if (sourceHidden) entry.instance.series.setVisible(normalized.primary.seriesId, originalVisible);
      if (primarySeries) entry.instance.removeSeries(primarySeries);
      entry.instance.removeSeries(series);
      throw error;
    }
    normalized.displaySeries = series;
    normalized.primaryDisplaySeries = primarySeries;
    normalized.primaryOriginalVisible = originalVisible;
    normalized.unsubscribeDisplay = unsubscribeDisplay;
    comparisons.set(normalized.id, normalized);
    emit({ type: 'comparison', action: 'add', chartId, comparisonId: normalized.id });
    return primaryResult ? { ...calculated, primary: primaryResult } : calculated;
  }

  function setComparisonData(comparisonId, points, mapping) {
    assertAlive('update comparison data');
    const comparison = comparisons.get(comparisonId);
    if (!comparison) fail('unknown-comparison', `Unknown comparison: ${comparisonId}`, { field: 'comparisonId' });
    const chart = requireChart(comparison.chartId).instance;
    const candidate = normalizeComparison({ ...comparison, primary: null, points, mapping: mapping ?? comparison.mapping }, { chart });
    candidate.chartId = comparison.chartId;
    const result = computeComparison(candidate, chart);
    const previous = { points: comparison.points, mapping: comparison.mapping, base: comparison.base };
    comparison.points = candidate.points;
    comparison.mapping = candidate.mapping;
    comparison.base = candidate.base;
    try {
      comparison.displaySeries.setData(result.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })));
    } catch (error) {
      Object.assign(comparison, previous);
      throw error;
    }
    emit({ type: 'comparison', action: 'data', chartId: comparison.chartId, comparisonId });
    return result;
  }

  function removeComparison(comparisonId) {
    assertAlive('remove a comparison');
    requireString(comparisonId, 'comparisonId');
    const comparison = comparisons.get(comparisonId);
    if (!comparison) fail('unknown-comparison', `Unknown comparison: ${comparisonId}`, { field: 'comparisonId' });
    const chart = requireChart(comparison.chartId).instance;
    const otherOwners = comparison.primary && [...comparisons.values()].some(item =>
      item !== comparison && item.chartId === comparison.chartId && item.primary?.seriesId === comparison.primary.seriesId);
    const sourceExists = comparison.primary && chart.series.list().some(item => item.id === comparison.primary.seriesId);
    if (sourceExists && !otherOwners) chart.series.setVisible(comparison.primary.seriesId, comparison.primaryOriginalVisible);
    try {
      chart.removeSeries(comparison.displaySeries.id);
      if (comparison.primaryDisplaySeries) chart.removeSeries(comparison.primaryDisplaySeries.id);
    } catch (error) {
      if (sourceExists && !otherOwners) chart.series.setVisible(comparison.primary.seriesId, false);
      throw error;
    }
    comparison.unsubscribeDisplay();
    comparisons.delete(comparisonId);
    emit({ type: 'comparison', action: 'remove', chartId: comparison.chartId, comparisonId });
  }

  function listComparisons(chartId) {
    assertAlive('list comparisons');
    const ids = chartId === undefined ? null : requireChart(chartId).id;
    const output = [];
    for (const comparison of comparisons.values()) {
      if (ids !== null && comparison.chartId !== ids) continue;
      const entry = charts.get(comparison.chartId);
      if (!entry) continue;
      const result = computeComparison(comparison, entry.instance);
      output.push(comparison.primary ? { ...result, primary: computePrimaryComparison(entry.instance, comparison.primary, comparison.baseSlot) } : result);
    }
    return output;
  }

  function setComparisonBase(comparisonId, baseSlot) {
    assertAlive('change a comparison base');
    const comparison = comparisons.get(comparisonId);
    if (!comparison) fail('unknown-comparison', `Unknown comparison: ${comparisonId}`, { field: 'comparisonId' });
    if (comparison.mode !== 'percent') fail('invalid-comparison', 'Only percentage comparisons have a base slot', { field: 'comparisonId' });
    const chart = requireChart(comparison.chartId).instance;
    const affected = [...comparisons.values()].filter(item => item.chartId === comparison.chartId && item.mode === 'percent');
    const plans = affected.map(item => {
      const candidate = normalizeComparison({ ...item, primary: null, baseSlot }, { chart, field: `comparison "${item.id}"` });
      candidate.chartId = item.chartId;
      const result = computeComparison(candidate, chart);
      const primary = item.primary ? computePrimaryComparison(chart, item.primary, baseSlot) : null;
      return { item, candidate, result, primary, previous: { baseSlot: item.baseSlot, base: item.base } };
    });
    const updates = plans.flatMap(({ item, result, primary }) => [
      { seriesId: item.displaySeries.id, operation: 'setData', points: result.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })) },
      ...(primary && item.primaryDisplaySeries ? [{ seriesId: item.primaryDisplaySeries.id, operation: 'setData', points: primary.points.filter(point => point.value !== null).map(({ barId, value }) => ({ barId, value })) }] : []),
    ]);
    if (updates.length > 1 && typeof chart.applyBatch !== 'function') fail('adapter-unsupported', 'Atomic comparison base changes require chart.applyBatch', { field: 'chart.applyBatch' });
    for (const plan of plans) Object.assign(plan.item, { baseSlot, base: plan.candidate.base });
    try {
      if (updates.length > 1) chart.applyBatch({ series: updates });
      else plans[0].item.displaySeries.setData(updates[0].points);
    } catch (error) {
      for (const plan of plans) Object.assign(plan.item, plan.previous);
      throw error;
    }
    emit({ type: 'comparison', action: 'base', chartId: comparison.chartId, comparisonId });
    const selected = plans.find(plan => plan.item === comparison);
    return selected.primary ? { ...selected.result, primary: selected.primary } : selected.result;
  }

  function setMarkers(chartId, markers, markerOptions = {}) {
    assertAlive('set markers');
    const entry = requireChart(chartId);
    const { markers: validated, distance } = validateMarkerSet(markers, entry.instance, {
      field: 'markers',
      distance: markerOptions.distance ?? options.clusterDistance,
    });
    markerState.set(chartId, { markers: validated, distance });
    const view = attachMarkers(entry);
    view.setMarkers(validated, { distance });
    emit({ type: 'markers', action: 'set', chartId });
    return getMarkers(chartId);
  }

  function clearMarkers(chartId) {
    return setMarkers(chartId, []);
  }

  function getMarkers(chartId) {
    assertAlive('read markers');
    const entry = requireChart(chartId);
    const state = markerState.get(chartId) ?? { markers: [] };
    const view = attachMarkers(entry);
    return {
      chartId,
      markers: view.getPositions(),
      clusters: view.getMarkers(),
      stored: toJsonClone(state.markers, 'markers'),
    };
  }

  function toggleMarkerGroup(chartId, clusterKey) {
    assertAlive('expand markers');
    const entry = requireChart(chartId);
    const view = attachMarkers(entry);
    return view.toggleGroup(clusterKey);
  }

  function selectMarker(chartId, markerId) {
    assertAlive('select a marker');
    const entry = requireChart(chartId);
    const view = attachMarkers(entry);
    return view.select(markerId);
  }

  async function exportPng(chartId) {
    assertAlive('export PNG');
    const entry = requireChart(chartId);
    const instance = entry.instance;
    return exportChartPng(instance, {
      chartId,
      isAlive: () => !destroyed && charts.get(chartId) === entry && entry.alive,
    });
  }

  function registerSyncController(controller, groupIds) {
    if (destroyed) fail('destroyed', 'Cannot register a sync controller: workspace is destroyed');
    for (const groupId of groupIds) {
      if (syncGroupOwners.has(groupId)) {
        fail('duplicate-sync-group', `Sync group id "${groupId}" is already used by another controller`, { field: 'groups' });
      }
    }
    for (const groupId of groupIds) syncGroupOwners.set(groupId, controller);
    syncControllers.add(controller);
  }

  function unregisterSyncController(controller) {
    syncControllers.delete(controller);
    for (const [groupId, owner] of [...syncGroupOwners]) if (owner === controller) syncGroupOwners.delete(groupId);
  }

  function reportSync(payload) {
    if (destroyed) return;
    emit({ type: 'syncstate', ...payload });
  }

  function subscribe(handler) {
    if (typeof handler !== 'function') fail('invalid-argument', 'handler must be a function', { field: 'handler' });
    if (destroyed) return () => {};
    listeners.add(handler);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      listeners.delete(handler);
    };
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    let firstError = null;
    for (const controller of [...syncControllers]) {
      syncControllers.delete(controller);
      try {
        controller.destroy();
      } catch (error) {
        firstError ??= error;
      }
    }
    syncGroupOwners.clear();
    for (const entry of [...charts.values()]) {
      entry.alive = false;
      if (entry.markerView) {
        try {
          entry.markerView.destroy();
        } catch (error) {
          firstError ??= error;
        }
        entry.markerView = null;
      }
      try { entry.unsubscribeAlertUI?.(); } catch (error) { firstError ??= error; }
      try { entry.unsubscribeTreeData?.(); } catch (error) { firstError ??= error; }
      try { entry.unsubscribeRestoreResize?.(); } catch (error) { firstError ??= error; }
      try { entry.unsubscribeTreeDrawings?.(); } catch (error) { firstError ??= error; }
      try {
        entry.instance.destroy();
      } catch (error) {
        firstError ??= error;
      }
      removeElement(entry.cell);
    }
    charts.clear();
    comparisons.clear();
    markerState.clear();
    try {
      tree.destroy();
    } catch (error) {
      firstError ??= error;
    }
    removeElement(root);
    for (const listener of [...listeners]) {
      try {
        listener({ type: 'destroy' });
      } catch (error) {
        firstError ??= error;
      }
    }
    listeners.clear();
    if (typeof options.onChange === 'function') {
      try {
        options.onChange({ type: 'destroy' });
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }

  const tree = new TreeStore({
    getChart, emit, chartIds: [],
    captureComparison(chartId, seriesId) {
      const item = [...comparisons.values()].find(comparison =>
        comparison.chartId === chartId && (comparison.displaySeries?.id === seriesId || comparison.primaryDisplaySeries?.id === seriesId));
      if (!item) return null;
      return toJsonClone({ chartId, spec: {
        id: item.id, name: item.name, mode: item.mode, instrument: item.instrument,
        points: item.points, mapping: item.mapping, primary: item.primary,
        ...(item.baseSlot === null ? {} : { baseSlot: item.baseSlot }),
        ...(item.units === null ? {} : { units: item.units }),
        ...(item.currency === null ? {} : { currency: item.currency }),
      } }, 'comparison');
    },
    removeComparison,
    isAuxiliarySeries: (chartId, seriesId) => [...comparisons.values()].some(item =>
      item.chartId === chartId && item.primaryDisplaySeries?.id === seriesId),
    restoreComparison: saved => addComparison(saved.chartId, saved.spec),
  });

  const workspace = {
    addChart,
    removeChart,
    setLayout,
    getLayout,
    getState,
    restoreState,
    getChart,
    listCharts: () => [...charts.keys()],
    subscribe,
    reportSync,
    registerSyncController,
    unregisterSyncController,
    setTheme,
    getTheme,
    tree,
    exportTemplate,
    importTemplate,
    setPreferences,
    getPreferences,
    exportPreferences,
    savePreferences,
    addComparison,
    setComparisonData,
    removeComparison,
    listComparisons,
    setComparisonBase,
    setMarkers,
    clearMarkers,
    getMarkers,
    toggleMarkerGroup,
    selectMarker,
    exportPng,
    getAnnouncements: () => ({ status: lastStatus, alert: lastAlert }),
    getElement: () => root,
    destroy,
  };

  applyLayout();
  tree.attach(treeHost, { editorContainer: alertHost });
  if (templateActions) templateActions.setAttribute('data-actions', 'host-managed');
  return workspace;
}
