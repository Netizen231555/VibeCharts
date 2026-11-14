/**
 * Pure geometry helpers shared by renderers and tests. All coordinates are
 * logical/index space; canvas projection happens in the renderer.
 */

/** Splits a value sequence wherever consecutive slots are not adjacent. */
export function splitByGaps(points) {
  const segments = [];
  let current = null;
  let previous = null;
  for (const point of points) {
    if (previous && point.index !== previous.index + 1) current = null;
    if (!current) {
      current = [point];
      segments.push(current);
    } else {
      current.push(point);
    }
    previous = point;
  }
  return segments;
}

/**
 * Splits a numeric series at its base line, inserting exact crossing points.
 * Segments above and below receive independent styling; a gap ends a segment.
 */
export function buildBaselineSegments(points, base) {
  if (!Number.isFinite(base)) throw new Error('base must be finite');
  const segments = [];
  let current = null;
  let previous = null;
  for (const point of points) {
    if (previous && point.index !== previous.index + 1) {
      current = null;
      previous = null;
    }
    const side = point.value >= base ? 'above' : 'below';
    if (!current) {
      current = { side, points: [point] };
      segments.push(current);
    } else {
      const previousSide = previous.value >= base ? 'above' : 'below';
      if (previousSide !== side) {
        const span = point.value - previous.value;
        const ratio = span === 0 ? 0 : (base - previous.value) / span;
        const crossing = {
          index: previous.index + ratio * (point.index - previous.index),
          value: base
        };
        current.points.push(crossing);
        current = { side, points: [crossing, point] };
        segments.push(current);
      } else {
        current.points.push(point);
      }
    }
    previous = point;
  }
  return segments;
}

/** Evenly spaced price ticks inside [min, max]. */
export function niceTicks(min, max, target = 5) {
  if (!(Number.isFinite(min) && Number.isFinite(max)) || !(min < max) || target < 1) return [];
  const span = max - min;
  const rough = span / target;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalized = rough / magnitude;
  let step;
  if (normalized <= 1) step = 1;
  else if (normalized <= 2) step = 2;
  else if (normalized <= 5) step = 5;
  else step = 10;
  step *= magnitude;
  const first = Math.ceil(min / step) * step;
  const ticks = [];
  for (let value = first; value <= max + step * 1e-9; value += step) {
    ticks.push(Number(value.toFixed(12)));
  }
  return ticks;
}

/** Index ticks at a readable spacing derived from bar spacing. */
export function indexTicks(from, to, barSpacing, minPixels = 72) {
  const step = Math.max(1, Math.ceil(minPixels / Math.max(1, barSpacing)));
  const first = Math.ceil(from);
  const ticks = [];
  for (let index = first; index <= to; index += 1) {
    if (index % step === 0 || index === first) ticks.push(index);
  }
  return ticks;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
