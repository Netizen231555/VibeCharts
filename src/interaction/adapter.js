/**
 * Adapter between the interaction layer and the chart core.
 *
 * The interaction layer never imports core internals. It consumes the
 * documented public API (`timeline`, `indexScale()`, `priceScale()`,
 * `subscribe`, `drawings`) plus the small set of geometry and state hooks
 * listed in `docs/contract.md`. Missing hooks fail loudly with the exact names,
 * because silently degraded input handling would hide a broken integration.
 */
import { InteractionError } from './errors.js';
import { isFiniteNumber, rect } from './geometry.js';

const INDEX_SCALE_METHODS = [
  'coordinateToIndex',
  'indexToBarId',
  'barIdToIndex',
  'indexToCoordinate',
  'barIdToCoordinate',
  'coordinateToLogical',
  'logicalToCoordinate',
  'getVisibleRange',
  'setVisibleRange',
  'fitContent',
  'scrollToRealTime',
];

const PRICE_SCALE_METHODS = ['priceToCoordinate', 'coordinateToPrice', 'getVisibleRange', 'setVisibleRange', 'setAutoScale'];

const DIRECTIONAL_SCALE_METHODS = ['isFollowingRealTime', 'setFollowRealTime'];

function derivedElementValues(element) {
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if ([element.open, element.high, element.low, element.close].every(finite)) {
    return { open: element.open, high: element.high, low: element.low, close: element.close };
  }
  const value = [element.toPrice, element.level].find(finite);
  return value === undefined ? null : { value };
}

function requireMethod(target, name, owner) {
  if (!target || typeof target[name] !== 'function') {
    throw new InteractionError(`Chart integration is missing ${owner}.${name}()`, {
      code: 'MISSING_CHART_HOOK',
      field: `${owner}.${name}`,
    });
  }
}

function requireObject(value, field) {
  if (value === null || typeof value !== 'object') {
    throw new InteractionError(`Expected an object in ${field}`, { code: 'INVALID_LAYOUT', field });
  }
  return value;
}

function normalizeRect(value, field) {
  if (!value) throw new InteractionError(`Missing rectangle in ${field}`, { code: 'INVALID_LAYOUT', field });
  if ('left' in value || 'right' in value) {
    const { left, top, right, bottom } = value;
    if (![left, top, right, bottom].every(isFiniteNumber) || right < left || bottom < top) {
      throw new InteractionError(`Invalid rectangle in ${field}`, { code: 'INVALID_LAYOUT', field });
    }
    return rect(left, top, right - left, bottom - top);
  }
  const { x, y, width, height } = value;
  if (![x, y, width, height].every(isFiniteNumber) || width < 0 || height < 0) {
    throw new InteractionError(`Invalid rectangle in ${field}`, { code: 'INVALID_LAYOUT', field });
  }
  return rect(x, y, width, height);
}

export function normalizeLayout(raw) {
  requireObject(raw, 'layout');
  const width = raw.width;
  const height = raw.height;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width < 0 || height < 0) {
    throw new InteractionError('Invalid chart size in layout', { code: 'INVALID_LAYOUT', field: 'layout.width' });
  }
  const devicePixelRatio = raw.devicePixelRatio === undefined ? 1 : raw.devicePixelRatio;
  if (!isFiniteNumber(devicePixelRatio) || devicePixelRatio <= 0) {
    throw new InteractionError('Invalid devicePixelRatio in layout', { code: 'INVALID_LAYOUT', field: 'layout.devicePixelRatio' });
  }
  const rawPanes = raw.panes;
  if (!Array.isArray(rawPanes) || rawPanes.length === 0) {
    throw new InteractionError('Layout must describe at least one pane', { code: 'INVALID_LAYOUT', field: 'layout.panes' });
  }
  const seen = new Set();
  const panes = rawPanes.map((pane, index) => {
    requireObject(pane, `layout.panes[${index}]`);
    if (typeof pane.id !== 'string' || pane.id.length === 0) {
      throw new InteractionError('Pane id must be a non-empty string', { code: 'INVALID_LAYOUT', field: `layout.panes[${index}].id` });
    }
    if (seen.has(pane.id)) {
      throw new InteractionError(`Duplicate pane id ${pane.id}`, { code: 'INVALID_LAYOUT', field: 'layout.panes.id', detail: pane.id });
    }
    seen.add(pane.id);
    const plot = normalizeRect(pane.plot, `layout.panes[${index}].plot`);
    const priceScales = (pane.priceScales || []).map((scale, scaleIndex) => {
      requireObject(scale, `layout.panes[${index}].priceScales[${scaleIndex}]`);
      if (typeof scale.id !== 'string' || scale.id.length === 0) {
        throw new InteractionError('Price scale id must be a non-empty string', {
          code: 'INVALID_LAYOUT',
          field: `layout.panes[${index}].priceScales[${scaleIndex}].id`,
        });
      }
      if (scale.side !== 'left' && scale.side !== 'right') {
        throw new InteractionError('Price scale side must be left or right', {
          code: 'INVALID_LAYOUT',
          field: `layout.panes[${index}].priceScales[${scaleIndex}].side`,
        });
      }
      return {
        id: scale.id,
        side: scale.side,
        rect: normalizeRect(scale.rect, `layout.panes[${index}].priceScales[${scaleIndex}].rect`),
        inverted: scale.inverted === true,
      };
    });
    const heightValue = pane.height === undefined ? plot.height : pane.height;
    const minHeight = pane.minHeight === undefined ? 0 : pane.minHeight;
    if (!isFiniteNumber(heightValue) || heightValue < 0 || !isFiniteNumber(minHeight) || minHeight < 0) {
      throw new InteractionError('Invalid pane height', { code: 'INVALID_LAYOUT', field: `layout.panes[${index}].height` });
    }
    return {
      id: pane.id,
      plot,
      priceScales,
      indexAxis: pane.indexAxis === undefined || pane.indexAxis === null ? null : normalizeRect(pane.indexAxis, `layout.panes[${index}].indexAxis`),
      visible: pane.visible !== false,
      height: heightValue,
      minHeight,
      order: pane.order === undefined ? index : pane.order,
    };
  });
  const sorted = panes.sort((a, b) => a.order - b.order);
  // Cores may expose the shared time axis only in their renderer layout. Derive
  // it from the leftover height under every pane (a derived pane keeps its own
  // `indexAxis` strip, which is inside the pane) so axis gestures still have a
  // hit region and the crosshair a place for its time plate.
  const visible = sorted.filter((pane) => pane.visible);
  const bottom = visible.reduce((max, pane) => Math.max(max, pane.indexAxis ? pane.indexAxis.y + pane.indexAxis.height : pane.plot.y + pane.plot.height), 0);
  const axisHeight = height - bottom;
  let timeAxis = null;
  const owner = [...visible].reverse().find((pane) => !pane.indexAxis);
  if (axisHeight > 0 && owner) {
    timeAxis = rect(owner.plot.x, bottom, owner.plot.width, axisHeight);
    owner.indexAxis = timeAxis;
  }
  return {
    width,
    height,
    devicePixelRatio,
    rect: raw.rect === undefined ? rect(0, 0, width, height) : normalizeRect(raw.rect, 'layout.rect'),
    panes: sorted,
    timeAxis,
  };
}

/**
 * Validate the chart and return the adapter the interaction layer works with.
 * `options` may supply `container`, drawables and clocks; nothing is defaulted
 * for required chart state.
 */
export function resolveInteractionAdapter(chart, options = {}) {
  if (!chart || typeof chart !== 'object') {
    throw new InteractionError('attachInteraction requires a chart instance', { code: 'INVALID_CHART', field: 'chart' });
  }
  requireMethod(chart, 'indexScale', 'chart');
  requireMethod(chart, '_paneXContext', 'chart');
  requireMethod(chart, 'priceScale', 'chart');
  requireMethod(chart, 'subscribe', 'chart');
  requireMethod(chart, 'getInteractionLayout', 'chart');
  requireMethod(chart, 'getPanes', 'chart');
  requireMethod(chart, 'applyPaneLayout', 'chart');
  requireMethod(chart, 'getSeriesValues', 'chart');
  if (!chart.timeline || typeof chart.timeline !== 'object') {
    throw new InteractionError('Chart integration is missing timeline', { code: 'MISSING_CHART_HOOK', field: 'chart.timeline' });
  }
  requireMethod(chart.timeline, 'listSlots', 'chart.timeline');

  const indexScale = chart.indexScale();
  for (const name of INDEX_SCALE_METHODS) requireMethod(indexScale, name, 'chart.indexScale()');
  for (const name of DIRECTIONAL_SCALE_METHODS) requireMethod(indexScale, name, 'chart.indexScale()');

  const container = options.container || chart.container;
  if (!container || typeof container !== 'object' || typeof container.addEventListener !== 'function') {
    throw new InteractionError('Chart integration is missing the container element', {
      code: 'MISSING_CHART_HOOK',
      field: 'chart.container',
    });
  }

  const requireDrawings = options.drawings !== false;
  const initialDrawings = chart.drawings;
  if (requireDrawings && initialDrawings) {
    if (typeof initialDrawings !== 'object') {
      throw new InteractionError('chart.drawings must be an object', { code: 'MISSING_CHART_HOOK', field: 'chart.drawings' });
    }
    requireMethod(initialDrawings, 'list', 'chart.drawings');
    requireMethod(initialDrawings, 'get', 'chart.drawings');
  }

  const priceScale = (paneId, scaleId) => {
    const scale = chart.priceScale(paneId, scaleId);
    if (!scale || typeof scale !== 'object') {
      throw new InteractionError(`Unknown price scale ${scaleId} in pane ${paneId}`, {
        code: 'UNKNOWN_PRICE_SCALE',
        field: 'scaleId',
        detail: { paneId, scaleId },
      });
    }
    for (const name of PRICE_SCALE_METHODS) requireMethod(scale, name, `chart.priceScale(${paneId}, ${scaleId})`);
    requireMethod(scale, 'isAutoScale', `chart.priceScale(${paneId}, ${scaleId})`);
    return scale;
  };

  // A null pane means the main timeline scale; a pane id uses that pane's x context.
  const xContext = (paneId) => {
    if (paneId === null || paneId === undefined) return { kind: 'source', view: null, scale: chart.indexScale(), conflict: null };
    return chart._paneXContext(paneId);
  };

  const layout = () => normalizeLayout(chart.getInteractionLayout());

  return {
    chart,
    container,
    document: container.ownerDocument || null,
    indexScaleFor: (paneId) => xContext(paneId).scale,
    slotsFor: (paneId) => {
      const context = xContext(paneId);
      return context.kind === 'derived' ? context.scale.slots() : chart.timeline.listSlots();
    },
    // Crosshair recomputation runs on every pointer and wheel event; copying the whole
    // timeline there dominated zoom profiles on long histories. The accessor reads
    // slots in place; only the crosshair consumes it and never mutates a slot.
    slotAccessorFor: (paneId) => {
      const context = xContext(paneId);
      if (context.kind !== 'source') return null;
      const timeline = chart.timeline;
      return { count: timeline.length, at: (index) => timeline._slotAt(index) };
    },
    paneKind: (paneId) => xContext(paneId).kind,
    sourceBarId: (paneId, id) => {
      if (id === null || id === undefined) return id ?? null;
      const context = xContext(paneId);
      return context.kind === 'derived' ? context.view.elementToBarId(id) : id;
    },
    derivedElementId: (paneId, id) => {
      const context = xContext(paneId);
      return context.kind === 'derived' && context.view.element(id) ? id : null;
    },
    priceScale,
    layout,
    get drawings() {
      return chart.drawings || null;
    },
    drawingsList: () => {
      // A chart without the drawings module simply has no drawable targets;
      // drawings attached later are picked up because the store is looked up
      // on every query.
      const drawings = chart.drawings;
      if (!drawings || typeof drawings.list !== 'function') return [];
      const list = drawings.list();
      if (!Array.isArray(list)) return [];
      if (typeof drawings.layout !== 'function') return list;
      // The drawing store resolves visibility (including groups) and anchors.
      // Reflect that so hidden or unresolved drawings never intercept input.
      return list.map((drawing, index) => {
        const resolved = drawings.layout(drawing.id);
        if (!resolved) return drawing;
        return {
          ...drawing,
          visible: resolved.visible !== false && resolved.resolved !== false,
          locked: resolved.locked === true || drawing.locked === true,
          order: typeof resolved.order === 'number' ? resolved.order : index,
        };
      });
    },
    getPanes: () => chart.getPanes(),
    applyPaneLayout: (panes) => chart.applyPaneLayout(panes),
    getSeriesValues: (paneId, id) => {
      const context = xContext(paneId);
      if (context.kind === 'derived' && id !== null) {
        // A derived pane reports the element itself; source series values of
        // the completion bar would describe another x axis.
        const element = context.view.element(id);
        const values = element ? derivedElementValues(element) : null;
        return element ? [{ seriesId: context.view.sourceId, paneId, type: context.view.type, values }] : [];
      }
      // Hidden series (for example the source of an independent derived view) draw nothing, so they have no value to read.
      const hidden = new Set((chart.series?.list?.() ?? []).filter((entry) => entry.visible === false).map((entry) => entry.id));
      const values = (chart.getSeriesValues(id) || []).filter((entry) => !hidden.has(entry.seriesId));
      if (id === null && values.length === 0) {
        // Explicit absence for every series, never a fabricated zero.
        return (chart.getPanes() || []).flatMap((pane) =>
          (pane.seriesIds || []).map((seriesId) => ({ seriesId, paneId: pane.id, type: null, values: null })),
        );
      }
      return values;
    },
    subscribe: (event, handler) => chart.subscribe(event, handler),
    now: typeof options.now === 'function' ? options.now : () => Date.now(),
    initialBarSpacing: isFiniteNumber(options.initialBarSpacing) ? options.initialBarSpacing : (isFiniteNumber(indexScale.barSpacing) ? indexScale.barSpacing : null),
    requestFrame: typeof options.requestFrame === 'function' ? options.requestFrame : null,
  };
}
