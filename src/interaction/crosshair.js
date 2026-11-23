/**
 * Crosshair computation and state.
 *
 * Inside history the X axis snaps to the nearest existing slot and reports its
 * `barId`; outside history it stays free and reports a signed fractional
 * offset from the nearest history edge without inventing a bar, index, time or
 * date. Series values are read through the adapter; a series without a point in
 * the selected slot is reported as absent instead of a zero or interpolation.
 */
import { isFiniteNumber } from './geometry.js';
import { createEmitter } from './emitter.js';
import { absentText } from './messages.js';

const EMPTY_SERIES = Object.freeze({ present: false, values: null });

export function normalizeSeriesValues(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    const values = entry && entry.values ? entry.values : null;
    const present = values !== null && typeof values === 'object';
    return {
      seriesId: entry.seriesId,
      paneId: entry.paneId ?? null,
      type: entry.type ?? null,
      present,
      values: present ? { ...values } : null,
    };
  });
}

function finiteOrNull(value) {
  return isFiniteNumber(value) ? value : null;
}

/**
 * Compute the crosshair payload for a point.
 * All arguments are plain values so this is testable without DOM.
 */
export function computeCrosshair({
  point,
  pane,
  indexScale,
  priceScale = null,
  slots = [],
  slotAccessor = null,
  seriesValues = () => [],
  priceAxisId = null,
  derived = false,
  sourceBarId = (id) => id,
}) {
  if (!point || !pane) {
    return emptyPayload();
  }
  const slotCount = slotAccessor ? slotAccessor.count : slots.length;
  const lastIndex = slotCount - 1;
  // The payload needs one slot, not a barId index: read it by timeline position and
  // confirm the identity, so no per-event Map of the whole history is built.
  const slotAtIndex = (index, barId) => {
    if (index === null || index < 0 || index >= slotCount) return null;
    const slot = slotAccessor ? slotAccessor.at(index) : slots[index];
    return slot && slot.barId === barId ? slot : null;
  };
  const plotX = pane.plot?.x ?? 0;
  const plotY = pane.plot?.y ?? 0;
  let index = indexScale.coordinateToIndex(point.x - plotX);
  const logical = finiteOrNull(indexScale.coordinateToLogical(point.x - plotX));
  // Coordinate round trips at the edge can differ by a few floating-point ULPs.
  if (index === null && logical !== null && lastIndex >= 0) {
    const tolerance = 16 * Number.EPSILON * Math.max(1, lastIndex);
    if (Math.abs(logical) <= tolerance) index = 0;
    else if (Math.abs(logical - lastIndex) <= tolerance) index = lastIndex;
  }
  let price = null;
  if (priceScale) {
    price = finiteOrNull(priceScale.coordinateToPrice(point.y - plotY));
  }
  if (index !== null) {
    const barId = indexScale.indexToBarId(index);
    if (barId === null || barId === undefined) {
      return { ...emptyPayload(), visible: true, paneId: pane.id, x: point.x, y: point.y, price, priceAxisId };
    }
    const slot = slotAtIndex(index, barId);
    // A derived element has no time of its own; never borrow the source bar's.
    const time = !derived && slot && isFiniteNumber(slot.time) ? slot.time : null;
    const sessionDate = !derived && slot && slot.sessionDate ? { ...slot.sessionDate } : null;
    const snappedX = finiteOrNull(indexScale.indexToCoordinate(index));
    return {
      visible: true,
      paneId: pane.id,
      x: snappedX === null ? point.x : plotX + snappedX,
      pointerX: point.x,
      y: point.y,
      price,
      priceAxisId,
      barId: derived ? sourceBarId(barId) : barId,
      ...(derived ? { derivedElementId: barId } : {}),
      index,
      logical: index,
      offset: 0,
      offsetAnchorIndex: index,
      insideHistory: true,
      time,
      sessionDate,
      series: normalizeSeriesValues(seriesValues(barId)),
    };
  }
  let offset = null;
  let offsetAnchorIndex = null;
  if (logical !== null && lastIndex >= 0) {
    if (logical > lastIndex) {
      offset = logical - lastIndex;
      offsetAnchorIndex = lastIndex;
    } else if (logical < 0) {
      offset = logical;
      offsetAnchorIndex = 0;
    } else {
      offset = logical - Math.floor(logical);
      offsetAnchorIndex = Math.floor(logical);
    }
  }
  return {
    visible: true,
    paneId: pane.id,
    x: point.x,
    y: point.y,
    price,
    priceAxisId,
    barId: null,
    index: null,
    logical,
    offset,
    offsetAnchorIndex,
    insideHistory: false,
    time: null,
    sessionDate: null,
    series: normalizeSeriesValues(seriesValues(null)),
  };
}

export function emptyPayload() {
  return {
    visible: false,
    paneId: null,
    x: null,
    y: null,
    price: null,
    priceAxisId: null,
    barId: null,
    index: null,
    logical: null,
    offset: null,
    offsetAnchorIndex: null,
    insideHistory: false,
    time: null,
    sessionDate: null,
    series: [],
  };
}

function formatNumber(value, digits) {
  if (!isFiniteNumber(value)) return null;
  if (isFiniteNumber(digits) && digits >= 0) return value.toFixed(digits);
  return String(value);
}

export function formatOffset(value, locale) {
  try {
    return new Intl.NumberFormat(locale, { maximumSignificantDigits: 7, signDisplay: 'exceptZero', useGrouping: false }).format(value);
  } catch {
    return `${value > 0 ? '+' : ''}${value}`;
  }
}

/**
 * Build the textual readout for the currently selected slot. Absent fields
 * are rendered as explicit absence, never as zero or a synthesized date.
 * `priceFormatter(seriesId | null, value)` (null = the crosshair price) takes
 * precedence over `priceDigits`, so a host can format by series metadata.
 */
export function buildReadout(payload, { locale, absent = absentText(locale), timeFormatter = null, priceDigits = null, priceFormatter = null, volumeDigits = null, priceUnit = null, volumeUnit = null } = {}) {
  if (!payload || payload.visible !== true) return null;
  const rows = [];
  const priceText = (value, seriesId = null) => {
    if (!isFiniteNumber(value)) return absent;
    if (priceFormatter) return priceFormatter(seriesId, value);
    return `${formatNumber(value, priceDigits)}${priceUnit ? ` ${priceUnit}` : ''}`;
  };
  const volumeText = (value) => (isFiniteNumber(value) ? `${formatNumber(value, volumeDigits)}${volumeUnit ? ` ${volumeUnit}` : ''}` : absent);
  if (payload.barId !== null) {
    rows.push({ field: 'barId', label: 'barId', value: payload.barId });
    if (payload.derivedElementId !== undefined) {
      // A derived element has no time or session date of its own.
      rows.push({ field: 'derivedElementId', label: 'element', value: payload.derivedElementId });
    } else {
      if (payload.time !== null) {
        rows.push({ field: 'time', label: 'time', value: timeFormatter ? timeFormatter(payload.time) : new Date(payload.time).toISOString() });
      } else {
        rows.push({ field: 'time', label: 'time', value: absent, absent: true });
      }
      if (payload.sessionDate) {
        const { year, month, day } = payload.sessionDate;
        rows.push({ field: 'sessionDate', label: 'sessionDate', value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` });
      } else {
        rows.push({ field: 'sessionDate', label: 'sessionDate', value: absent, absent: true });
      }
    }
    // With several series a bare field name is ambiguous, so the series id leads the label.
    const labelOf = (series, field) => (payload.series.length > 1 ? `${series.seriesId} ${field}` : field);
    for (const series of payload.series) {
      if (!series.present) {
        rows.push({ field: `series:${series.seriesId}`, label: series.seriesId, value: absent, absent: true });
        continue;
      }
      const values = series.values;
      if (Object.prototype.hasOwnProperty.call(values, 'close')) {
        rows.push({ field: `series:${series.seriesId}:open`, label: labelOf(series, 'open'), value: priceText(values.open, series.seriesId), absent: !isFiniteNumber(values.open) });
        rows.push({ field: `series:${series.seriesId}:high`, label: labelOf(series, 'high'), value: priceText(values.high, series.seriesId), absent: !isFiniteNumber(values.high) });
        rows.push({ field: `series:${series.seriesId}:low`, label: labelOf(series, 'low'), value: priceText(values.low, series.seriesId), absent: !isFiniteNumber(values.low) });
        rows.push({ field: `series:${series.seriesId}:close`, label: labelOf(series, 'close'), value: priceText(values.close, series.seriesId), absent: !isFiniteNumber(values.close) });
        rows.push({ field: `series:${series.seriesId}:volume`, label: labelOf(series, 'volume'), value: volumeText(values.volume), absent: !isFiniteNumber(values.volume) });
      } else {
        rows.push({ field: `series:${series.seriesId}:value`, label: labelOf(series, 'value'), value: priceText(values.value, series.seriesId), absent: !isFiniteNumber(values.value) });
      }
    }
  }
  if (isFiniteNumber(payload.price)) {
    rows.push({ field: 'price', label: 'price', value: priceText(payload.price) });
  }
  if (payload.barId === null && payload.logical !== null && isFiniteNumber(payload.offset)) {
    rows.push({ field: 'offset', label: 'offset', value: formatOffset(payload.offset, locale) });
  }
  return rows;
}

/**
 * Crosshair controller: keeps the last pointer position (so `update` under a
 * stationary pointer refreshes the readout) and an explicit `barId` selection
 * that survives `prepend` because it is never stored as an index.
 */
export function createCrosshairController({ adapter, getLayout, hitPane, options = {} }) {
  const emitter = createEmitter();
  let mode = 'none';
  let point = null;
  let paneId = null;
  let selectedBarId = null;
  let payload = emptyPayload();

  function currentPane(layout) {
    if (paneId !== null) {
      const found = layout.panes.find((pane) => pane.id === paneId && pane.visible);
      if (found) return found;
    }
    return layout.panes.find((pane) => pane.visible) || layout.panes[0];
  }

  function primaryScale(pane) {
    if (!pane || pane.priceScales.length === 0) return { scale: null, id: null };
    const scale = pane.priceScales[0];
    return { scale: adapter.priceScale(pane.id, scale.id), id: scale.id };
  }

  function recompute() {
    const layout = getLayout();
    const pane = currentPane(layout);
    if (!pane) {
      payload = emptyPayload();
      return payload;
    }
    const scale = primaryScale(pane);
    const slotAccessor = adapter.slotAccessorFor?.(pane.id) ?? null;
    // Every pane has its own x context: scale, slots and values come from it.
    const context = {
      indexScale: adapter.indexScaleFor(pane.id),
      // A live slot accessor avoids copying the whole timeline on every event;
      // custom adapters without it keep the array contract.
      ...(slotAccessor ? { slotAccessor } : { slots: adapter.slotsFor(pane.id) }),
      seriesValues: (id) => adapter.getSeriesValues(pane.id, id),
      derived: adapter.paneKind(pane.id) === 'derived',
      sourceBarId: (id) => adapter.sourceBarId(pane.id, id),
    };
    if (mode === 'bar' && selectedBarId !== null) {
      const index = context.indexScale.barIdToIndex(selectedBarId);
      if (index === null) {
        payload = emptyPayload();
        return payload;
      }
      const x = pane.plot.x + context.indexScale.indexToCoordinate(index);
      const y = point ? point.y : pane.plot.y + pane.plot.height / 2;
      payload = computeCrosshair({
        point: { x, y },
        pane,
        ...context,
        priceScale: scale.scale,
        priceAxisId: scale.id,
      });
      payload.selectedBarId = selectedBarId;
      return payload;
    }
    if (mode === 'pointer' && point) {
      payload = computeCrosshair({
        point,
        pane,
        ...context,
        priceScale: scale.scale,
        priceAxisId: scale.id,
      });
      return payload;
    }
    payload = emptyPayload();
    return payload;
  }

  function publish(reason) {
    const next = recompute();
    emitter.emit('move', { ...next, reason });
    return next;
  }

  return {
    get mode() {
      return mode;
    },
    get selection() {
      return selectedBarId;
    },
    get payload() {
      return payload;
    },
    pointerMove(nextPoint, pane = null) {
      mode = 'pointer';
      selectedBarId = null;
      point = { x: nextPoint.x, y: nextPoint.y };
      paneId = pane ? pane.id : hitPane ? hitPane(nextPoint) : paneId;
      return publish('pointer');
    },
    pointerLeave() {
      mode = 'none';
      point = null;
      return publish('leave');
    },
    /** `id` is a slot id of the pane's x context: a barId or a derived element id. */
    selectBar(barId, targetPaneId = null) {
      if (typeof barId !== 'string') return { ok: false, code: 'INVALID_BAR_ID' };
      const target = targetPaneId === null ? currentPane(getLayout()) : getLayout().panes.find((pane) => pane.id === targetPaneId && pane.visible);
      if (!target) return { ok: false, code: 'UNKNOWN_PANE', paneId: targetPaneId };
      const index = adapter.indexScaleFor(target.id).barIdToIndex(barId);
      if (index === null) return { ok: false, code: 'UNKNOWN_BAR_ID', barId };
      paneId = target.id;
      mode = 'bar';
      selectedBarId = barId;
      return { ok: true, payload: publish('select') };
    },
    clearSelection() {
      mode = 'none';
      selectedBarId = null;
      return publish('clear');
    },
    refresh(reason = 'data') {
      if (mode === 'none') return payload;
      return publish(reason);
    },
    subscribe(handler) {
      return emitter.on('move', handler);
    },
    readout(readoutOptions) {
      return buildReadout(payload, { ...options.readout, ...readoutOptions });
    },
  };
}
