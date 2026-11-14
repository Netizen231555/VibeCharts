import { fail } from './errors.js';
import { isPlainObject, requireArray, requireFinite, requireString, toJsonClone } from './util.js';
import { indexOfBar, readScale } from './anchors.js';

/** Base value snapshot: the series' finite non-zero value in the base slot. */
function baseSnapshot(points, mapping, baseSlot) {
  if (!baseSlot) return { slot: null, unavailable: true, reason: 'missing-base-slot' };
  const matches = points.filter((point) => mapping[point.sourceBarId] === baseSlot);
  if (matches.length === 0) return { slot: baseSlot, unavailable: true, reason: 'missing-base' };
  if (matches.length > 1) return { slot: baseSlot, unavailable: true, reason: 'ambiguous-base' };
  const value = matches[0].value;
  if (!Number.isFinite(value)) return { slot: baseSlot, unavailable: true, reason: 'non-finite-base' };
  if (value === 0) return { slot: baseSlot, unavailable: true, reason: 'zero-base' };
  return { slot: baseSlot, value, unavailable: false };
}

export function readPrimaryComparison(chart, primary) {
  if (!isPlainObject(primary)) fail('invalid-comparison', 'primary must identify a series and field', { field: 'primary' });
  const seriesId = requireString(primary.seriesId, 'primary.seriesId', 'invalid-comparison');
  const field = requireString(primary.field, 'primary.field', 'invalid-comparison');
  const series = typeof chart.series === 'function' ? chart.series(seriesId) : chart.series?.get?.(seriesId);
  if (!series || typeof series.data !== 'function') fail('invalid-comparison', 'primary series is unavailable', { field: 'primary.seriesId' });
  const allowed = ['candlestick', 'bar'].includes(series.type) ? ['open', 'high', 'low', 'close', 'volume'] : ['value'];
  if (!allowed.includes(field)) fail('invalid-comparison', 'primary field is incompatible with the series', { field: 'primary.field' });
  return series.data().map(point => ({ barId: point.barId, value: point[field] ?? null }));
}
export function computePrimaryComparison(chart, primary, baseSlot) {
  requireString(baseSlot, 'baseSlot', 'invalid-comparison');
  const sourceExists = chart.series?.list?.().some(series => series.id === primary.seriesId) === true;
  const values = new Map((sourceExists ? readPrimaryComparison(chart, primary) : []).map(point => [point.barId, point.value]));
  const { slots } = readScale(chart.indexScale());
  const base = values.get(baseSlot);
  const present = indexOfBar(chart.indexScale(), baseSlot) !== null;
  const reason = !sourceExists ? 'missing-source' : !present || base == null ? 'missing-base' : base === 0 ? 'zero-base' : null;
  const points = slots.map(({ barId }) => {
    const value = values.get(barId);
    if (reason || value == null) return { barId, value: null };
    const result = 100 * ((value - base) / Math.abs(base));
    if (!Number.isFinite(result)) fail('invalid-comparison', 'primary percentage is not finite', { field: 'primary' });
    return { barId, value: result };
  });
  return { baseSlot, base: reason ? null : base, normalization: reason ? 'unavailable' : 'available', reason, points };
}


export function normalizeComparison(spec, { chart, field = 'comparison', code = 'invalid-comparison' } = {}) {
  if (!isPlainObject(spec)) fail(code, `${field} must be an object`, { field });
  const id = requireString(spec.id, `${field}.id`, code);
  const mode = spec.mode;
  if (mode !== 'percent' && mode !== 'absolute') {
    fail(code, `${field}.mode must be "percent" or "absolute"`, { field: `${field}.mode` });
  }
  if (spec.primary !== undefined && spec.primary !== null) {
    if (mode !== 'percent') fail(code, 'primary requires percent mode', { field: `${field}.primary` });
    readPrimaryComparison(chart, spec.primary);
  }
  requireArray(spec.points, `${field}.points`, code);
  const scale = chart.indexScale();
  readScale(scale);
  const sourceIds = new Set();
  const points = spec.points.map((point, index) => {
    const pointField = `${field}.points[${index}]`;
    if (!isPlainObject(point)) fail(code, `${pointField} must be an object`, { field: pointField });
    const sourceBarId = requireString(point.sourceBarId, `${pointField}.sourceBarId`, code);
    if (sourceIds.has(sourceBarId)) {
      fail(code, `${field}.points contains duplicate source bar "${sourceBarId}"`, { field: `${pointField}.sourceBarId` });
    }
    sourceIds.add(sourceBarId);
    return { sourceBarId, value: requireFinite(point.value, `${pointField}.value`, code) };
  });

  const rawMapping = spec.mapping === undefined ? {} : spec.mapping;
  if (!isPlainObject(rawMapping)) fail(code, `${field}.mapping must be an object`, { field: `${field}.mapping` });
  const mapping = {};
  for (const [sourceBarId, target] of Object.entries(rawMapping)) {
    requireString(sourceBarId, `${field}.mapping key`, code);
    requireString(target, `${field}.mapping.${sourceBarId}`, code);
    mapping[sourceBarId] = target;
  }

  const baseSlot = spec.baseSlot === undefined ? null : requireString(spec.baseSlot, `${field}.baseSlot`, code);
  if (mode === 'percent') {
    if (!baseSlot) fail(code, `${field}.baseSlot is required for percent comparison`, { field: `${field}.baseSlot` });
  }

  const units = spec.units == null ? null : requireString(spec.units, `${field}.units`, code);
  const currency = spec.currency == null ? null : requireString(spec.currency, `${field}.currency`, code);
  const result = {
    id,
    name: spec.name === undefined ? id : requireString(spec.name, `${field}.name`, code),
    mode,
    instrument: spec.instrument === undefined ? null : toJsonClone(spec.instrument, `${field}.instrument`, { code }),
    primary: spec.primary == null ? null : { seriesId: spec.primary.seriesId, field: spec.primary.field },
    points,
    mapping,
    baseSlot,
    units,
    currency,
  };
  result.base = mode === 'percent' ? baseSnapshot(points, mapping, baseSlot) : { slot: null, unavailable: true, reason: 'absolute-mode' };
  return result;
}

/**
 * Absolute mode uses a shared scale only when the host supplied explicit units and
 * currency; otherwise each series gets its own signed scale. No conversion is invented.
 */
export function comparisonScale(comparison) {
  if (comparison.mode === 'percent') {
    return { id: 'percent', shared: true, label: '%', units: 'percent' };
  }
  if (comparison.units && comparison.currency) {
    return {
      id: `absolute:${comparison.units}:${comparison.currency}`,
      shared: true,
      label: `${comparison.units} in ${comparison.currency}`,
      units: comparison.units,
      currency: comparison.currency,
    };
  }
  const labelParts = [];
  labelParts.push(comparison.units ?? 'unlabelled units');
  if (comparison.currency) labelParts.push(comparison.currency);
  return {
    id: `absolute:${comparison.id}`,
    shared: false,
    label: `${labelParts.join(', ')} (separate scale)`,
    units: comparison.units,
    currency: comparison.currency,
  };
}

/** Rebuilds a stored comparison from a validated snapshot without a live scale. */
export function comparisonFromState(raw) {
  const base =
    raw.mode === 'percent'
      ? baseSnapshot(raw.points, raw.mapping, raw.baseSlot)
      : { slot: null, unavailable: true, reason: 'absolute-mode' };
  return {
    id: raw.id,
    chartId: raw.chartId,
    name: raw.name ?? raw.id,
    mode: raw.mode,
    instrument: raw.instrument ?? null,
    primary: raw.primary == null ? null : { ...raw.primary },
    primaryOriginalVisible: raw.primaryOriginalVisible,
    points: raw.points.map((point) => ({ sourceBarId: point.sourceBarId, value: point.value })),
    mapping: { ...raw.mapping },
    baseSlot: raw.baseSlot ?? null,
    units: raw.units ?? null,
    currency: raw.currency ?? null,
    base,
  };
}

/**
 * Computes display points over the chart's current common timeline. Unmapped,
 * ambiguous and missing targets become gaps; values are never interpolated.
 */
export function computeComparison(comparison, chart) {
  const scale = chart.indexScale();
  const { slots } = readScale(scale);
  const targets = new Map();
  const ambiguous = new Set();
  for (const point of comparison.points) {
    const target = comparison.mapping[point.sourceBarId];
    if (!target) continue;
    if (indexOfBar(scale, target) === null) continue;
    if (targets.has(target)) {
      ambiguous.add(target);
      targets.delete(target);
      continue;
    }
    targets.set(target, point);
  }
  const points = slots.map((slot) => {
    if (ambiguous.has(slot.barId)) return { barId: slot.barId, value: null, gap: 'ambiguous' };
    const point = targets.get(slot.barId);
    if (!point) return { barId: slot.barId, value: null, gap: 'unmapped' };
    return { barId: slot.barId, value: point.value, gap: null };
  });

  let normalization = 'available';
  let reason = null;
  const missingBaseSlot = comparison.mode === 'percent' && indexOfBar(scale, comparison.base.slot) === null;
  if (comparison.mode === 'percent') {
    if (comparison.base.unavailable || missingBaseSlot) {
      normalization = 'unavailable';
      reason = missingBaseSlot ? 'missing-base-slot' : comparison.base.reason;
      for (const point of points) point.value = null;
    } else {
      const base = comparison.base.value;
      for (const point of points) {
        if (point.value === null) continue;
        point.value = (100 * (point.value - base)) / Math.abs(base);
      }
    }
  }
  return {
    id: comparison.id,
    chartId: comparison.chartId,
    name: comparison.name,
    mode: comparison.mode,
    instrument: comparison.instrument,
    scale: comparisonScale(comparison),
    base: missingBaseSlot ? { ...comparison.base, unavailable: true, reason: 'missing-base-slot' } : { ...comparison.base },
    normalization,
    reason,
    points,
    gaps: points.filter((point) => point.value === null).map((point) => point.barId),
  };
}
