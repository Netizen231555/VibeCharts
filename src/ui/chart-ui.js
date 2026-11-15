/**
 * createChartUI(chart, options) — builds the chart interface from parts placed
 * in regions around the chart container.
 *
 * The chart container is never moved: the host passes the element that already
 * holds it, region elements are inserted next to it, and a stylesheet (optional)
 * arranges them. Parts share one controller and are plain DOM factories
 * `(controller, context) => { element, destroy? }`, so host parts and built-in
 * parts are interchangeable. Nothing is mounted unless the whole layout passed
 * validation, including the rule that no action is left without a way to
 * invoke it.
 */
import { InteractionError } from '../interaction/errors.js';
import { createElement, append, setStyle } from '../interaction/dom.js';
import { isFiniteNumber } from '../interaction/geometry.js';
import { absentText } from '../interaction/messages.js';
import { createUiController } from './controller.js';
import { REGIONS, validateLayout, isRemoved } from './layout-config.js';
import { BUILTIN_PART_FACTORIES } from './parts/index.js';
import { computeResponsiveLayout } from './layout.js';
import { THEMES, directionLabel } from './theme.js';
import { createDrawingSettingsDialog } from './settings-dialog.js';

const BEFORE_PLOT = new Set(['top', 'start']);

function fail(message, field, code = 'INVALID_UI') {
  return new InteractionError(message, { code, field });
}

function resolveFactory(part, builtinFactories) {
  if (part.create) return part.create;
  const factory = builtinFactories[part.id];
  if (typeof factory !== 'function') {
    throw fail(`Built-in part "${part.id}" is not available`, `layout.${part.id}`, 'PART_UNAVAILABLE');
  }
  return factory;
}

export function createChartUI(chart, options = {}) {
  if (options === null || typeof options !== 'object') throw fail('options must be an object', 'options');
  const chartContainer = options.chartContainer || chart?.container || null;
  const host = options.host || chartContainer?.parentNode || null;
  if (!host || typeof host.appendChild !== 'function' || !chartContainer) {
    throw fail('createChartUI requires a host element that holds the chart container', 'host', 'MISSING_DOM');
  }
  if (chartContainer.parentNode !== host) {
    throw fail('The chart container must be a direct child of the host element; the container is not moved', 'host', 'INVALID_HOST');
  }
  const doc = options.document || host.ownerDocument || chartContainer.ownerDocument;
  if (!doc) throw fail('createChartUI requires a document', 'document', 'MISSING_DOM');
  if (host.hasAttribute && host.hasAttribute('data-chart-ui-shell')) {
    throw fail('The host already carries a chart UI; destroy it first', 'host', 'ALREADY_ATTACHED');
  }

  const controllerOptions = { ...options };
  for (const key of ['host', 'layout', 'parts', 'chartContainer', 'document']) delete controllerOptions[key];
  const layoutInput = options.layout;
  const hostParts = { ...options.parts };
  const builtinFactories = BUILTIN_PART_FACTORIES;
  const controller = createUiController(chart, controllerOptions);

  function planFor(layout) {
    return validateLayout(layout, { parts: hostParts, access: controller.actions(), accessibleActions: controller.options.accessibleActions === true });
  }

  let plan;
  try {
    plan = planFor(layoutInput);
  } catch (error) {
    controller.destroy();
    throw error;
  }

  const mounted = new Map();
  const regionElements = new Map();
  const previous = {
    plot: chartContainer.getAttribute ? chartContainer.getAttribute('data-region') : null,
    containerTheme: chartContainer.getAttribute ? chartContainer.getAttribute('data-theme') : null,
  };
  const disposers = [];
  let destroyed = false;
  let current = plan;

  /** Controls the layout removes on purpose stay in the model, disabled with the reason. */
  function applyRemovals(forPlan) {
    controller.resetRemovedActions();
    const controlIds = controller.model().groups.flatMap((group) => group.controls.map((control) => control.id));
    controller.removeActions(controlIds.filter((id) => isRemoved(forPlan.without, id)));
    if (!forPlan.parts.has('dataTable')) controller.removeActions(['accessibleTable'], controller.t('chart.tableNotInLayout'));
  }

  function mountPart(part, region, regionElement, forPlan, before = null) {
    const factory = resolveFactory(part, builtinFactories);
    const instance = factory(controller, { document: doc, region, id: part.id, host, chartContainer, layout: forPlan });
    if (instance === null || typeof instance !== 'object' || !instance.element || typeof instance.element.setAttribute !== 'function') {
      throw fail(`Part "${part.id}" must return { element }`, `parts.${part.id}`, 'INVALID_PART');
    }
    instance.element.setAttribute('data-chart-ui-part', part.id);
    if (before) regionElement.insertBefore(instance.element, before);
    else append(regionElement, instance.element);
    return { id: part.id, region, instance };
  }

  function unmount(entry) {
    try {
      if (typeof entry.instance.destroy === 'function') entry.instance.destroy();
    } finally {
      const element = entry.instance.element;
      if (element.parentNode) element.parentNode.removeChild(element);
    }
  }

  function mountPlan(forPlan) {
    const regionOrder = REGIONS.filter((region) => forPlan.regions[region].length > 0);
    for (const region of regionOrder) {
      const element = createElement(doc, 'div', { class: 'chart-ui-region', 'data-region': region });
      regionElements.set(region, element);
      if (BEFORE_PLOT.has(region)) host.insertBefore(element, chartContainer);
      else append(host, element);
    }
    for (const region of regionOrder) {
      for (const partId of forPlan.regions[region]) {
        mounted.set(partId, mountPart(forPlan.parts.get(partId), region, regionElements.get(region), forPlan));
      }
    }
  }

  /** Destroys every mounted part and region; failures are collected so one broken part cannot strand the rest. */
  function unmountAll() {
    const errors = [];
    for (const entry of [...mounted.values()].reverse()) {
      try { unmount(entry); } catch (error) { errors.push(error); }
    }
    mounted.clear();
    for (const element of regionElements.values()) if (element.parentNode) element.parentNode.removeChild(element);
    regionElements.clear();
    return errors;
  }

  function restoreContainerAttributes() {
    host.removeAttribute('data-chart-ui-shell');
    if (previous.plot === null) chartContainer.removeAttribute?.('data-region');
    else chartContainer.setAttribute('data-region', previous.plot);
  }

  try {
    host.setAttribute('data-chart-ui-shell', '');
    if (chartContainer.setAttribute) chartContainer.setAttribute('data-region', 'plot');
    applyRemovals(plan);
    mountPlan(plan);
  } catch (error) {
    unmountAll();
    restoreContainerAttributes();
    controller.destroy();
    throw error;
  }

  /* ------------------------------- presentation ------------------------------- */
  function applyThemeAttributes() {
    const theme = controller.get('theme');
    host.setAttribute('data-theme', theme);
    if (chartContainer.setAttribute) chartContainer.setAttribute('data-theme', theme);
  }
  applyThemeAttributes();
  disposers.push(controller.subscribe('theme', applyThemeAttributes));

  /* ---------------------------- drawing settings dialog ---------------------------- */
  // Opened by `drawingActivate` (double click, Enter, activateDrawing) while an interaction and a drawing store exist;
  // `drawingSettings: false` leaves activation to the host, `{ sharedStyle }` supplies the host's shared style.
  const settingsOptions = options.drawingSettings;
  if (settingsOptions !== undefined && settingsOptions !== false && (settingsOptions === null || typeof settingsOptions !== 'object' ||
      (settingsOptions.sharedStyle !== undefined && typeof settingsOptions.sharedStyle !== 'function'))) {
    unmountAll();
    restoreContainerAttributes();
    controller.destroy();
    throw fail('drawingSettings must be false or an object with an optional sharedStyle function', 'drawingSettings');
  }
  let settingsDialog = null;
  if (settingsOptions !== false && chart?.drawings && typeof options.interaction?.subscribe === 'function') {
    settingsDialog = createDrawingSettingsDialog({
      chart,
      doc,
      host,
      interaction: options.interaction,
      announce: (text, announceOptions) => controller.announce(text, announceOptions),
      sharedStyle: settingsOptions?.sharedStyle ?? null,
    });
    disposers.push(() => settingsDialog.destroy());
  }

  let responsive = null;
  function applyResponsive() {
    const rect = typeof host.getBoundingClientRect === 'function' ? host.getBoundingClientRect() : null;
    const width = rect && isFiniteNumber(rect.width) && rect.width > 0 ? rect.width : (options.width === undefined ? 800 : options.width);
    const controlCount = controller.model().groups.reduce((total, group) => total + group.controls.length, 0);
    responsive = computeResponsiveLayout({ width, textScale: options.textScale || 1, controlCount, minChartHeight: options.minChartHeight || 160 });
    host.setAttribute('data-layout', responsive.attributes['data-layout']);
    setStyle(host, { minWidth: 0 });
    return responsive;
  }
  applyResponsive();
  if (typeof ResizeObserver === 'function' && typeof host.getBoundingClientRect === 'function') {
    const observer = new ResizeObserver(() => { if (!destroyed) applyResponsive(); });
    observer.observe(host);
    disposers.push(() => observer.disconnect());
  }

  /* --------------------------------- lifecycle --------------------------------- */
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    const errors = [];
    for (const dispose of disposers.splice(0)) {
      try { dispose(); } catch (error) { errors.push(error); }
    }
    errors.push(...unmountAll());
    host.removeAttribute('data-chart-ui-shell');
    host.removeAttribute('data-layout');
    host.removeAttribute('data-theme');
    if (previous.plot === null) chartContainer.removeAttribute?.('data-region');
    else chartContainer.setAttribute('data-region', previous.plot);
    if (previous.containerTheme === null) chartContainer.removeAttribute?.('data-theme');
    else chartContainer.setAttribute('data-theme', previous.containerTheme);
    controller.destroy();
    if (errors.length > 0) throw new AggregateError(errors, 'Chart UI: failed to release resources');
  }
  if (typeof chart?.subscribe === 'function') {
    const unsubscribe = chart.subscribe('destroy', () => destroy());
    if (typeof unsubscribe === 'function') disposers.push(unsubscribe);
  }

  function assertAlive() {
    if (destroyed) throw fail('The chart UI is destroyed', 'ui', 'UI_DESTROYED');
  }

  /** Replaces a part already in the layout; the new layout is validated before anything changes. */
  function replacePart(id, spec) {
    assertAlive();
    const entry = mounted.get(id);
    if (!entry) throw fail(`Part "${id}" is not in the layout`, `parts.${id}`, 'UNKNOWN_PART');
    const nextHostParts = { ...hostParts, [id]: spec };
    const nextPlan = validateLayout({ ...current.regions, without: current.without }, { parts: nextHostParts, access: controller.actions(), accessibleActions: controller.options.accessibleActions === true });
    const part = nextPlan.parts.get(id);
    const regionElement = regionElements.get(entry.region);
    const created = mountPart(part, entry.region, regionElement, nextPlan, entry.instance.element);
    unmount(entry);
    mounted.set(id, created);
    hostParts[id] = spec;
    current = nextPlan;
    return created.instance.element;
  }

  /**
   * Swaps the whole layout on the same chart and controller (for example tile ↔ dialog): view range, drawings and
   * selection are untouched because only parts are rebuilt. A layout that fails validation changes nothing.
   */
  function setLayout(layout) {
    assertAlive();
    const nextPlan = planFor(layout);
    const previousPlan = current;
    const errors = unmountAll();
    try {
      applyRemovals(nextPlan);
      mountPlan(nextPlan);
      current = nextPlan;
    } catch (error) {
      unmountAll();
      applyRemovals(previousPlan);
      mountPlan(previousPlan);
      throw error;
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Chart UI: failed to release the previous layout');
    return current;
  }

  const ui = {
    chart,
    host,
    root: host,
    element: host,
    controller,
    get theme() { return controller.get('theme'); },
    get layout() { return { regions: current.regions, omitted: current.omitted, without: current.without, responsive }; },
    get statusModel() { return controller.statusModel; },
    get model() { return controller.model(); },
    get derived() { return controller.derived; },
    parts: () => [...mounted.values()].map((entry) => ({ id: entry.id, region: entry.region, element: entry.instance.element })),
    replacePart,
    openDrawingSettings: (ids) => {
      assertAlive();
      if (!settingsDialog) throw fail('The drawing settings dialog is not available for this chart UI', 'drawingSettings', 'DRAWING_SETTINGS_UNAVAILABLE');
      settingsDialog.open(ids);
    },
    closeDrawingSettings: () => settingsDialog?.close(),
    setLayout,
    destroy,
    detach: destroy,
    setTheme: (mode) => controller.setTheme(mode),
    toggleTheme: () => controller.toggleTheme(),
    setTableVisible: (visible) => controller.setTableVisible(visible),
    setDerivedView: (view) => controller.setDerivedView(view),
    startLoading: (params) => controller.startLoading(params),
    resolveAvailable: (params) => controller.resolveAvailable(params),
    resolveEmpty: (params) => controller.resolveEmpty(params),
    fail: (params) => controller.fail(params),
    setValueUnavailable: (field, reason) => controller.setValueUnavailable(field, reason),
    announce: (text, announceOptions) => controller.announce(text, announceOptions),
    clearError: () => controller.clearError(),
    getState() {
      return {
        theme: controller.get('theme'),
        layout: { regions: current.regions, omitted: current.omitted, without: current.without, responsive },
        status: controller.statusModel.state,
        tableVisible: controller.get('tableVisible'),
        panes: controller.panes.list(),
        derived: controller.derived ? { name: controller.derived.view.name, selectedId: controller.derived.selectedId, scale: controller.derived.scale } : null,
        controls: controller.model(),
      };
    },
    get demo() { return options.demo === true; },
    themeNames: ['light', 'dark'],
    tokens: THEMES,
    // Bound to the chart locale; the standalone export takes the locale explicitly.
    directionLabel: (open, close) => directionLabel(open, close, controller.locale()),
    get absent() { return absentText(controller.locale()); },
  };
  return ui;
}


