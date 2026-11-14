/**
 * attachInteraction(chart, options) — pointer, wheel, touch, keyboard,
 * crosshair, context menu, pane layout and accessible-alternative wiring.
 *
 * Only the documented chart facade plus the hooks in docs/contract.md are used.
 * The pure state machines live in their own modules and are exercised
 * directly by the tests; this file binds them to DOM events and to the
 * overlay elements it owns.
 */
import { InteractionError } from './errors.js';
import { resolveInteractionAdapter } from './adapter.js';
import { createEmitter } from './emitter.js';
import { createRouter, routePointerDown, CANCEL_REASONS, ROUTE } from './routing.js';
import { createPaneLayout } from './panes.js';
import { createNavigation } from './navigation.js';
import { createCrosshairController, buildReadout } from './crosshair.js';
import { createKeyboard, createCrosshairNavigation, isEditableTarget } from './keyboard.js';
import { createGestureRecognizer } from './gestures.js';
import { hitTest, paneAtPoint, normalizeHitRadius } from './hittest.js';
import { buildMenuItems, createContextMenu } from './menu.js';
import { buildAccessibleRows, buildTableModel, createAnnouncer, formatTimestamp } from './a11y.js';
import { translate, absentText } from './messages.js';
import { createElement, append, clearElement, on, pointFromEvent, contains, focusElement, isConnected, setStyle, hide, show } from './dom.js';
import { isFiniteNumber } from './geometry.js';
import { createDrawingTool, drawingAnchor, effectiveSnap, modifierState, SHIFT_HORIZONTAL_TYPES, SNAP_MODIFIERS } from './drawingTool.js';
import { drawLayout } from '../drawings/render.js';
import { createModuleScope } from '../core/module-scope.js';
import { formatPrice } from '../render/axes.js';

/** Default keyboard instructions for a chart locale; text is resolved when the interaction is attached. */
export function defaultInstructions(locale) {
  return translate(locale, 'instructions.default');
}

const interactionContainers = new WeakSet();
let regionCounter = 0;

const MENU_TARGET_KINDS = Object.freeze({
  priceAxis: 'priceAxis',
  indexAxis: 'indexAxis',
  drawing: 'drawing',
  plot: 'plot',
  chart: 'chart',
});

function axisPaneForPoint(layout, point) {
  for (const pane of layout.panes) {
    if (!pane.visible) continue;
    if (point.x >= pane.plot.x && point.x <= pane.plot.x + pane.plot.width && point.y >= pane.plot.y && point.y <= pane.plot.y + pane.plot.height) return pane;
    for (const scale of pane.priceScales) {
      if (point.x >= scale.rect.x && point.x <= scale.rect.x + scale.rect.width && point.y >= scale.rect.y && point.y <= scale.rect.y + scale.rect.height) return pane;
    }
    if (pane.indexAxis) {
      const r = pane.indexAxis;
      if (point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height) return pane;
    }
  }
  return null;
}

export function attachInteraction(chart, options = {}) {
  // The interface language follows the chart locale at the moment text is produced.
  const uiLocale = () => options.locale ?? chart._options?.locale ?? chart.surface?.locale;
  const tr = (key, params) => translate(uiLocale(), key, params);
  if (options.bindings !== undefined) createKeyboard({ bindings: options.bindings });
  const adapter = resolveInteractionAdapter(chart, options);
  const container = adapter.container;
  const doc = adapter.document || container.ownerDocument;
  if (!doc) throw new InteractionError('Chart container has no ownerDocument', { code: 'MISSING_DOM', field: 'document' });
  const radius = normalizeHitRadius(options.hitRadius, 'hitRadius');
  const handleRadius = options.handleRadius === undefined ? Math.max(6, radius + 2) : normalizeHitRadius(options.handleRadius, 'handleRadius');
  const emitter = createEmitter();
  const announcer = createAnnouncer({ now: options.now || (() => Date.now()), minIntervalMs: options.announceIntervalMs === undefined ? 750 : options.announceIntervalMs });
  const disposers = [];
  const cleanupTasks = [];
  let destroyed = false;
  let focusActive = false;
  const previousOutline = container.style?.outline ?? '';
  const previousOutlineOffset = container.style?.outlineOffset ?? '';
  let toolState = options.tool || null;
  const ownedTools = new WeakSet();
  let drawingSnap = { mode: 'free', threshold: 5, magnet: false, modifier: 'alt' };
  let selection = null;
  let alertTouchCandidate = null;
  let activePaneId = null;
  const paneRestoreElements = new Map();
  const focusRegistry = new Map();
  let menuOpen = null;
  let tableBody = null;
  let tableElement = null;
  let cachedRows = null;
  let rowsDirty = true;

  const state = {
    get activePaneId() {
      return activePaneId;
    },
    set activePaneId(value) {
      activePaneId = value;
    },
  };

  const layout = () => adapter.layout();
  const rawPanes = adapter.getPanes();
  if (!Array.isArray(rawPanes) || rawPanes.length === 0) {
    throw new InteractionError('Chart reported no panes', { code: 'MISSING_CHART_HOOK', field: 'chart.getPanes()' });
  }
  // getPanes() may omit heights before the first layout (the core stores null
  // for a main pane height). The layout is authoritative for visible panes;
  // hidden panes keep a finite placeholder so showing them stays valid.
  const layoutPanes = layout().panes;
  const initialPanes = rawPanes.map((pane, index) => {
    const geometry = layoutPanes.find((candidate) => candidate.id === pane.id) || null;
    const height = [pane.height, geometry && geometry.height, geometry && geometry.plot && geometry.plot.height]
      .find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    const minHeight = [pane.minHeight, geometry && geometry.minHeight]
      .find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
    return {
      id: pane.id,
      order: typeof pane.order === 'number' && Number.isFinite(pane.order) ? pane.order : index,
      height: height === undefined ? 1 : height,
      minHeight: minHeight === undefined ? 1 : minHeight,
      visible: pane.visible !== false,
    };
  });
  activePaneId = initialPanes.find((pane) => pane.visible !== false)?.id ?? initialPanes[0].id;

  const navigation = createNavigation({ adapter, options, getLayout: layout });
  const panes = createPaneLayout({
    panes: initialPanes,
    separatorHeight: options.separatorHeight === undefined ? 4 : options.separatorHeight,
    containerHeight: options.containerHeight,
    locale: uiLocale,
  });

  function paneById(paneId) {
    const found = layout().panes.find((pane) => pane.id === paneId);
    return found || null;
  }

  function primaryScaleId(pane) {
    return pane && pane.priceScales.length > 0 ? pane.priceScales[0].id : null;
  }

  // An anchor lives on the x axis of its drawing's pane (element ids on a derived pane).
  function resolveAnchorX(anchor, drawing) {
    if (!anchor || typeof anchor !== 'object') return null;
    const scale = adapter.indexScaleFor(drawing.paneId);
    const index = scale.barIdToIndex(anchor.anchorBarId);
    if (index === null || index === undefined) return null;
    const offset = isFiniteNumber(anchor.offset) ? anchor.offset : 0;
    const x = scale.logicalToCoordinate(index + offset);
    return isFiniteNumber(x) ? (paneById(drawing.paneId)?.plot.x ?? layout().panes[0]?.plot.x ?? 0) + x : null;
  }

  function resolvePriceY(price, drawing) {
    if (!isFiniteNumber(price)) return null;
    const pane = paneById(drawing.paneId) || paneById(activePaneId);
    if (!pane) return null;
    const scaleId = drawing.scaleId || primaryScaleId(pane);
    if (!scaleId) return null;
    try {
      const scale = adapter.priceScale(pane.id, scaleId);
      const y = scale.priceToCoordinate(price);
      return isFiniteNumber(y) ? pane.plot.y + y : null;
    } catch {
      return null;
    }
  }

  function drawingsList() {
    if (typeof adapter.drawingsList === 'function') return adapter.drawingsList();
    if (!adapter.drawings) return [];
    const list = adapter.drawings.list();
    return Array.isArray(list) ? list : [];
  }

  function getDrawing(id) {
    try {
      return adapter.drawings.get(id);
    } catch {
      return null;
    }
  }

  function hitAt(point, layoutValue = layout()) {
    const ctx = {
      layout: layoutValue,
      drawings: drawingsList(),
      radius,
      handleRadius,
      selection,
      resolveAnchorX,
      resolvePriceY,
    };
    const base = hitTest(point, ctx);
    if (adapter.drawings && typeof adapter.drawings.hitTest === 'function' &&
        (base.kind === 'plot' || base.kind === 'drawing' || base.kind === 'handle')) {
      const hit = adapter.drawings.hitTest(point, { radius, paneId: base.paneId });
      if (hit) {
        const drawing = getDrawing(hit.id);
        const geometry = adapter.drawings.layout(hit.id);
        return { kind: hit.part === 'handle' ? 'handle' : 'drawing', drawingId: hit.id,
          anchorIndex: hit.anchorIndex, paneId: drawing.paneId, locked: geometry.locked };
      }
      if (base.kind !== 'plot') return { kind: 'plot', paneId: base.paneId };
    }
    return base;
  }

  /* ------------------------------ overlay ------------------------------ */
  const previousContainerPosition = container.style ? container.style.position : null;
  setStyle(container, { position: 'relative' });
  const overlay = createElement(doc, 'div', { class: 'chart-interaction-layer', 'aria-hidden': 'true' });
  setStyle(overlay, { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, pointerEvents: 'none', overflow: 'hidden' });
  const vertical = createElement(doc, 'div', { class: 'chart-crosshair-vertical' });
  const horizontal = createElement(doc, 'div', { class: 'chart-crosshair-horizontal' });
  const priceLabel = createElement(doc, 'div', { class: 'chart-crosshair-price' });
  const timeLabel = createElement(doc, 'div', { class: 'chart-crosshair-time' });
  for (const element of [vertical, horizontal, priceLabel, timeLabel]) setStyle(element, { position: 'absolute', display: 'none', pointerEvents: 'none' });
  for (const element of [priceLabel, timeLabel]) setStyle(element, { fontSize: '12px', padding: '1px 3px', whiteSpace: 'nowrap' });
  append(overlay, vertical, horizontal, priceLabel, timeLabel);
  append(container, overlay);

  const readout = createElement(doc, 'div', { class: 'chart-readout' });
  setStyle(readout, { position: 'absolute', left: '8px', top: '8px', maxWidth: 'calc(70% - 8px)', fontSize: '12px', lineHeight: '1.5', pointerEvents: 'none' });
  const readoutMain = createElement(doc, 'div');
  const readoutDetails = createElement(doc, 'details');
  const readoutSummary = createElement(doc, 'summary');
  const readoutExtra = createElement(doc, 'div');
  setStyle(readoutMain, { display: 'flex', flexWrap: 'wrap', columnGap: '0.45em', rowGap: '0.1em' });
  setStyle(readoutDetails, { pointerEvents: 'auto', width: 'fit-content', maxWidth: '100%' });
  setStyle(readoutExtra, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '40vh', overflowY: 'auto', paddingInlineStart: '1.25em' });
  append(readoutDetails, readoutSummary, readoutExtra);
  append(readout, readoutMain, readoutDetails);
  hide(readoutDetails);
  let readoutColor, readoutBackground, labelBackground, labelColor, crosshairColor;
  function syncReadoutTheme() {
    if (!chart._theme) return;
    const color = chart._options?.layout?.textColor ?? chart._theme.text;
    const background = chart._options?.layout?.background ?? chart._theme.background;
    const nextLabelBackground = chart._options?.crosshair?.labelBackground ?? chart._theme.crosshairLabel;
    const nextLabelColor = chart._options?.crosshair?.labelTextColor ?? color;
    const nextCrosshairColor = chart._options?.crosshair?.color ?? chart._theme.crosshair;
    if (nextCrosshairColor !== crosshairColor) {
      // 4px dash / 4px gap pattern for both lines.
      const dash = (direction) => `repeating-linear-gradient(${direction}, ${nextCrosshairColor} 0 4px, transparent 4px 8px)`;
      setStyle(vertical, { background: dash('to bottom') });
      setStyle(horizontal, { background: dash('to right') });
      crosshairColor = nextCrosshairColor;
    }
    if (color !== readoutColor || background !== readoutBackground || nextLabelBackground !== labelBackground || nextLabelColor !== labelColor) {
      // Fully transparent plate; a background-coloured halo around the glyphs
      // keeps them readable over candles and grid lines.
      const halo = `color-mix(in srgb, ${background} 78%, transparent)`;
      setStyle(readout, { color, background: 'transparent', textShadow: `0 0 3px ${halo}, 0 0 7px ${halo}` });
      readoutColor = color;
      readoutBackground = background;
      labelBackground = nextLabelBackground;
      labelColor = nextLabelColor;
      for (const element of [priceLabel, timeLabel]) {
        setStyle(element, { color: nextLabelColor, background: nextLabelBackground });
      }
    }
    if (focusActive && container.style && chart._theme.focus) {
      container.style.outline = `2px solid ${chart._theme.focus}`;
    }
  }
  syncReadoutTheme();
  append(container, readout);

  const regionId = `chart-region-${(regionCounter += 1)}`;
  const instructionsId = `${regionId}-instructions`;
  const instructions = createElement(doc, 'div', { class: 'chart-instructions', id: instructionsId }, options.instructions || tr('instructions.default'));
  setStyle(instructions, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' });
  const liveRegion = createElement(doc, 'div', { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', class: 'chart-live-region' });
  const errorRegion = createElement(doc, 'div', { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true', class: 'chart-alert-region' });
  for (const region of [instructions, liveRegion, errorRegion]) {
    setStyle(region, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' });
    append(container, region);
  }

  const existingLabel = container.getAttribute ? container.getAttribute('aria-label') : null;
  if (!existingLabel) container.setAttribute('aria-label', options.ariaLabel || tr('chart.label'));
  const existingRole = container.getAttribute ? container.getAttribute('role') : null;
  if (!existingRole) container.setAttribute('role', 'group');
  const existingDescribedBy = container.getAttribute ? container.getAttribute('aria-describedby') : null;
  container.setAttribute('aria-describedby', existingDescribedBy ? `${existingDescribedBy} ${instructionsId}` : instructionsId);
  if (!container.hasAttribute || !container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');

  function setFocusVisible(active) {
    focusActive = active;
    if (container.style) {
      container.style.outline = active && chart._theme?.focus ? `2px solid ${chart._theme.focus}` : previousOutline;
      container.style.outlineOffset = active ? '2px' : previousOutlineOffset;
    }
    container.setAttribute('data-focus-visible', active ? 'true' : 'false');
  }

  /* ----------------------------- accessible ---------------------------- */
  // Accessible rows and the series list describe the main (source) timeline.
  const mainSeriesValues = (barId) => adapter.getSeriesValues(null, barId);

  function seriesList() {
    const slots = adapter.slotsFor(null);
    const probe = mainSeriesValues(slots.length > 0 ? slots[0].barId : null) || [];
    return probe.map((entry) => ({
      id: entry.seriesId, label: entry.seriesId, type: entry.type,
      metadata: typeof chart.series === 'function' ? chart.series(entry.seriesId).metadata() : null,
    }));
  }

  function rows() {
    if (!rowsDirty && cachedRows) return cachedRows;
    cachedRows = buildAccessibleRows({
      slots: adapter.slotsFor(null),
      series: seriesList(),
      getValues: mainSeriesValues,
      metadata: options.metadata || {},
      locale: options.locale ?? chart.surface?.locale,
      timeZone: options.timeZone ?? chart.surface?.timeZone,
    });
    rowsDirty = false;
    return cachedRows;
  }

  function tableModel() {
    return buildTableModel(rows(), {
      caption: options.tableCaption || tr('chart.tableCaption'),
      locale: uiLocale(),
      series: seriesList(),
    });
  }

  function writeLive(text) {
    if (typeof text === 'string') liveRegion.textContent = text;
  }

  function writeError(text) {
    if (typeof text === 'string') errorRegion.textContent = text;
  }

  function announce(text, { error = false } = {}) {
    if (error) {
      const result = announcer.announceError(text);
      if (result.announced) {
        writeError(text);
        emitter.emit('announce', { role: 'alert', text });
      }
      return result;
    }
    const result = announcer.announceStatus(text);
    if (result.announced) {
      writeLive(text);
      emitter.emit('announce', { role: 'status', text });
    }
    return result;
  }

  function reportError(error, context = {}) {
    const message = error && error.message ? error.message : String(error);
    writeError(message);
    emitter.emit('error', { error, ...context });
    return { ok: false, error, message };
  }

  /* --------------------------- crosshair wiring ------------------------ */
  const crosshair = createCrosshairController({
    adapter,
    getLayout: layout,
    hitPane: (point) => {
      try {
        return paneAtPoint(point, layout());
      } catch {
        return null;
      }
    },
    options,
  });
  let axisTimeFormatter = null;
  let axisTimeKey = null;
  function formatAxisTime(time, presentation) {
    const key = `${presentation.locale || ''}|${presentation.timeZone || 'UTC'}`;
    if (key !== axisTimeKey) {
      axisTimeFormatter = new Intl.DateTimeFormat(presentation.locale, {
        timeZone: presentation.timeZone || 'UTC', year: '2-digit', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
      });
      axisTimeKey = key;
    }
    return axisTimeFormatter.format(new Date(time));
  }


  function renderCrosshair(payload) {
    const surface = chart.surface;
    const presentation = { locale: options.locale ?? surface?.locale, timeZone: options.timeZone ?? surface?.timeZone };
    const publish = () => {
      // The payload already carries the source barId and, on a derived pane, the element id.
      const chartPayload = { ...payload, chartId: chart.id };
      emitter.emit('crosshairMove', chartPayload);
      if (chartPayload.time === null) delete chartPayload.time;
      if (chartPayload.sessionDate === null) delete chartPayload.sessionDate;
      surface?.emit?.('crosshairMove', chartPayload);
    };
    if (!payload || payload.visible !== true) {
      for (const element of [vertical, horizontal, priceLabel, timeLabel]) {
        hide(element);
        setStyle(element, { display: 'none' });
      }
      clearElement(readoutMain);
      readoutMain.removeAttribute('title');
      hide(readoutDetails);
      publish();
      return;
    }
    const pane = paneById(payload.paneId);
    if (!pane) return;
    show(vertical);
    show(horizontal);
    setStyle(vertical, { display: 'block', left: `${payload.x}px`, top: `${pane.plot.y}px`, width: '1px', height: `${pane.plot.height}px` });
    setStyle(horizontal, { display: 'block', left: `${pane.plot.x}px`, top: `${payload.y}px`, width: `${pane.plot.width}px`, height: '1px' });
    if (isFiniteNumber(payload.price)) {
      show(priceLabel);
      const descriptor = chart.series?.list?.().find((entry) => entry.paneId === pane.id && entry.priceScaleId === payload.priceAxisId);
      const metadata = descriptor ? chart.series(descriptor.id).metadata() : null;
      priceLabel.textContent = formatPrice(payload.price, {
        priceScale: adapter.priceScale(pane.id, payload.priceAxisId), metadata, locale: presentation.locale
      });
      const axis = pane.priceScales.find((scale) => scale.id === payload.priceAxisId);
      const isLeft = axis?.side === 'left';
      setStyle(priceLabel, { display: 'block', top: `${payload.y}px`,
        left: `${isLeft ? pane.plot.x : pane.plot.x + pane.plot.width}px`,
        transform: isLeft ? 'translate(-100%, -50%)' : 'translateY(-50%)' });
    } else {
      hide(priceLabel);
      setStyle(priceLabel, { display: 'none' });
    }
    // The host formatter replaces the default plate text; a failure is reported and hides only the plate.
    let timeText = null;
    if (isFiniteNumber(payload.time)) {
      const formatter = chart._options?.crosshair?.timeFormatter;
      if (typeof formatter === 'function') {
        try {
          const slot = payload.barId === null ? null : chart.timeline.slotAt(chart.timeline.indexOf(payload.barId));
          const text = formatter(payload.time, slot);
          if (typeof text !== 'string') throw new TypeError('crosshair.timeFormatter must return a string');
          timeText = text;
        } catch (error) {
          chart._reportError(error, 'crosshair.timeFormatter');
        }
      } else {
        timeText = formatAxisTime(payload.time, presentation);
      }
    }
    if (timeText !== null) {
      show(timeLabel);
      timeLabel.textContent = timeText;
      setStyle(timeLabel, { display: 'block' });
      // The time plate belongs to the shared source time axis; a derived pane never gets one (its payload has no time).
      const axis = layout().timeAxis;
      if (axis) {
        const left = Math.max(axis.x, Math.min(payload.x - timeLabel.offsetWidth / 2, axis.x + axis.width - timeLabel.offsetWidth));
        setStyle(timeLabel, { display: 'block', left: `${left}px`, top: `${axis.y}px`, transform: 'none' });
      } else {
        hide(timeLabel);
        setStyle(timeLabel, { display: 'none' });
      }
    } else {
      timeLabel.textContent = '';
      hide(timeLabel);
      setStyle(timeLabel, { display: 'none' });
    }
    const readoutOptions = { absent: absentText(uiLocale()), ...(options.readout || {}) };
    // Unless the host chose digits or a unit, prices follow the series price step like the axis labels.
    const metadataFormatter = readoutOptions.priceFormatter || readoutOptions.priceDigits != null || readoutOptions.priceUnit != null
      ? null
      : (seriesId, value) => (seriesId === null
        ? priceLabel.textContent
        : formatPrice(value, { metadata: typeof chart.series === 'function' ? chart.series(seriesId).metadata() : null, locale: presentation.locale }));
    const rowsOut = buildReadout(payload, {
      priceFormatter: metadataFormatter,
      ...readoutOptions,
      locale: presentation.locale,
      timeFormatter: readoutOptions.timeFormatter || ((time) => formatTimestamp(time, presentation)),
    });
    const fieldNames = { open: tr('readout.open'), high: tr('readout.high'), low: tr('readout.low'), close: tr('readout.close'), volume: tr('readout.volume'), value: tr('readout.value') };
    const indicators = typeof chart.indicators?.list === 'function' ? chart.indicators.list() : [];
    const indicatorOutputs = new Map();
    for (const indicator of indicators) {
      for (const [output, id] of Object.entries(indicator.outputSeries || {})) {
        const parameters = Object.values(indicator.parameters || {}).join(', ');
        indicatorOutputs.set(id, `${indicator.type}${parameters ? ` (${parameters})` : ''} · ${output}`);
      }
    }
    const primary = payload.series.find((series) => !indicatorOutputs.has(series.seriesId) && series.values && Object.hasOwn(series.values, 'close'))
      || payload.series.find((series) => !indicatorOutputs.has(series.seriesId));
    const metadata = primary && typeof chart.series === 'function' ? chart.series(primary.seriesId).metadata() : null;
    const title = [metadata?.instrumentId, metadata?.interval].filter(Boolean).join(' · ');
    const rowsForSeries = (series) => {
      const prefix = `series:${series.seriesId}`;
      return (rowsOut || []).filter((row) => row.field === prefix ||
        ['open', 'high', 'low', 'close', 'volume', 'value'].some((field) => row.field === `${prefix}:${field}`));
    };
    const describe = (row) => {
      const field = row.field.slice(row.field.lastIndexOf(':') + 1);
      return fieldNames[field] ? `${fieldNames[field]} ${row.value}` : row.value;
    };
    const primaryValues = primary ? rowsForSeries(primary).map(describe) : [];
    const mainParts = [title, ...primaryValues].filter(Boolean);
    clearElement(readoutMain);
    readoutMain.setAttribute('title', mainParts.join(' · '));
    for (const [index, part] of mainParts.entries()) {
      // Each part stays on one line; the container wraps between parts instead of truncating values.
      const item = createElement(doc, 'span', { title: part }, index === mainParts.length - 1 ? part : `${part} ·`);
      setStyle(item, { whiteSpace: 'nowrap' });
      append(readoutMain, item);
    }
    const extra = payload.series.filter((series) => series !== primary);
    if (extra.length) {
      readoutSummary.textContent = tr('readout.summary', { count: extra.length });
      readoutExtra.textContent = extra.map((series) => {
        const label = indicatorOutputs.get(series.seriesId) || series.seriesId;
        return `${label}: ${rowsForSeries(series).map(describe).join(' · ')}`;
      }).join('\n');
      show(readoutDetails);
    } else {
      hide(readoutDetails);
      readoutExtra.textContent = '';
    }
    publish();
    if (payload.barId) {
      const announced = payload.derivedElementId ?? payload.barId;
      const result = announcer.announceBar(announced, announced);
      if (result.announced) writeLive(announced);
    }
  }

  const unsubscribeCrosshair = crosshair.subscribe(renderCrosshair);

  const crosshairNav = createCrosshairNavigation({
    getSlots: () => adapter.slotsFor(activePaneId),
    getValues: (id) => adapter.getSeriesValues(activePaneId, id) || [],
    isDerived: () => adapter.paneKind(activePaneId) === 'derived',
    sourceBarId: (id) => adapter.sourceBarId(activePaneId, id),
    onSelect: (description) => {
      if (!description) return;
      const result = crosshair.selectBar(description.barId, activePaneId);
      if (result.ok) {
        activePaneId = result.payload.paneId || activePaneId;
        writeLive(description.text);
        emitter.emit('crosshairSelection', description);
      }
    },
    locale: uiLocale,
  });

  /* ---------------------------- gestures ------------------------------ */
  const gestures = createGestureRecognizer({
    navigation,
    paneAt: (point) => paneAtPoint(point, layout()),
    options: { touch: options.touch !== false },
  });

  const router = createRouter({
    onCommit: (commit) => emitter.emit('commit', commit),
    onCancel: (cancel) => emitter.emit('cancel', cancel),
  });

  const keyboard = createKeyboard({ bindings: options.bindings || {}, crosshair: crosshairNav });
  interactionContainers.add(container);
  function updateKeyboardInstructions() {
    if (options.instructions) return;
    const bindings = keyboard.getBindings();
    const labels = Object.entries(bindings).map(([action, chord]) => `${chord} — ${keyboard.labels(uiLocale())[action]}`);
    if (bindings.contextMenu && bindings.contextMenu !== 'shift+f10') labels.push(tr('instructions.contextMenuAlias'));
    instructions.textContent = `${labels.join('; ')}.`;
  }
  updateKeyboardInstructions();

  /* ----------------------------- helpers ------------------------------ */
  const capturedPointers = new Set();

  function capturePointer(pointerId) {
    if (pointerId === null || pointerId === undefined) return;
    capturedPointers.add(pointerId);
    if (typeof container.setPointerCapture === 'function') {
      try {
        container.setPointerCapture(pointerId);
      } catch {
        // A detached or inactive pointer cannot be captured; the router still
        // retains logical ownership until the pointer ends.
      }
    }
  }

  function releasePointer(pointerId) {
    if (pointerId === null || pointerId === undefined) return;
    capturedPointers.delete(pointerId);
    if (typeof container.releasePointerCapture === 'function') {
      try {
        container.releasePointerCapture(pointerId);
      } catch {
        // Already released by the browser.
      }
    }
  }

  function releaseAllPointers() {
    for (const pointerId of [...capturedPointers]) releasePointer(pointerId);
  }

  function selectDrawing(drawingId) {
    if (adapter.drawings && typeof adapter.drawings.select === 'function') adapter.drawings.select(drawingId);
    if (selection === drawingId) return;
    selection = drawingId;
    emitter.emit('selectionChange', { drawingId, selected: drawingId !== null });
  }

  function clearSelection() {
    selectDrawing(null);
  }

  function toolOwner(tool) {
    return {
      move(point, meta) {
        if (typeof tool.move === 'function') tool.move(point, modifierState(meta?.event));
      },
      end(point, meta) {
        try { if (typeof tool.end === 'function') tool.end(point, modifierState(meta?.event)); }
        catch (error) {
          reportError(error, { action: 'drawing-construction' });
          return { cancelled: true, reason: 'commit-failed', error };
        }
        return { toolId: tool.id || null };
      },
      cancel(reason) {
        if (typeof tool.cancel === 'function') tool.cancel(reason);
      },
      commitKey: tool.id ? `tool:${tool.id}` : 'tool',
    };
  }

  // Dragging is staged locally: the store sees exactly one confirmed update,
  // and a cancelled gesture never crosses the backend reconciliation boundary.
  function drawingDrag(request) {
    const store = adapter.drawings;
    const surface = chart.surface;
    if (!store || !surface || typeof store.update !== 'function' ||
        typeof surface.anchorToX !== 'function' || typeof surface.xToAnchor !== 'function') return null;
    const selected = typeof store.getSelection === 'function' ? store.getSelection() : [];
    const ids = request.anchorIndex === null && selected.includes(request.drawingId) ? selected : [request.drawingId];
    const entries = ids.map(id => {
      const drawing = getDrawing(id);
      if (!drawing) return null;
      const binding = { paneId: drawing.paneId, scaleId: drawing.scaleId };
      const anchors = drawing.anchors.map(anchor => ({
        anchor,
        x: anchor.anchorBarId === undefined ? null : surface.anchorToX(anchor, { paneId: drawing.paneId }),
        y: anchor.price === undefined ? null : surface.priceToY(anchor.price, binding),
      }));
      if (anchors.some(item => (item.anchor.anchorBarId !== undefined && !isFiniteNumber(item.x)) ||
          (item.anchor.price !== undefined && !isFiniteNumber(item.y)))) return null;
      return { drawing, binding, anchors };
    });
    if (entries.some(entry => entry === null) || (entries.length > 1 && typeof store.updateBatch !== 'function')) {
      reportError(new Error(tr('drawing.moveUnavailable')), { action: 'drawing-update' });
      return null;
    }
    let preview = null;
    let lastPreviewError = null;
    function clearPreview() {
      if (preview && preview.parentNode) preview.parentNode.removeChild(preview);
      preview = null;
      lastPreviewError = null;
    }
    function updatesAt(point, notify, event) {
      const mods = modifierState(event);
      const shift = mods.shiftKey;
      const dx = point.x - request.point.x;
      const dy = point.y - request.point.y;
      return entries.map(({ drawing, binding, anchors: initial }) => ({
        id: drawing.id,
        patch: { anchors: initial.map((item, index) => {
          if (request.anchorIndex !== null && request.anchorIndex !== index) return item.anchor;
          const moved = drawingAnchor(chart, { x: item.x === null ? point.x : item.x + dx,
            y: item.y === null ? point.y : item.y + dy }, binding,
          { x: item.x !== null, price: item.y !== null }, effectiveSnap(chart, binding, drawingSnap, mods), notify, uiLocale());
          // Shift keeps a two-point line horizontal: the dragged handle takes the other anchor's price.
          if (shift && request.anchorIndex !== null && initial.length === 2 && SHIFT_HORIZONTAL_TYPES.includes(drawing.type) &&
              moved.price !== undefined) moved.price = initial[1 - index].anchor.price;
          return moved;
        }) }
      }));
    }
    function previewMove(point, meta = {}) {
      try {
        if (!preview) {
          preview = createElement(doc, 'canvas', { 'aria-hidden': 'true', class: 'chart-drawing-drag-preview' });
          setStyle(preview, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', pointerEvents: 'none' });
          append(overlay, preview);
        }
        const ctx = preview.getContext('2d');
        if (!ctx) throw new Error(tr('drawing.movePreviewUnavailable'));
        const bounds = container.getBoundingClientRect();
        const dpr = doc.defaultView?.devicePixelRatio || 1;
        const width = Math.round(bounds.width * dpr), height = Math.round(bounds.height * dpr);
        if (preview.width !== width) preview.width = width;
        if (preview.height !== height) preview.height = height;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, bounds.width, bounds.height);
        const updates = updatesAt(point, () => {}, meta.event);
        for (let i = 0; i < entries.length; i += 1) {
          const { drawing, binding } = entries[i];
          const layout = store.previewLayout({ ...drawing, ...updates[i].patch });
          if (!layout.resolved) throw new Error(layout.error?.message || layout.reason || tr('drawing.geometryUnavailable'));
          drawLayout(ctx, layout, surface.getVisibleRect(binding), true);
        }
        lastPreviewError = null;
      } catch (error) {
        if (lastPreviewError !== error.message) reportError(error, { action: 'drawing-preview' });
        lastPreviewError = error.message;
      }
    }
    return {
      move: previewMove,
      cancel: clearPreview,
      commit(point, meta = {}) {
        clearPreview();
        const dx = point.x - request.point.x;
        const dy = point.y - request.point.y;
        if (dx === 0 && dy === 0) return;
        const updates = updatesAt(point, text => announce(text), meta.event);
        if (updates.length === 1) store.update(updates[0].id, updates[0].patch);
        else store.updateBatch(updates);
      },
    };
  }

  function objectOwner(hit, point) {
    const selected = typeof adapter.drawings?.getSelection === 'function' ? adapter.drawings.getSelection() : [];
    if (!selected.includes(hit.drawingId)) selectDrawing(hit.drawingId);
    else if (selection !== hit.drawingId) {
      selection = hit.drawingId;
      emitter.emit('selectionChange', { drawingId: hit.drawingId, selected: true });
    }
    const controllerRequest = {
      drawingId: hit.drawingId,
      anchorIndex: hit.kind === 'handle' ? hit.anchorIndex : null,
      locked: hit.locked === true,
      point: { x: point.x, y: point.y },
    };
    const controller = !hit.locked
      ? (options.drawingController && typeof options.drawingController.begin === 'function'
        ? options.drawingController.begin(controllerRequest) : drawingDrag(controllerRequest))
      : null;
    let moved = false;
    let last = { x: point.x, y: point.y };
    return {
      move(next, meta) {
        if (next.x !== last.x || next.y !== last.y) moved = true;
        last = { x: next.x, y: next.y };
        if (controller && typeof controller.move === 'function') controller.move(next, meta);
      },
      end(next, meta) {
        try {
          if (controller && typeof controller.commit === 'function') controller.commit(next, meta);
        } catch (error) {
          reportError(error, { action: 'drawing-update', drawingId: hit.drawingId });
          return { cancelled: true, reason: 'commit-failed', drawingId: hit.drawingId, error };
        }
        return { drawingId: hit.drawingId, anchorIndex: controllerRequest.anchorIndex, moved: Boolean(controller) && moved };
      },
      cancel(reason) {
        if (controller && typeof controller.cancel === 'function') controller.cancel(reason);
      },
      commitKey: `object:${hit.drawingId}`,
    };
  }

  // A click only selects; the engine sees one update on release after a real
  // move, and a rejected update is reported while the line snaps back.
  function alertOwner(alertId, controller) {
    let moved = false;
    return {
      move(next) {
        moved = true;
        try { controller.move(next); }
        catch (error) {
          controller.cancel();
          reportError(error, { action: 'alert-drag', alertId });
        }
      },
      end(next) {
        if (!moved) { controller.cancel(); return { alertId, moved: false }; }
        try {
          controller.commit(next);
        } catch (error) {
          controller.cancel();
          const reported = reportError(error, { action: 'alert-drag', alertId });
          announce(reported.message, { error: true });
          return { cancelled: true, reason: 'commit-failed', alertId, error };
        }
        return { alertId, moved: true };
      },
      cancel() { controller.cancel(); },
      commitKey: `alert:${alertId}`,
    };
  }

  function axisOwner(kind, paneId, scaleId, startPoint = null) {
    let origin = startPoint ? { x: startPoint.x, y: startPoint.y } : null;
    let zoomer = null;
    return {
      move(point) {
        if (!origin) {
          origin = { x: point.x, y: point.y };
          return;
        }
        zoomer ??= navigation.beginAxisZoom(kind === ROUTE.AXIS_INDEX ? 'index' : 'price', paneId, scaleId);
        if (!zoomer) return;
        // Total displacement from the press, not per-event deltas: see navigation.beginAxisZoom.
        if (kind === ROUTE.AXIS_INDEX) zoomer.zoom(Math.exp(-(point.x - origin.x) / 120));
        else zoomer.zoom(Math.exp((point.y - origin.y) / 120));
      },
      end() {
        return { axis: kind, paneId, scaleId };
      },
      cancel() {},
      commitKey: `axis:${kind}:${paneId}`,
    };
  }

  function panOwner(paneId, startPoint = null) {
    let last = startPoint ? { x: startPoint.x, y: startPoint.y } : null;
    let moved = false;
    return {
      move(point) {
        if (!last) {
          last = point;
          return;
        }
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        last = point;
        if (dx !== 0 || dy !== 0) {
          moved = true;
          navigation.pan(dx, dy, paneId);
        }
      },
      end() {
        return { paneId, moved };
      },
      cancel() {},
      commitKey: `pan:${paneId}`,
    };
  }

  function cancelActive(reason = CANCEL_REASONS.ESCAPE) {
    const hadCapture = router.active;
    router.cancel(reason);
    gestures.cancel();
    releaseAllPointers();
    if (toolState && typeof toolState.cancel === 'function' && !hadCapture) toolState.cancel(reason);
    panes.cancelResize();
    return hadCapture;
  }

  /* ------------------------------ menu -------------------------------- */
  function menuTargetFromHit(hit) {
    if (!hit) return { kind: MENU_TARGET_KINDS.chart };
    if (hit.kind === 'axis' && hit.axis === 'price') {
      return { kind: MENU_TARGET_KINDS.priceAxis, paneId: hit.paneId, scaleId: hit.scaleId, side: hit.side, inverted: hit.inverted === true };
    }
    if (hit.kind === 'axis' && hit.axis === 'index') return { kind: MENU_TARGET_KINDS.indexAxis, paneId: hit.paneId };
    if (hit.kind === 'handle' || hit.kind === 'drawing') {
      return { kind: MENU_TARGET_KINDS.drawing, paneId: hit.paneId, drawingId: hit.drawingId };
    }
    if (hit.kind === 'plot') return { kind: MENU_TARGET_KINDS.plot, paneId: hit.paneId };
    return { kind: MENU_TARGET_KINDS.chart };
  }

  function priceScaleSupportsOptions(target) {
    if (typeof chart.setPriceScaleOptions === 'function') return true;
    if (!target || !target.paneId || !target.scaleId) return false;
    try {
      const scale = adapter.priceScale(target.paneId, target.scaleId);
      return typeof scale.setSide === 'function' || typeof scale.setInverted === 'function';
    } catch {
      return false;
    }
  }

  function applyPriceScaleOptions(target, patch) {
    if (typeof chart.setPriceScaleOptions === 'function') {
      chart.setPriceScaleOptions(target.paneId, target.scaleId, patch);
      crosshair.refresh('scale-options');
      return { ok: true };
    }
    const scale = adapter.priceScale(target.paneId, target.scaleId);
    if (patch.side !== undefined) {
      if (typeof scale.setSide !== 'function') return { ok: false, code: 'MISSING_CHART_HOOK', field: 'priceScale.setSide' };
      scale.setSide(patch.side);
    }
    if (patch.inverted !== undefined) {
      if (typeof scale.setInverted !== 'function') return { ok: false, code: 'MISSING_CHART_HOOK', field: 'priceScale.setInverted' };
      scale.setInverted(patch.inverted);
    }
    crosshair.refresh('scale-options');
    return { ok: true };
  }

  function toggleLogScaleOf(paneId) {
    const result = navigation.toggleLogScale(paneId);
    if (result.applied) emitter.emit('viewChange', { reason: 'price-mode', result });
    return result;
  }

  // Mode of the pane's primary price scale, the one navigation.toggleLogScale switches; null when there is none.
  function primaryPriceMode(paneId) {
    const pane = paneById(paneId);
    const scaleId = primaryScaleId(pane);
    if (scaleId === null) return null;
    try {
      return adapter.priceScale(pane.id, scaleId).mode ?? null;
    } catch {
      return null;
    }
  }

  const menuActions = {
    fitContent: ({ target }) => navigation.fitContent(target?.paneId ?? activePaneId),
    scrollToRealTime: ({ target }) => navigation.scrollToRealTime(target?.paneId ?? activePaneId),
    priceAutoScale: ({ target }) => navigation.enablePriceAuto(target.paneId, target.scaleId || null),
    priceScaleLeft: ({ target }) => applyPriceScaleOptions(target, { side: 'left' }),
    priceScaleRight: ({ target }) => applyPriceScaleOptions(target, { side: 'right' }),
    invertPriceScale: ({ target }) => applyPriceScaleOptions(target, { inverted: !target.inverted }),
    hidePane: ({ target }) => {
      return hidePaneKeepingFocus(target.paneId);
    },
    movePaneUp: ({ target }) => panes.move(target.paneId, -1),
    movePaneDown: ({ target }) => panes.move(target.paneId, +1),
    toggleLogScale: ({ target }) => toggleLogScaleOf(target.paneId),
  };

  function menuCapabilities(target) {
    const list = panes.list();
    const index = target && target.paneId ? list.findIndex((pane) => pane.id === target.paneId) : -1;
    const primary = target && target.kind === 'priceAxis' && target.scaleId === primaryScaleId(paneById(target.paneId));
    return {
      visiblePaneCount: panes.visibleCount(),
      canHidePane: panes.visibleCount() > 1,
      canMoveUp: index > 0,
      canMoveDown: index >= 0 && index < list.length - 1,
      canSetPriceScale: priceScaleSupportsOptions(target),
      priceMode: primary ? primaryPriceMode(target.paneId) : null,
    };
  }

  function closeMenu(reason = 'close') {
    if (!menuOpen) return { closed: false };
    const current = menuOpen;
    menuOpen = null;
    const result = current.model.close({ reason });
    if (current.element.parentNode) current.element.parentNode.removeChild(current.element);
    if (current.unsubscribeDoc) current.unsubscribeDoc();
    if (result.focusId) restoreFocus(result.focusId);
    return result;
  }

  function restoreFocus(focusId) {
    if (!focusId) return false;
    if (focusId === 'chart-region') return focusElement(container);
    const known = focusRegistry.get(focusId);
    if (known && isConnected(known)) return focusElement(known);
    if (focusId.startsWith('pane-restore:')) {
      const element = paneRestoreElements.get(focusId);
      if (element) return focusElement(element);
      return focusElement(container);
    }
    return focusElement(container);
  }

  function focusPaneRestore(focusId) {
    const element = paneRestoreElements.get(focusId);
    if (element) focusElement(element);
    else focusElement(container);
    return Boolean(element);
  }

  // Focus moves to the restore control only when the chart region holds it and
  // this pane is the one it last interacted with; focus on a menu or host
  // control belongs to that element and must not be stolen by hiding a pane.
  function paneHoldsFocus(paneId) {
    return doc.activeElement === container && activePaneId === paneId;
  }

  function hidePaneKeepingFocus(paneId) {
    const result = panes.setVisible(paneId, false, { restoreFocus: paneHoldsFocus(paneId) });
    if (result.ok && result.focusId) focusPaneRestore(result.focusId);
    return result;
  }

  function openMenu({ target, point = null, invokerId = 'chart-region' } = {}) {
    closeMenu('replace');
    const resolvedTarget = target || { kind: MENU_TARGET_KINDS.chart };
    const items = buildMenuItems({ target: resolvedTarget, capabilities: menuCapabilities(resolvedTarget), locale: uiLocale() });
    // Nothing to offer: no empty menu and no stale announcement; the caller decides what to tell the user.
    if (items.length === 0) return { opened: false, reason: 'no-items' };
    const model = createContextMenu({
      target: resolvedTarget,
      locale: uiLocale(),
      items,
      actions: menuActions,
      isAvailable: (id) => (id === 'chart-region' ? isConnected(container) : Boolean(focusRegistry.get(id) && isConnected(focusRegistry.get(id)))),
      onClose: () => {},
    });
    model.setInvoker(invokerId);
    const element = createElement(doc, 'div', { role: 'menu', 'aria-label': tr('chart.menuLabel'), tabindex: '-1', class: 'chart-context-menu' });
    setStyle(element, { position: 'absolute', zIndex: '10', pointerEvents: 'auto' });
    if (point) setStyle(element, { left: `${point.x}px`, top: `${point.y}px` });
    const itemElements = [];
    items.forEach((item, index) => {
      const attrs = { role: item.checked === undefined ? 'menuitem' : 'menuitemcheckbox', tabindex: '-1', 'data-action': item.id };
      if (item.checked !== undefined) attrs['aria-checked'] = item.checked ? 'true' : 'false';
      const itemElement = createElement(doc, 'div', attrs, item.label);
      itemElement.addEventListener('click', () => {
        try {
          const result = model.run(item.id);
          if (!result.ok) {
            writeLive(result.reason || '');
            emitter.emit('menuRefused', result);
          }
        } catch (error) {
          reportError(error, { action: item.id });
        } finally {
          closeMenu('action');
        }
      });
      append(element, itemElement);
      itemElements.push(itemElement);
    });
    append(container, element);
    const view = doc.defaultView;
    if (view && typeof element.getBoundingClientRect === 'function') {
      const bounds = element.getBoundingClientRect();
      const left = point?.x ?? 0;
      const top = point?.y ?? 0;
      setStyle(element, {
        left: `${left + Math.max(0, -bounds.left) - Math.max(0, bounds.right - view.innerWidth)}px`,
        top: `${top + Math.max(0, -bounds.top) - Math.max(0, bounds.bottom - view.innerHeight)}px`,
      });
    }
    focusElement(itemElements[model.focusIndex]);
    const keyHandler = (event) => {
      const result = model.handleKey(event.key);
      if (!result.handled) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (!model.open) {
        closeMenu('keyboard');
        return;
      }
      focusElement(itemElements[model.focusIndex]);
    };
    element.addEventListener('keydown', keyHandler);
    const docListener = (event) => {
      if (!contains(element, event.target) && !contains(container, event.target)) closeMenu('outside');
    };
    let unsubscribeDoc = null;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('pointerdown', docListener);
      unsubscribeDoc = () => doc.removeEventListener('pointerdown', docListener);
    }
    menuOpen = { model, element, itemElements, target: resolvedTarget, unsubscribeDoc };
    emitter.emit('contextMenu', { target: resolvedTarget, items });
    return { opened: true, model, element };
  }

  function focusedMenuTarget() {
    if (selection !== null) {
      const drawing = drawingsList().find((entry) => entry.id === selection);
      if (drawing) return { kind: MENU_TARGET_KINDS.drawing, paneId: drawing.paneId, drawingId: drawing.id };
    }
    const pane = paneById(activePaneId);
    if (!pane) return { kind: MENU_TARGET_KINDS.chart };
    return { kind: MENU_TARGET_KINDS.plot, paneId: pane.id };
  }

  /* ----------------------------- pointer ------------------------------ */
  function pointerAllowed(event) {
    if (event.button !== undefined && event.button !== 0 && event.pointerType !== 'touch') return false;
    return true;
  }

  function onPointerDown(event) {
    if (destroyed) return;
    if (isEditableTarget(event.target) || event.target?.closest?.('button, input, select, textarea, details, [contenteditable="true"], [role="button"]')) return;
    const point = pointFromEvent(event, container);
    if (menuOpen) closeMenu('pointer');
    const layoutValue = layout();
    const pointerType = event.pointerType || 'mouse';
    const toolReadyGlobal = toolState && toolState.active === true && typeof toolState.end === 'function' ? toolState : null;
    if (pointerType === 'touch') {
      if (router.active) return;
      if (!gestures.enabled) return;
      // An armed drawing tool owns the gesture before touch panning, exactly as
      // it does for the mouse; a two-point construction works with a finger.
      if (toolReadyGlobal && !router.active) {
        if (typeof toolReadyGlobal.begin === 'function') {
          const accepted = toolReadyGlobal.begin(point, { pointerId: event.pointerId, pointerType });
          if (accepted === false || (accepted && accepted.accepted === false)) return;
        }
        const pane = axisPaneForPoint(layoutValue, point);
        if (pane) activePaneId = pane.id;
        capturePointer(event.pointerId);
        const begun = router.begin(ROUTE.TOOL, toolOwner(toolReadyGlobal), { pointerId: event.pointerId, point, data: { toolId: toolReadyGlobal.id } });
        if (begun.started && typeof event.preventDefault === 'function') event.preventDefault();
        return;
      }
      if (gestures.pointerCount === 0) {
        const hit = hitAt(point, layoutValue);
        if (hit.kind === 'handle' || hit.kind === 'drawing' || hit.kind === 'axis') {
          if (hit.paneId) activePaneId = hit.paneId;
          const route = routePointerDown({ captureActive: false, tool: null, hit, point });
          const owner = route.kind === ROUTE.OBJECT
            ? objectOwner(hit, point)
            : axisOwner(route.kind, hit.paneId, hit.scaleId || primaryScaleId(paneById(hit.paneId)), point);
          capturePointer(event.pointerId);
          const begun = router.begin(route.kind, owner, { pointerId: event.pointerId, point, data: { paneId: hit.paneId, scaleId: hit.scaleId, drawingId: hit.drawingId } });
          if (begun.started && typeof event.preventDefault === 'function') event.preventDefault();
          return;
        }
        if (!paneAtPoint(point, layoutValue)) return;
      }
      if (gestures.pointerCount === 0 && chart.alertUI) {
        const hit = hitAt(point, layoutValue);
        const alertId = hit.kind === 'plot' ? chart.alertUI.hitTest(point, hit.paneId, radius) : null;
        alertTouchCandidate = alertId === null ? null : { pointerId: event.pointerId, point, alertId };
      } else alertTouchCandidate = null;
      const result = gestures.begin(event.pointerId, point, { pointerType });
      if (result.accepted) {
        capturePointer(event.pointerId);
        if (typeof event.preventDefault === 'function') event.preventDefault();
      }
      if (gestures.paneId) activePaneId = gestures.paneId;
      return;
    }
    if (gestures.pointerCount > 0) return;
    if (!pointerAllowed(event)) return;
    if (!container.hasAttribute || !container.hasAttribute('tabindex')) container.setAttribute('tabindex', '0');
    if (typeof container.focus === 'function' && event.target !== container) focusElement(container);
    const hit = hitAt(point, layoutValue);
    if (hit.paneId) activePaneId = hit.paneId;
    const toolReady = toolState && typeof toolState.end === 'function' ? toolState : null;
    const route = routePointerDown({ captureActive: router.active, tool: toolReady, hit, point });
    if (!route.accepted) return;
    if (route.kind === ROUTE.TOOL) {
      // The tool receives the exact down point so a two-point drag and its
      // preview never have to wait for the first pointermove.
      if (typeof toolReady.begin === 'function') {
        const accepted = toolReady.begin(point, { pointerId: event.pointerId, pointerType });
        if (accepted === false || (accepted && accepted.accepted === false)) return;
      }
      capturePointer(event.pointerId);
      const begun = router.begin(ROUTE.TOOL, toolOwner(toolReady), { pointerId: event.pointerId, point, data: { toolId: toolReady.id } });
      if (!begun.started) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (route.kind === ROUTE.OBJECT) {
      capturePointer(event.pointerId);
      router.begin(ROUTE.OBJECT, objectOwner(hit, point), { pointerId: event.pointerId, point, data: { drawingId: hit.drawingId } });
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (route.kind === ROUTE.AXIS_INDEX || route.kind === ROUTE.AXIS_PRICE) {
      capturePointer(event.pointerId);
      router.begin(route.kind, axisOwner(route.kind, hit.paneId, hit.scaleId || primaryScaleId(paneById(hit.paneId)), point), {
        pointerId: event.pointerId,
        point,
        data: { paneId: hit.paneId, scaleId: hit.scaleId },
      });
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (route.kind === ROUTE.PLOT && chart.alertUI) {
      const alertId = chart.alertUI.hitTest(point, hit.paneId, radius);
      if (alertId !== null) {
        chart.alertUI.select(alertId);
        const controller = typeof chart.alertUI.beginDrag === 'function' ? chart.alertUI.beginDrag(alertId) : null;
        if (controller) {
          capturePointer(event.pointerId);
          router.begin(ROUTE.PLOT, alertOwner(alertId, controller), { pointerId: event.pointerId, point, data: { paneId: hit.paneId, alertId } });
        }
        if (typeof event.preventDefault === 'function') event.preventDefault();
        return;
      }
    }
    if (route.kind === ROUTE.PLOT) {
      capturePointer(event.pointerId);
      router.begin(ROUTE.PLOT, panOwner(hit.paneId, point), { pointerId: event.pointerId, point, data: { paneId: hit.paneId } });
      if (typeof event.preventDefault === 'function') event.preventDefault();
    }
  }

  function onPointerMove(event) {
    if (destroyed) return;
    const point = pointFromEvent(event, container);
    const pointerType = event.pointerType || 'mouse';
    if (pointerType === 'touch') {
      if (router.active && (router.capture.pointerId === null || router.capture.pointerId === event.pointerId)) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        router.move(point, { event });
        return;
      }
      if (alertTouchCandidate?.pointerId === event.pointerId) {
        if (Math.hypot(point.x - alertTouchCandidate.point.x, point.y - alertTouchCandidate.point.y) <= radius) return;
        alertTouchCandidate = null;
      }
      if (!gestures.enabled) return;
      const result = gestures.move(event.pointerId, point);
      if (result.applied && typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (router.active) {
      if (router.capture.pointerId !== null && router.capture.pointerId !== event.pointerId) return;
      if (typeof event.preventDefault === 'function') event.preventDefault();
      router.move(point, { event });
      const pane = paneAtPoint(point, layout());
      if (pane) crosshair.pointerMove(point, pane);
      else crosshair.pointerLeave();
      return;
    }
    if (toolState && toolState.pending && typeof toolState.move === 'function') toolState.move(point, modifierState(event));
    const pane = paneAtPoint(point, layout());
    if (pane) {
      activePaneId = pane.id;
      crosshair.pointerMove(point, pane);
    } else {
      crosshair.pointerLeave();
    }
  }

  function finishPointer(event) {
    const pointerType = event.pointerType || 'mouse';
    if (pointerType === 'touch') {
      if (router.active && (router.capture.pointerId === null || router.capture.pointerId === event.pointerId)) {
        const point = pointFromEvent(event, container);
        releasePointer(event.pointerId);
        router.end(point, { event });
        return;
      }
      const candidate = alertTouchCandidate?.pointerId === event.pointerId ? alertTouchCandidate : null;
      alertTouchCandidate = null;
      gestures.end(event.pointerId);
      if (candidate) chart.alertUI.select(candidate.alertId);
      releasePointer(event.pointerId);
      return;
    }
    if (!router.active) return;
    if (router.capture.pointerId !== null && router.capture.pointerId !== event.pointerId) return;
    const point = pointFromEvent(event, container);
    releasePointer(event.pointerId);
    router.end(point, { event });
  }

  function onLostCapture(event) {
    if (!capturedPointers.has(event.pointerId)) return;
    alertTouchCandidate = null;
    if (router.active && router.capture.pointerId === event.pointerId) cancelActive(CANCEL_REASONS.LOST_CAPTURE);
    if (gestures.pointerCount > 0) {
      gestures.cancel();
      releaseAllPointers();
    }
  }

  function onPointerCancel(event) {
    alertTouchCandidate = null;
    if (gestures.pointerCount > 0 && gestures.cancel(event.pointerId ?? null).cancelled) {
      releaseAllPointers();
    }
    if (router.active && router.capture.pointerId === event.pointerId) cancelActive(CANCEL_REASONS.POINTER_CANCEL);
    releasePointer(event.pointerId);
  }

  function onPointerLeave() {
    if (!router.active && gestures.pointerCount === 0) crosshair.pointerLeave();
  }

  function onWheel(event) {
    if (destroyed) return;
    if (isEditableTarget(event.target) || event.target?.closest?.('button, input, select, textarea, details, [contenteditable="true"], [role="button"]')) return;
    if (snapModifierHeld(event)) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    const point = pointFromEvent(event, container);
    const pane = paneAtPoint(point, layout());
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? layout().height : 1);
    const result = navigation.wheel(point, delta || 0, { altKey: Boolean(event.altKey), paneId: pane ? pane.id : null });
    if (result.applied) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      crosshair.refresh('wheel');
      emitter.emit('viewChange', { reason: 'wheel', result });
    }
  }

  function onDoubleClick(event) {
    const point = pointFromEvent(event, container);
    const hit = hitAt(point);
    if (hit.kind !== 'axis') return;
    const paneId = hit.paneId;
    if (hit.axis === 'index') {
      const result = navigation.resetIndexStep(point.x, paneId);
      if (result.applied) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        crosshair.refresh('axis-reset');
        emitter.emit('viewChange', { reason: 'reset-index', result });
      }
      return;
    }
    const result = navigation.enablePriceAuto(paneId, hit.scaleId || primaryScaleId(paneById(paneId)));
    if (result.applied) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      emitter.emit('viewChange', { reason: 'price-auto', result });
    }
  }

  // The snap modifier is also a platform gesture (Ctrl+click is a context menu on macOS, Alt+wheel
  // zooms price): while a drawing is armed or being dragged it must reach the drawing untouched.
  function snapModifierHeld(event) {
    return drawingSnap.modifier !== null && event[`${drawingSnap.modifier}Key`] === true &&
      (router.active || (toolState !== null && toolState.active === true));
  }

  function onContextMenu(event) {
    if (snapModifierHeld(event)) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      return;
    }
    if (isEditableTarget(event.target)) return;
    const point = pointFromEvent(event, container);
    const hit = hitAt(point);
    const target = menuTargetFromHit(hit);
    const opened = openMenu({ target, point, invokerId: 'chart-region' });
    if (opened.opened && typeof event.preventDefault === 'function') event.preventDefault();
  }

  /* ----------------------------- keyboard ----------------------------- */
  function runKeyboardAction(resolved, event) {
    const paneId = activePaneId;
    if (resolved === null || resolved === undefined) return { handled: false };
    if (typeof resolved === 'object' && resolved.action === 'crosshairToggled') {
      writeLive(tr(resolved.active ? 'announce.crosshairOn' : 'announce.crosshairOff'));
      return { handled: true };
    }
    if (typeof resolved === 'object' && (resolved.action === 'crosshairPrev' || resolved.action === 'crosshairNext')) {
      if (!resolved.result || resolved.result.ok !== true) {
        writeLive(tr(resolved.action === 'crosshairPrev' ? 'announce.noPrevSlot' : 'announce.noNextSlot'));
      }
      return { handled: true };
    }
    switch (resolved) {
      case 'panLeft': return { handled: navigation.keyboardPan(-1, paneId).applied };
      case 'panRight': return { handled: navigation.keyboardPan(1, paneId).applied };
      case 'zoomIn': return { handled: navigation.keyboardZoom(1, paneId).applied };
      case 'zoomOut': return { handled: navigation.keyboardZoom(-1, paneId).applied };
      case 'priceZoomIn': return { handled: navigation.keyboardPriceZoom(1, paneId).applied };
      case 'priceZoomOut': return { handled: navigation.keyboardPriceZoom(-1, paneId).applied };
      case 'priceAuto': {
        const result = navigation.enablePriceAuto(paneId, null);
        announce(tr(result.applied ? 'announce.priceAutoOn' : 'announce.priceScaleUnavailable'));
        return { handled: result.applied };
      }
      case 'follow': {
        if (adapter.paneKind(paneId) === 'derived') {
          announce(tr('announce.followDerived'));
          return { handled: true };
        }
        const enable = !navigation.follow;
        const result = enable ? navigation.scrollToRealTime(paneId) : navigation.setFollow(false, paneId);
        emitter.emit('viewChange', { reason: 'follow', result });
        announce(tr(enable ? 'announce.followOn' : 'announce.followOff'));
        return { handled: true };
      }
      case 'fitContent': {
        const result = navigation.fitContent(paneId);
        emitter.emit('viewChange', { reason: 'fit-content', result });
        announce(tr('announce.fitAll'));
        return { handled: true };
      }
      case 'toggleLogScale': {
        let result;
        try {
          result = navigation.toggleLogScale(paneId);
        } catch (error) {
          reportError(error, { action: 'toggleLogScale' });
          announce(error.message, { error: true });
          return { handled: true };
        }
        if (!result.applied) {
          announce(tr(result.reason === 'percent-mode' ? 'announce.percentNoLog' : 'announce.priceScaleUnavailable'));
          return { handled: result.reason === 'percent-mode' };
        }
        emitter.emit('viewChange', { reason: 'price-mode', result });
        announce(tr(result.mode === 'log' ? 'announce.logOn' : 'announce.logOff'));
        return { handled: true };
      }
      case 'cancel': {
        if (menuOpen) {
          closeMenu('escape');
          return { handled: true };
        }
        const toolPending = Boolean(
          toolState && (toolState.pending === true || (typeof toolState.isPending === 'function' && toolState.isPending())),
        );
        const cancellable =
          router.active ||
          gestures.pointerCount > 0 ||
          toolPending ||
          (typeof panes.hasPreview === 'boolean' ? panes.hasPreview : false) ||
          keyboard.crosshairActive;
        if (!cancellable) {
          // Nothing chart-local is in flight: leave Escape to the page/dialog.
          return { handled: false, bubble: true };
        }
        cancelActive(CANCEL_REASONS.ESCAPE);
        keyboard.exitCrosshair();
        return { handled: true };
      }
      case 'contextMenu': {
        const opened = openMenu({ target: focusedMenuTarget(), point: null, invokerId: 'chart-region' });
        if (!opened.opened) writeLive(tr('menu.noActions'));
        return { handled: true };
      }
      default:
        return { handled: false };
    }
  }

  function onKeyDown(event) {
    if (destroyed) return;
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey ||
        ['Tab', ' ', 'Spacebar', 'Backspace'].includes(event.key) ||
        (/^F(?:[1-9]|1[0-2])$/.test(event.key) && !(event.shiftKey && event.key === 'F10'))) return;
    for (let node = event.target; node && node !== container; node = node.parentElement) {
      if (interactionContainers.has(node)) return;
    }
    // Chart shortcuts require the region (or a control inside it) to hold
    // focus; pointer interaction explicitly focuses the region first.
    const active = doc.activeElement;
    const focusedInside = active === container || (active && contains(container, active));
    if (!focusedInside) return;
    if (!isEditableTarget(event.target) && !(event.shiftKey && event.key === 'F10') && toolState && typeof toolState.handleKey === 'function') {
      try {
        if (toolState.handleKey(event)) {
          if (typeof event.preventDefault === 'function') event.preventDefault();
          return;
        }
      } catch (error) {
        reportError(error, { action: 'drawing-construction' });
        if (typeof event.preventDefault === 'function') event.preventDefault();
        return;
      }
    }
    if (event.key === 'Delete' && !isEditableTarget(event.target) &&
        adapter.drawings?.getSelection?.().length && typeof adapter.drawings.removeSelected === 'function') {
      try {
        adapter.drawings.removeSelected();
        clearSelection();
      } catch (error) {
        reportError(error, { action: 'removeSelected' });
      }
      event.preventDefault();
      return;
    }
    const resolved = keyboard.resolveEvent(event, { target: event.target });
    if (resolved === null) return;
    let outcome = null;
    try {
      outcome = runKeyboardAction(resolved, event);
    } catch (error) {
      reportError(error, { action: resolved });
      return;
    }
    if (outcome && outcome.handled === false) {
      // The chart consumed nothing, so the key keeps its page/dialog meaning.
      return;
    }
    if (typeof event.preventDefault === 'function') event.preventDefault();
  }

  /* ------------------------------- panes ------------------------------ */
  const unsubscribePanes = panes.subscribe((change) => {
    try {
      adapter.applyPaneLayout(panes.list());
    } catch (error) {
      reportError(error, { action: 'applyPaneLayout' });
    }
    checkMenuTarget();
    emitter.emit('panesChange', change);
  });

  function registerPaneRestore(id, element) {
    paneRestoreElements.set(`pane-restore:${id}`, element);
  }

  function unregisterPaneRestore(id) {
    paneRestoreElements.delete(`pane-restore:${id}`);
  }

  /* ----------------------------- listeners ---------------------------- */
  disposers.push(on(container, 'pointerdown', onPointerDown));
  disposers.push(on(container, 'pointermove', onPointerMove));
  disposers.push(on(container, 'pointerup', finishPointer));
  disposers.push(on(container, 'pointercancel', onPointerCancel));
  disposers.push(on(container, 'lostpointercapture', onLostCapture));
  disposers.push(on(container, 'pointerleave', onPointerLeave));
  disposers.push(on(container, 'wheel', onWheel, { passive: false }));
  disposers.push(on(container, 'dblclick', onDoubleClick));
  disposers.push(on(container, 'contextmenu', onContextMenu));
  disposers.push(on(container, 'keydown', onKeyDown));
  disposers.push(on(container, 'focus', () => setFocusVisible(true)));
  disposers.push(on(container, 'blur', () => setFocusVisible(false)));
  if (options.touch !== false && container.style) setStyle(container, { touchAction: 'none' });

  const unsubscribeData = adapter.subscribe('datachange', () => {
    rowsDirty = true;
    syncReadoutTheme();
    cachedRows = null;
    crosshair.refresh('data');
    checkMenuTarget();
  });
  const unsubscribeRange = adapter.subscribe('visibleRangeChange', () => {
    rowsDirty = true;
    syncReadoutTheme();
    crosshair.refresh('range');
  });
  const unsubscribeDestroy = adapter.subscribe('destroy', () => interaction.destroy());

  function checkMenuTarget() {
    if (!menuOpen) return;
    const target = menuOpen.target;
    let exists = true;
    if (target.paneId) exists = panes.list().some((pane) => pane.id === target.paneId && pane.visible);
    if (exists && target.drawingId) {
      const drawing = getDrawing(target.drawingId);
      exists = Boolean(drawing) && drawing.visible !== false;
    }
    if (!exists) {
      const list = panes.list().filter((pane) => pane.visible);
      const neighbor = list.length > 0 ? `pane-restore:${list[0].id}` : 'chart-region';
      const result = menuOpen.model.targetRemoved(neighbor);
      if (menuOpen) {
        const element = menuOpen.element;
        if (element.parentNode) element.parentNode.removeChild(element);
        if (menuOpen.unsubscribeDoc) menuOpen.unsubscribeDoc();
        menuOpen = null;
      }
      if (result.focusId) restoreFocus(result.focusId);
      emitter.emit('menuClosed', { reason: 'target-removed' });
    }
  }

  const view = doc.defaultView;
  let announceTimer = null;
  if (view && typeof view.setInterval === 'function') {
    announceTimer = view.setInterval(() => {
      const flushed = announcer.flush();
      if (flushed.announced) writeLive(flushed.text);
    }, options.announceFlushMs === undefined ? 400 : options.announceFlushMs);
  }
  cleanupTasks.push(() => {
    if (announceTimer !== null && view && typeof view.clearInterval === 'function') view.clearInterval(announceTimer);
  });

  /* -------------------------------- API ------------------------------- */
  let scope = null;
  function detach() {
    if (destroyed) return;
    destroyed = true;
    interactionContainers.delete(container);
    cancelActive(CANCEL_REASONS.DESTROY);
    closeMenu('destroy');
    for (const dispose of disposers.splice(0)) dispose();
    unsubscribeData();
    unsubscribeRange();
    unsubscribeDestroy();
    unsubscribeCrosshair();
    unsubscribePanes();
    for (const task of cleanupTasks.splice(0)) task();
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (readout.parentNode) readout.parentNode.removeChild(readout);
    for (const region of [instructions, liveRegion, errorRegion]) {
      if (region.parentNode) region.parentNode.removeChild(region);
    }
    if (tableElement && tableElement.parentNode) tableElement.parentNode.removeChild(tableElement);
    if (container.style) {
      if (previousContainerPosition === null || previousContainerPosition === undefined) delete container.style.position;
      else container.style.position = previousContainerPosition;
    }
    if (container.style) {
      container.style.outline = previousOutline;
      container.style.outlineOffset = previousOutlineOffset;
    }
    paneRestoreElements.clear();
    emitter.offAll();
    scope?.dispose();
  }

  const interaction = {
    chart,
    adapter,
    container,
    get destroyed() {
      return destroyed;
    },
    detach,
    destroy: detach,
    subscribe(event, handler) {
      return emitter.on(event, handler);
    },
    getState() {
      return {
        activePaneId,
        selection,
        crosshair: crosshair.payload,
        follow: navigation.follow,
        capture: router.capture,
        panes: panes.list(),
        bindings: keyboard.getBindings(),
        crosshairActive: keyboard.crosshairActive,
      };
    },
    hitTest(point) {
      return hitAt(point);
    },
    selectDrawing(id) {
      if (typeof id !== 'string') return { ok: false, code: 'INVALID_ID' };
      const exists = drawingsList().some((entry) => entry.id === id);
      if (!exists) return { ok: false, code: 'UNKNOWN_DRAWING', id };
      selectDrawing(id);
      return { ok: true, drawingId: id };
    },
    clearSelection,
    getSelection() {
      return selection;
    },
    fitContent: (paneId = activePaneId) => navigation.fitContent(paneId),
    scrollToRealTime: (paneId = activePaneId) => navigation.scrollToRealTime(paneId),
    enablePriceAuto(paneId = activePaneId, scaleId = null) {
      const result = navigation.enablePriceAuto(paneId, scaleId);
      emitter.emit('viewChange', { reason: 'price-auto', result });
      return result;
    },
    setFollow(enabled, paneId = activePaneId) {
      const result = navigation.setFollow(enabled, paneId);
      emitter.emit('viewChange', { reason: 'follow', result });
      return result;
    },
    toggleLogScale: (paneId = activePaneId) => toggleLogScaleOf(paneId),
    getPriceScaleMode: (paneId = activePaneId) => primaryPriceMode(paneId),
    getFollow: () => adapter.paneKind(activePaneId) !== 'derived' && navigation.follow,
    zoomIndex(factor, anchorX = null, paneId = activePaneId) {
      return navigation.zoomIndex(factor, anchorX, paneId);
    },
    panByPixels(dx, dy, paneId = activePaneId) {
      return navigation.pan(dx, dy, paneId);
    },
    resetIndexStep(anchorX = null, paneId = activePaneId) {
      return navigation.resetIndexStep(anchorX, paneId);
    },
    setTool(tool) {
      if (tool !== null && (typeof tool !== 'object' || typeof tool.end !== 'function')) {
        return { ok: false, code: 'INVALID_TOOL' };
      }
      if (toolState && toolState !== tool && typeof toolState.cancel === 'function' && toolState.active) toolState.cancel('tool-changed');
      toolState = tool || null;
      emitter.emit('toolChange', { toolId: toolState && toolState.id || null });
      return { ok: true };
    },
    getTool() {
      return toolState;
    },
    setDrawingSnap(value) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(tr('snap.notObject'));
      const allowed = ['mode', 'threshold', 'magnet', 'magnetThreshold', 'rounding', 'step', 'sourceId', 'modifier'];
      for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(tr('snap.unknownOption', { key }));
      const next = { ...drawingSnap, ...value };
      if (!['free', 'weak', 'strong'].includes(next.mode)) throw new Error(tr('snap.badMode'));
      for (const key of ['threshold', 'magnetThreshold']) {
        if (next[key] !== undefined && (!Number.isFinite(next[key]) || next[key] < 0)) throw new Error(tr('snap.notNonNegative', { key }));
      }
      for (const key of ['magnet', 'rounding']) {
        if (next[key] !== undefined && typeof next[key] !== 'boolean') throw new Error(tr('snap.notBoolean', { key }));
      }
      if (next.modifier !== null && !SNAP_MODIFIERS.includes(next.modifier)) {
        throw Object.assign(new Error(tr('snap.badModifier')), { field: 'modifier' });
      }
      if (next.sourceId !== undefined && typeof next.sourceId !== 'string') throw new Error(tr('snap.sourceIdNotString'));
      if (next.step !== undefined && (!Number.isFinite(next.step) || next.step <= 0)) throw new Error(tr('snap.stepNotPositive'));
      if (next.rounding === true && next.step === undefined) throw new Error(tr('snap.roundingNeedsStep'));
      drawingSnap = next;
      return { ...drawingSnap };
    },
    getDrawingSnap() { return { ...drawingSnap }; },
    armDrawing(id, config = {}) {
      const pane = paneById(config.paneId || activePaneId);
      if (!pane) throw new Error(tr('pane.unavailable'));
      const binding = { paneId: pane.id, scaleId: config.scaleId || primaryScaleId(pane) };
      const tool = createDrawingTool(chart, id, {
        binding, props: config.props || {}, getSnap: () => drawingSnap, locale: uiLocale,
        announce: text => announce(text),
        complete: () => interaction.setTool(null),
      });
      ownedTools.add(tool);
      interaction.setTool(tool);
      focusElement(container);
      announce(tr('instructions.drawing'));
      return tool;
    },
    cancelGesture(reason = CANCEL_REASONS.ESCAPE) {
      return { cancelled: cancelActive(reason) };
    },
    crosshair: {
      selectBar: (barId, paneId = activePaneId) => crosshair.selectBar(barId, paneId),
      next: () => crosshairNav.next(),
      prev: () => crosshairNav.prev(),
      clear: () => {
        crosshairNav.clear();
        return crosshair.clearSelection();
      },
      getPayload: () => crosshair.payload,
      subscribe: (handler) => crosshair.subscribe(handler),
      nav: crosshairNav,
    },
    keyboard: {
      activate(action) {
        let result;
        switch (action) {
          case 'crosshairPrev': result = crosshairNav.prev(); break;
          case 'crosshairNext': result = crosshairNav.next(); break;
          case 'panLeft': result = navigation.keyboardPan(-1, activePaneId); break;
          case 'panRight': result = navigation.keyboardPan(1, activePaneId); break;
          case 'zoomIn': result = navigation.keyboardZoom(1, activePaneId); break;
          case 'zoomOut': result = navigation.keyboardZoom(-1, activePaneId); break;
          case 'priceZoomIn': result = navigation.keyboardPriceZoom(1, activePaneId); break;
          case 'priceZoomOut': result = navigation.keyboardPriceZoom(-1, activePaneId); break;
          default: throw new InteractionError('Unknown keyboard button action', { code: 'INVALID_ARGUMENT', field: 'action' });
        }
        if (result?.ok === false || result?.applied === false) {
          return { ok: false, reason: tr('announce.actionUnavailable') };
        }
        return { ok: true, result };
      },
      setBindings(bindings) {
        const result = keyboard.setBindings(bindings);
        updateKeyboardInstructions();
        return result;
      },
      getBindings: () => keyboard.getBindings(),
      resolveEvent: (event, meta) => keyboard.resolveEvent(event, meta),
      handleKey: (event) => onKeyDown(event),
      setCrosshairActive: (active) => keyboard.setCrosshairActive(active),
      get crosshairActive() {
        return keyboard.crosshairActive;
      },
    },
    panes: {
      layout: panes,
      list: () => panes.list(),
      hide(id) {
        return hidePaneKeepingFocus(id);
      },
      show: (id) => panes.show(id),
      move: (id, direction) => panes.move(id, direction),
      setVisible: (id, visible) => visible === true ? panes.setVisible(id, true) : hidePaneKeepingFocus(id),
      beginResize: (id) => panes.beginResize(id),
      previewResize: (id, height) => panes.previewResize(id, height),
      commitResize: () => panes.commitResize(),
      cancelResize: () => panes.cancelResize(),
      resizeByKeyboard: (id, delta) => panes.resizeByKeyboard(id, delta),
      registerRestoreControl: registerPaneRestore,
      unregisterRestoreControl: unregisterPaneRestore,
    },
    menu: {
      open: (params) => openMenu(params || {}),
      close: (reason) => closeMenu(reason),
      isOpen: () => menuOpen !== null,
    },
    accessible: {
      rows,
      tableModel,
      announce,
      announceError: (text) => announce(text, { error: true }),
      liveRegion,
      errorRegion,
      instructions,
      table: tableElement,
      setTableElement(element) {
        tableElement = element;
        return tableElement;
      },
      focusRegistry,
      registerFocusTarget(id, element) {
        focusRegistry.set(id, element);
        return () => focusRegistry.delete(id);
      },
    },
    registerFocusTarget(id, element) {
      focusRegistry.set(id, element);
      return () => focusRegistry.delete(id);
    },
  };

  if (options.accessibleTable === true) {
    const section = createElement(doc, 'section', { class: 'chart-accessible-alternative', 'aria-label': tr('chart.accessibleTable') });
    const caption = createElement(doc, 'caption', {}, options.tableCaption || tr('chart.tableCaption'));
    const table = createElement(doc, 'table', {});
    append(table, caption);
    const head = createElement(doc, 'thead', {});
    const body = createElement(doc, 'tbody', {});
    append(table, head, body);
    append(section, table);
    append(options.a11yContainer || container, section);
    tableElement = table;
    tableBody = body;
    const updateTable = () => {
      const model = tableModel();
      clearElement(head);
      const headerRow = createElement(doc, 'tr', {});
      for (const column of model.columns) append(headerRow, createElement(doc, 'th', { scope: 'col' }, column.label));
      append(head, headerRow);
      clearElement(body);
      for (const row of model.rows) {
        const tr = createElement(doc, 'tr', {});
        row.forEach((cell) => append(tr, createElement(doc, 'td', {}, cell)));
        append(body, tr);
      }
    };
    updateTable();
    disposers.push(adapter.subscribe('datachange', updateTable));
  }

  if (typeof chart._assertAlive !== 'function') return interaction;
  scope = createModuleScope(chart, 'interaction', interaction, {
    subscriptions: ['subscribe'],
    results: { armDrawing: {}, getTool: tool => tool && ownedTools.has(tool) ? {} : null, registerFocusTarget: {} },
    properties: {
      adapter: { methods: ['priceScale', 'layout', 'drawingsList', 'getPanes', 'applyPaneLayout', 'indexScaleFor', 'slotsFor', 'paneKind', 'sourceBarId', 'derivedElementId', 'getSeriesValues', 'subscribe'], subscriptions: ['subscribe'] },
      crosshair: { subscriptions: ['subscribe'], properties: { nav: {} } },
      keyboard: {},
      panes: { properties: { layout: { subscriptions: ['subscribe'] } } },
      menu: {},
      accessible: {
        results: { registerFocusTarget: {} },
        properties: { focusRegistry: { collection: true, results: { keys: {}, values: {}, entries: {}, [Symbol.iterator]: {} } } }
      }
    }
  });
  return scope.api;
}

export { CANCEL_REASONS, MENU_TARGET_KINDS };
