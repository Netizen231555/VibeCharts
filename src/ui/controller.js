/**
 * Shared state and actions for the chart UI parts.
 *
 * Parts never read the chart or the host callbacks directly: they read state
 * through `get`/`snapshot`, react to `subscribe(keys, fn)` and invoke actions
 * through `run`/`runAction`. A control without a real handler is disabled with
 * a reason, loading/empty/available/error stay distinct, and every external
 * string is only ever written as text by the parts.
 */
import { InteractionError } from '../interaction/errors.js';
import { createStatusModel, buildAccessibleRows, buildTableModel } from '../interaction/a11y.js';
import { createDerivedViewAccessibility } from '../interaction/derived.js';
import { createToolbarModel, activateControl } from './controls.js';
import { createTheme } from './theme.js';
import { describeActionAccess } from './access.js';
import { t, localeOf } from './messages.js';
import { resolveIcons } from './icons.js';
import { openAnnotationEntry } from './text-entry.js';

const DEFAULT_OPTIONS = Object.freeze({
  accessibleActions: false,
});

export const STATE_KEYS = Object.freeze([
  'theme', 'chartType', 'indicator', 'tool', 'interval', 'follow', 'crosshair', 'tableVisible', 'priceMode', 'snapMode',
  'status', 'message', 'data', 'panes', 'indicatorErrors', 'derived', 'drawings', 'capabilities',
]);

const READ_KEYS = ['theme', 'chartType', 'indicator', 'tool', 'interval', 'follow', 'crosshair', 'tableVisible', 'priceMode', 'snapMode'];

export function createUiController(chart, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  // Resolved on every call: the chart locale may change while the UI is mounted.
  const locale = () => localeOf(chart);
  const tr = (key, params) => t(locale(), key, params);
  if (opts.accessibleActions !== undefined && typeof opts.accessibleActions !== 'boolean') {
    throw new InteractionError('accessibleActions must be a boolean', { code: 'INVALID_UI_OPTION', field: 'accessibleActions' });
  }
  const interaction = opts.interaction || null;
  const icons = resolveIcons(opts.icons);
  const listeners = new Map();
  const disposers = [];
  let destroyed = false;
  let closeTextEntry = null;
  const chartTheme = typeof chart?.getState === 'function' ? chart.getState().options?.theme : undefined;
  let theme = opts.theme ?? chartTheme ?? 'light';
  createTheme(theme);
  if (opts.theme !== undefined && typeof chart?.applyOptions === 'function' && chartTheme !== theme) chart.applyOptions({ theme });
  // The table is an opt-in view: the canvas already has its own accessible alternative.
  let tableVisible = opts.tableVisible === true;
  let message = { text: '', error: false };
  const statusModel = createStatusModel({ locale });
  let derived = opts.derived ? createDerivedViewAccessibility({
    locale,
    view: opts.derived,
    validateParameters: opts.validateDerivedParameters,
    onAnnounce: (event) => {
      if (event.type === 'selectionRemoved') announce(tr('chart.selectionRemoved', { id: event.id }), { error: false });
      if (event.type === 'invalidParameters') announce(tr('chart.parametersRejected', { message: event.message }), { error: true });
    },
  }) : null;
  let last = {};

  function assertAlive() {
    if (destroyed) throw new InteractionError('The chart UI is destroyed', { code: 'UI_DESTROYED', field: 'ui' });
  }

  /* ------------------------------ subscriptions ------------------------------ */
  function subscribe(keys, listener) {
    assertAlive();
    if (typeof listener !== 'function') throw new InteractionError('listener must be a function', { code: 'INVALID_LISTENER', field: 'listener' });
    const names = Array.isArray(keys) ? keys : [keys];
    for (const key of names) {
      if (key !== '*' && !STATE_KEYS.includes(key)) {
        throw new InteractionError(`Unknown UI state key "${key}"`, { code: 'INVALID_STATE_KEY', field: 'keys' });
      }
    }
    const entry = { names, listener };
    listeners.set(entry, true);
    return () => { listeners.delete(entry); };
  }

  function notify(...keys) {
    if (destroyed) return;
    for (const entry of [...listeners.keys()]) {
      if (!listeners.has(entry)) continue;
      const matched = entry.names.includes('*') ? keys : keys.filter((key) => entry.names.includes(key));
      if (matched.length > 0) entry.listener(matched);
    }
  }

  /* ---------------------------------- state ---------------------------------- */
  function read(key) {
    switch (key) {
      case 'theme': return theme;
      case 'chartType': return opts.chartType || null;
      case 'indicator': return opts.indicator || null;
      case 'tool': return interaction && interaction.getTool ? (interaction.getTool() || {}).id || null : null;
      case 'interval': return opts.interval || '';
      case 'follow': return Boolean(interaction && interaction.getFollow && interaction.getFollow());
      case 'crosshair': return Boolean(interaction && interaction.keyboard && interaction.keyboard.crosshairActive);
      case 'tableVisible': return tableVisible;
      // Mode of the active pane's primary price scale; null without a scale or without an interaction to ask.
      case 'priceMode': return interaction && typeof interaction.getPriceScaleMode === 'function' ? interaction.getPriceScaleMode() : null;
      case 'snapMode': return interaction && typeof interaction.getDrawingSnap === 'function' ? interaction.getDrawingSnap().mode : null;
      default: throw new InteractionError(`State key "${key}" is not readable`, { code: 'INVALID_STATE_KEY', field: 'key' });
    }
  }

  function snapshot() {
    assertAlive();
    return {
      chartType: read('chartType'),
      indicator: read('indicator'),
      tool: read('tool'),
      priceMode: read('priceMode'),
      snapMode: read('snapMode'),
      intervals: opts.intervals || [],
      interval: read('interval'),
      theme,
      follow: read('follow'),
      crosshair: read('crosshair'),
      tableVisible,
      chartTypes: opts.chartTypes,
      indicators: opts.indicators,
      tools: opts.tools,
      canUndo: drawingHistory().canUndo,
      canRedo: drawingHistory().canRedo,
    };
  }

  function refresh() {
    if (destroyed) return;
    const changed = [];
    for (const key of READ_KEYS) {
      const value = read(key);
      if (last[key] !== value) {
        last[key] = value;
        changed.push(key);
      }
    }
    const history = drawingHistory();
    const historyKey = `${history.canUndo}:${history.canRedo}`;
    if (last.history !== historyKey) {
      last.history = historyKey;
      changed.push('drawings');
    }
    if (changed.length > 0) notify(...changed);
  }

  function drawingHistory() {
    const store = chart && chart.drawings;
    if (!store || typeof store.undo !== 'function') return { available: false, canUndo: false, canRedo: false };
    const canUndo = typeof store.canUndo === 'function' ? store.canUndo() === true : true;
    const canRedo = typeof store.canRedo === 'function' ? store.canRedo() === true : true;
    return { available: true, canUndo, canRedo };
  }

  function nativeDrawingAvailable() {
    return Boolean(chart?.drawings && chart.surface && interaction &&
      typeof interaction.armDrawing === 'function' && typeof interaction.getTool === 'function' &&
      typeof interaction.setTool === 'function');
  }

  function capabilities() {
    const history = drawingHistory();
    const result = {
      canChangeChartType: typeof opts.onChartType === 'function',
      canSelectIndicator: typeof opts.onIndicator === 'function',
      canDraw: typeof opts.onToolChange === 'function' || Boolean(interaction && typeof opts.createTool === 'function' && typeof interaction.setTool === 'function') || nativeDrawingAvailable(),
      canClearDrawings: typeof opts.onClearDrawings === 'function' || Boolean(chart && chart.drawings && typeof chart.drawings.clear === 'function'),
      canUndo: history.available && history.canUndo,
      canRedo: history.available && history.canRedo,
      canChangeInterval: typeof opts.onIntervalChange === 'function',
      canNavigate: Boolean(interaction && typeof interaction.fitContent === 'function'),
      canKeyboardActions: Boolean(interaction?.keyboard && typeof interaction.keyboard.activate === 'function'),
      canPriceAuto: Boolean(interaction && typeof interaction.enablePriceAuto === 'function'),
      canFollow: Boolean(interaction && typeof interaction.setFollow === 'function'),
      canToggleCrosshair: Boolean(interaction && interaction.keyboard && typeof interaction.keyboard.setCrosshairActive === 'function'),
      canToggleTheme: typeof chart?.applyOptions === 'function',
      canShowTable: Boolean(rowsSource()),
      canLogScale: Boolean(interaction && typeof interaction.toggleLogScale === 'function' && typeof interaction.getPriceScaleMode === 'function'),
      canDrawingSnap: Boolean(interaction && typeof interaction.setDrawingSnap === 'function' && typeof interaction.getDrawingSnap === 'function'),
    };
    return { ...result, ...(opts.capabilities || {}) };
  }

  function model() {
    assertAlive();
    const built = createToolbarModel({ current: snapshot(), capabilities: capabilities(), locale: locale() });
    if (removed.size === 0) return built;
    return {
      ...built,
      groups: built.groups.map((group) => ({
        ...group,
        controls: group.controls.map((control) => (removed.has(control.id)
          ? { ...control, enabled: false, reason: removed.get(control.id) }
          : control)),
      })),
    };
  }

  /* ------------------------------ removed actions ------------------------------ */
  // Actions the host removed on purpose stay in the model, disabled with a reason, so nothing disappears silently.
  const removed = new Map();
  function removeActions(ids, reason = tr('chart.removedByHost')) {
    for (const id of ids) removed.set(id, reason);
    notify('capabilities');
  }
  function resetRemovedActions() {
    removed.clear();
    notify('capabilities');
  }

  /* --------------------------------- messages --------------------------------- */
  function announce(text, { error = false } = {}) {
    assertAlive();
    message = { text, error };
    notify('message');
    return text;
  }

  function clearError() {
    assertAlive();
    if (message.error) message = { text: '', error: false };
    notify('message');
  }

  /* ---------------------------------- actions --------------------------------- */

  /** Label of a rail tool as the model shows it (host-supplied labels included); the raw id for a tool outside the model. */
  function toolLabel(id) {
    const entry = model().groups.flatMap((group) => group.controls).find((control) => control.action === 'tool' && control.value === id);
    return entry ? entry.label : id;
  }

  /** Bind data-dependent tools to visible chart series before placement. */
  function armProps(id, label) {
    if (id !== 'regressionChannel' && id !== 'anchoredVwap') return { props: {} };
    const series = typeof chart?.series?.list === 'function' ? chart.series.list().filter((entry) => entry.visible) : [];
    const price = series.find((entry) => ['candlestick', 'bar', 'line', 'area', 'baseline'].includes(entry.type));
    if (!price) return { refusal: tr('tool.needsPriceSeries', { tool: label }) };
    if (id === 'regressionChannel') return { props: { seriesId: price.id, upperK: 2, lowerK: 2 } };
    const volume = series.find((entry) => entry.type === 'histogram');
    if (!volume) return { refusal: tr('tool.needsVolumeSeries', { tool: label }) };
    return { props: { priceSeriesId: price.id, volumeSeriesId: volume.id } };
  }

  function setTheme(mode) {
    assertAlive();
    createTheme(mode);
    if (typeof chart?.applyOptions !== 'function') {
      throw new InteractionError(tr('chart.themeUnavailable'), { code: 'CONTROL_DISABLED', field: 'theme' });
    }
    chart.applyOptions({ theme: mode });
    theme = mode;
    last.theme = theme;
    notify('theme');
    return theme;
  }

  function setTableVisible(visible) {
    assertAlive();
    tableVisible = visible === true;
    last.tableVisible = tableVisible;
    notify('tableVisible');
    return { ok: true, visible: tableVisible };
  }

  function runAction(action, value) {
    assertAlive();
    switch (action) {
      case 'chartType':
        if (typeof opts.onChartType !== 'function') return { ok: false, code: 'CONTROL_DISABLED' };
        opts.onChartType(value);
        opts.chartType = value;
        return { ok: true };
      case 'indicator': {
        if (typeof opts.onIndicator !== 'function') return { ok: false, code: 'CONTROL_DISABLED' };
        // Repeating the selected indicator turns it off; SMA/EMA replace each other.
        const next = opts.indicator === value ? null : value;
        opts.onIndicator(next);
        opts.indicator = next;
        return { ok: true, indicator: next };
      }
      case 'interval':
        if (typeof opts.onIntervalChange !== 'function') return { ok: false, code: 'CONTROL_DISABLED' };
        opts.onIntervalChange(value);
        opts.interval = value;
        return { ok: true };
      case 'tool': {
        if (typeof opts.onToolChange === 'function') {
          opts.onToolChange(value);
          return { ok: true };
        }
        if (interaction && typeof interaction.setTool === 'function' && typeof opts.createTool === 'function') {
          const tool = opts.createTool(value);
          if (!tool) {
            announce(tr('chart.toolUnavailable'), { error: true });
            return { ok: false, code: 'TOOL_UNAVAILABLE' };
          }
          const active = interaction.getTool && interaction.getTool();
          if (active && active.id === value) {
            interaction.setTool(null);
            return { ok: true, tool: null };
          }
          interaction.setTool(tool);
          return { ok: true, tool: value };
        }
        if (nativeDrawingAvailable()) {
          if (closeTextEntry) { closeTextEntry(); closeTextEntry = null; }
          const active = interaction.getTool();
          if (active && active.id === value) {
            interaction.setTool(null);
            return { ok: true, tool: null };
          }
          if (value === 'text' || value === 'callout' || value === 'flag') {
            if (active) interaction.setTool(null);
            closeTextEntry = openAnnotationEntry({
              chart, t: tr,
              onApply: text => {
                interaction.armDrawing(value, { props: { text } });
                closeTextEntry = null;
              },
            });
            return { ok: true, pendingText: true };
          }
          const label = toolLabel(value);
          const prepared = armProps(value, label);
          if (prepared.refusal) {
            announce(prepared.refusal, { error: true });
            return { ok: false, code: 'TOOL_UNAVAILABLE' };
          }
          // A tool the interaction cannot arm (unknown id, rejected props) is announced with its reason, never swallowed.
          try {
            interaction.armDrawing(value, { props: prepared.props });
          } catch (error) {
            announce(tr('tool.armFailed', { tool: label, message: error.message }), { error: true });
            return { ok: false, code: 'TOOL_UNAVAILABLE' };
          }
          return { ok: true, tool: value };
        }
        return { ok: false, code: 'CONTROL_DISABLED' };
      }
      case 'clearDrawings':
        if (typeof opts.onClearDrawings === 'function') opts.onClearDrawings();
        else if (chart && chart.drawings && typeof chart.drawings.clear === 'function') chart.drawings.clear();
        else return { ok: false, code: 'CONTROL_DISABLED' };
        // Clearing ends an unfinished construction, so no tool stays armed over an empty chart.
        if (interaction && typeof interaction.setTool === 'function' && read('tool') !== null) interaction.setTool(null);
        announce(tr('chart.drawingsCleared'));
        return { ok: true };
      case 'undo':
      case 'redo': {
        const store = chart && chart.drawings;
        if (!store || typeof store[action] !== 'function') return { ok: false, code: 'CONTROL_DISABLED' };
        const applied = store[action]();
        if (applied === false) return { ok: false, code: 'NOTHING_TO_REVERT', reason: tr(action === 'undo' ? 'reason.undo' : 'reason.redo') };
        return { ok: true };
      }
      case 'panLeft':
      case 'panRight':
      case 'zoomIn':
      case 'zoomOut':
      case 'priceZoomIn':
      case 'priceZoomOut':
      case 'crosshairPrev':
      case 'crosshairNext':
        return interaction.keyboard.activate(action);
      case 'fitContent':
        return interaction.fitContent();
      case 'scrollToRealTime':
        return interaction.scrollToRealTime();
      case 'priceAuto':
        return interaction.enablePriceAuto();
      case 'follow':
        return interaction.setFollow(!(interaction.getFollow && interaction.getFollow()));
      case 'crosshair':
        if (interaction.keyboard && typeof interaction.keyboard.setCrosshairActive === 'function') {
          return { ok: true, active: interaction.keyboard.setCrosshairActive(!interaction.keyboard.crosshairActive) };
        }
        return { ok: false, code: 'CONTROL_DISABLED' };
      case 'logScale': {
        const result = interaction.toggleLogScale();
        if (!result.applied) return { ok: false, code: 'SCALE_UNAVAILABLE', reason: tr('chart.scaleUnavailable') };
        return { ok: true, mode: result.mode };
      }
      case 'drawingSnap': {
        // On means the nearest candle and its nearest O/H/L/C price; the source is the interaction's primary price series.
        const on = interaction.getDrawingSnap().mode === 'free';
        const mode = on ? 'strong' : 'free';
        interaction.setDrawingSnap({ mode, magnet: on });
        return { ok: true, mode };
      }
      case 'theme':
        return { ok: true, theme: setTheme(theme === 'dark' ? 'light' : 'dark') };
      case 'accessibleTable':
        return setTableVisible(!tableVisible);
      default:
        return { ok: false, code: 'UNKNOWN_ACTION', action };
    }
  }

  /** Activates a toolbar control by id with the same refusal/announcement rules for every part. */
  function run(controlId, value) {
    assertAlive();
    const built = model();
    const activation = activateControl(built, controlId, { locale: locale() });
    if (!activation.ok) {
      announce(activation.reason);
      return { ok: false, reason: activation.reason };
    }
    const control = built.groups.flatMap((group) => group.controls).find((entry) => entry.id === controlId);
    let result;
    try {
      result = runAction(control.action, value === undefined ? control.value : value);
      if (result && result.ok === false && result.reason) announce(result.reason);
    } catch (error) {
      announce(error.message, { error: true });
      result = { ok: false, reason: error.message };
    }
    refresh();
    notify('capabilities');
    return result;
  }

  /* ----------------------------------- table ----------------------------------- */
  function rowsSource() {
    if (typeof opts.getAccessibleRows === 'function') return opts.getAccessibleRows;
    if (interaction && interaction.accessible && typeof interaction.accessible.rows === 'function') return interaction.accessible.rows;
    if (Array.isArray(opts.slots)) {
      return () => buildAccessibleRows({
        slots: opts.slots,
        series: opts.series || [],
        getValues: opts.getValues || (() => []),
        metadata: opts.metadata || {},
        locale: opts.locale,
        timeZone: opts.timeZone,
      });
    }
    return null;
  }

  function seriesForTable(rows) {
    if (Array.isArray(opts.series) && opts.series.length > 0) return opts.series;
    const first = rows && rows[0];
    if (!first) return [];
    return Object.keys(first.series).map((id) => ({ id, label: id }));
  }

  /** The accessible table model, or `null` when no rows source was supplied. */
  function table() {
    const source = rowsSource();
    if (!source) return null;
    const rows = source();
    return buildTableModel(rows, { caption: opts.tableCaption || tr('chart.tableCaption'), series: seriesForTable(rows), locale: locale() });
  }

  /* ----------------------------------- panes ----------------------------------- */
  function paneSource() {
    if (opts.paneLayout && typeof opts.paneLayout.list === 'function') return opts.paneLayout.list();
    if (interaction && interaction.panes && typeof interaction.panes.list === 'function') return interaction.panes.list();
    return Array.isArray(opts.panes) ? opts.panes : [];
  }

  function paneApi() {
    if (opts.paneLayout && typeof opts.paneLayout.list === 'function') return opts.paneLayout;
    return interaction && interaction.panes ? interaction.panes : null;
  }

  /* -------------------------------- indicator errors -------------------------------- */
  function indicatorErrors() {
    const errors = [];
    if (typeof chart?.indicators?.list === 'function') {
      let indicators = [];
      try {
        indicators = chart.indicators.list();
        if (!Array.isArray(indicators)) throw new Error('invalid indicator list');
      } catch {
        indicators = [];
        errors.push(tr('chart.indicatorsUnavailable'));
      }
      for (const indicator of indicators) {
        try {
          const handle = chart.indicators.get(indicator.id);
          if (!handle || typeof handle.getErrors !== 'function') throw new Error('indicator error state unavailable');
          const details = handle.getErrors();
          if (!Array.isArray(details)) throw new Error('invalid indicator error state');
          if (details.length) {
            const fields = [...new Set(details.map((item) => item.field).filter((field) => typeof field === 'string' && field))];
            errors.push(tr('chart.indicatorError', { id: indicator.id, fields: fields.length ? ` (${fields.join(', ')})` : '' }));
          }
        } catch {
          errors.push(tr('chart.indicatorErrorUnavailable', { id: indicator.id }));
        }
      }
    }
    return errors.join(' ');
  }

  /* ----------------------------------- derived ----------------------------------- */
  function setDerivedView(view) {
    assertAlive();
    if (!derived) {
      derived = createDerivedViewAccessibility({ view, validateParameters: opts.validateDerivedParameters });
    } else {
      derived.sync(view);
    }
    notify('derived');
    return derived;
  }

  /* ----------------------------------- status ----------------------------------- */
  const statusApi = {
    startLoading: (params) => { assertAlive(); const next = statusModel.startLoading(params); notify('status'); return next; },
    resolveAvailable: (params) => { assertAlive(); const next = statusModel.resolveAvailable(params); notify('status', 'data'); return next; },
    resolveEmpty: (params) => { assertAlive(); const next = statusModel.resolveEmpty(params); notify('status'); return next; },
    fail: (params) => { assertAlive(); const next = statusModel.fail(params); notify('status'); return next; },
    setValueUnavailable: (field, reason) => { assertAlive(); const next = statusModel.setValueUnavailable(field, reason); notify('status'); return next; },
  };

  /* ----------------------------------- wiring ----------------------------------- */
  let indicatorRefreshQueued = false;
  function scheduleIndicatorErrors() {
    if (indicatorRefreshQueued) return;
    indicatorRefreshQueued = true;
    queueMicrotask(() => {
      indicatorRefreshQueued = false;
      notify('indicatorErrors');
    });
  }

  let tableLocale = chart?.surface?.locale;
  let tableTimeZone = chart?.surface?.timeZone;
  const subscribeChart = (name, handler) => {
    if (typeof chart?.subscribe !== 'function') return;
    disposers.push(chart.subscribe(name, handler));
  };
  const subscribeInteraction = (name, handler) => {
    if (!interaction || !interaction.subscribe) return;
    disposers.push(interaction.subscribe(name, handler));
  };
  subscribeChart('datachange', () => { scheduleIndicatorErrors(); notify('data'); });
  subscribeChart('visibleRangeChange', () => {
    const locale = chart.surface?.locale;
    const timeZone = chart.surface?.timeZone;
    if (locale === tableLocale && timeZone === tableTimeZone) return;
    tableLocale = locale;
    tableTimeZone = timeZone;
    notify('data');
  });
  subscribeChart('error', (event) => { if (event.operation === 'indicator') scheduleIndicatorErrors(); });
  subscribeChart('destroy', () => destroy());
  subscribeInteraction('panesChange', () => notify('panes'));
  subscribeInteraction('toolChange', () => { refresh(); notify('capabilities'); });
  subscribeInteraction('viewChange', () => refresh());
  subscribeInteraction('crosshairSelection', (description) => {
    if (derived && description && description.barId) derived.selectBySourceBar(description.barId);
    notify('derived');
  });
  if (chart?.drawings && typeof chart.drawings.subscribe === 'function') {
    disposers.push(chart.drawings.subscribe(() => { refresh(); notify('capabilities'); }));
  }
  for (const key of READ_KEYS) last[key] = read(key);
  last.history = `${drawingHistory().canUndo}:${drawingHistory().canRedo}`;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    if (closeTextEntry) { closeTextEntry(false); closeTextEntry = null; }
    for (const dispose of disposers.splice(0)) {
      if (typeof dispose === 'function') dispose();
    }
    listeners.clear();
  }

  return {
    chart,
    interaction,
    options: opts,
    /** Translates a UI string for the chart locale at the moment of the call. */
    t: tr,
    locale,
    /** The host's icon replacements (`icons` option); pass as `createIcon(doc, name, { icons: controller.icons })`. */
    icons,
    get destroyed() { return destroyed; },
    get(key) { assertAlive(); return read(key); },
    snapshot,
    refresh,
    capabilities,
    model,
    /** Per action: keyboard chords and context-menu item that can invoke it besides a control. */
    actions() { return describeActionAccess(model().groups.flatMap((group) => group.controls), interaction); },
    subscribe,
    notify,
    run,
    runAction,
    removeActions,
    resetRemovedActions,
    announce,
    clearError,
    get message() { return message; },
    setTheme,
    toggleTheme() { return setTheme(theme === 'dark' ? 'light' : 'dark'); },
    setTableVisible,
    table,
    rowsSource,
    panes: { list: paneSource, api: paneApi },
    indicatorErrors,
    get derived() { return derived; },
    setDerivedView,
    statusModel,
    ...statusApi,
    destroy,
  };
}
