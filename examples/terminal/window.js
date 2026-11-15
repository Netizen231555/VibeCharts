// Remembering the visible time window across charts (shared by the examples, not part of the package).
// Bar indexes differ between instruments and intervals, so the window is kept as times.

/**
 * The visible window of `chart` as times. The paddings (fractions of a bar around the edge bars, or the space past
 * the last bar) only mean the same thing while the interval is the same, so they are applied just for that case.
 */
export function captureWindow(chart, intervalId) {
  const scale = chart.indexScale();
  const range = scale.getVisibleRange();
  const slots = scale.slots();
  if (!range || slots.length === 0) return null;
  const last = slots.length - 1;
  const left = Math.min(last, Math.max(0, Math.ceil(range.from)));
  const right = Math.min(last, Math.max(0, Math.floor(range.to)));
  return { intervalId, leftTime: slots[left].time, rightTime: slots[right].time, leftPad: range.from - left, rightPad: range.to - right };
}

/**
 * Logical range that shows `remembered` on `slots`: the first bar at or after its left edge to the last bar at or
 * before its right edge. `null` when the series has no bar inside the window.
 */
export function windowRange(slots, remembered, intervalId) {
  const left = slots.findIndex((slot) => slot.time >= remembered.leftTime);
  const right = slots.findLastIndex((slot) => slot.time <= remembered.rightTime);
  if (left < 0 || right < left) return null;
  const same = remembered.intervalId === intervalId;
  return { from: left + (same ? remembered.leftPad : -0.5), to: right + (same ? remembered.rightPad : 0.5) };
}
