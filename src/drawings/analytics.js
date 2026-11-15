import { isNumber } from './values.js';

export function measureAnchors(anchors, adapter, binding) {
  const [a, b] = anchors;
  const priceDelta = b.price - a.price;
  const relativeChange = a.price === 0 ? null : (b.price - a.price) / a.price;
  const indexDelta = a.logical === null || b.logical === null ? null : b.logical - a.logical;

  let duration = null;
  let durationReason = null;
  if (indexDelta === null) {
    durationReason = 'unresolved-anchor';
  } else {
    const first = anchorTime(a, adapter, binding);
    const second = anchorTime(b, adapter, binding);
    if (first === null || second === null) {
      durationReason = 'missing-time';
    } else {
      duration = second - first;
    }
  }

  return {
    priceDelta,
    relativeChange,
    relativeChangeReason: relativeChange === null ? 'zero-base' : null,
    indexDelta,
    indexDeltaReason: indexDelta === null ? 'unresolved-anchor' : null,
    duration,
    durationReason,
  };
}

// The time of the bar an anchor sits on, or null: the anchor must rest exactly on a slot (offset zero,
// integer logical that still maps to the anchor's own bar) whose slot carries a time. The measure duration
// and the axis time plates share the rule.
export function anchorTime(anchor, adapter, binding) {
  if (anchor.logical === null || anchor.offset !== 0 || !Number.isInteger(anchor.logical)) return null;
  if (adapter.indexOf(anchor.anchorBarId, binding) !== anchor.logical) return null;
  const slot = adapter.getSlot(anchor.logical, binding);
  if (!slot || !isNumber(slot.time)) return null;
  return slot.time;
}

export function computeRegression({ x1, x2, series }) {
  if (!Array.isArray(series)) return { available: false, reason: 'missing-series' };
  const from = Math.min(x1, x2);
  const to = Math.max(x1, x2);
  const byIndex = new Map();
  for (const item of series) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.index) || !isNumber(item.value)) {
      return { available: false, reason: 'invalid-series' };
    }
    if (item.index < from || item.index > to) continue;
    const existing = byIndex.get(item.index);
    if (existing !== undefined && existing !== item.value) return { available: false, reason: 'invalid-series' };
    byIndex.set(item.index, item.value);
  }
  const points = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([x, y]) => ({ x, y }));
  if (points.length < 2) return { available: false, reason: 'insufficient-points', range: { from, to } };

  const n = points.length;
  const xbar = points.reduce((sum, p) => sum + p.x, 0) / n;
  const ybar = points.reduce((sum, p) => sum + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - xbar) ** 2;
    sxy += (p.x - xbar) * (p.y - ybar);
    syy += (p.y - ybar) ** 2;
  }
  if (!(sxx > 0)) return { available: false, reason: 'insufficient-points', range: { from, to } };
  const b = sxy / sxx;
  const a = ybar - b * xbar;
  let residuals = 0;
  for (const p of points) residuals += (p.y - (a + b * p.x)) ** 2;
  const sigma = Math.sqrt(residuals / n);
  const correlation = n < 3 ? { available: false, reason: 'insufficient-points' }
    : syy === 0 ? { available: false, reason: 'zero-variance' }
      : { available: true, value: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) };
  return { available: true, a, b, sigma, n, points, range: { from, to }, correlation };
}

export function computeVwap({ anchorX, priceSeries, volumeSeries, count }) {
  if (!Array.isArray(priceSeries) || !Array.isArray(volumeSeries)) {
    return { available: false, waiting: true, reason: 'missing-series' };
  }
  const prices = new Map();
  const volumes = new Map();
  for (const item of priceSeries) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.index)) return { available: false, error: { code: 'invalid-vwap-data', field: 'price', index: item?.index } };
    if (!isNumber(item.value)) return { available: false, error: { code: 'invalid-vwap-data', field: 'price', index: item.index } };
    prices.set(item.index, item.value);
  }
  for (const item of volumeSeries) {
    if (!item || typeof item !== 'object' || !Number.isInteger(item.index)) return { available: false, error: { code: 'invalid-vwap-data', field: 'volume', index: item?.index } };
    if (!isNumber(item.value) || item.value < 0) return { available: false, error: { code: 'invalid-vwap-data', field: 'volume', index: item.index } };
    volumes.set(item.index, item.value);
  }

  const start = Math.max(0, Math.ceil(anchorX));
  if (!(start < count)) return { available: false, waiting: true, reason: 'awaiting-data', startIndex: start };

  const points = [];
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  for (let index = start; index < count; index += 1) {
    const price = prices.get(index);
    const volume = volumes.get(index);
    if (price === undefined || volume === undefined) {
      points.push({ index, unavailableReason: price === undefined ? 'missing-price' : 'missing-volume' });
      break;
    }
    cumulativePriceVolume += price * volume;
    cumulativeVolume += volume;
    if (cumulativeVolume === 0) {
      points.push({ index, unavailableReason: 'zero-volume' });
      continue;
    }
    points.push({ index, value: cumulativePriceVolume / cumulativeVolume });
  }
  return { available: true, startIndex: start, points };
}
