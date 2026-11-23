/**
 * Calendar-aligned tick selection for the horizontal axis (timeScale.tickMode
 * "time"). Pure functions: no DOM, no chart mutation. Time is only used to pick
 * existing slots; a boundary without a slot never produces a tick or a time.
 */

const LEVEL_RANK = Object.freeze({ time: 0, day: 1, month: 2, year: 3 });
const MINUTE = 60_000;
const DAY = 86_400_000;
const AVERAGE_MONTH = 30.4375 * DAY;
const AVERAGE_YEAR = 365.25 * DAY;

/** Candidate steps, finest first. `unit` says which calendar field the bucket aligns to. */
const STEPS = Object.freeze([
  ...[1, 5, 15, 30, 60, 120, 180, 240, 360, 720].map((minutes) => ({ unit: 'minute', size: minutes, duration: minutes * MINUTE, level: 'time' })),
  { unit: 'day', size: 1, duration: DAY, level: 'day' },
  ...[2, 5, 10, 15].map((days) => ({ unit: 'dom', size: days, duration: days * DAY, level: 'day' })),
  ...[1, 3, 6].map((months) => ({ unit: 'month', size: months, duration: months * AVERAGE_MONTH, level: 'month' })),
  ...[1, 2, 5, 10, 25, 50, 100].map((years) => ({ unit: 'year', size: years, duration: years * AVERAGE_YEAR, level: 'year' }))
]);

const formatters = new Map();
const partsCache = new Map();
const CACHE_LIMIT = 400_000;

function zoneFormatter(timeZone) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric'
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of a UTC instant in an IANA zone; results are memoized per zone. */
export function wallClock(time, timeZone) {
  if (timeZone === 'UTC') {
    const date = new Date(time);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: date.getUTCHours(), minute: date.getUTCMinutes() };
  }
  let zone = partsCache.get(timeZone);
  if (!zone) {
    zone = new Map();
    partsCache.set(timeZone, zone);
  }
  let parts = zone.get(time);
  if (!parts) {
    const values = {};
    for (const part of zoneFormatter(timeZone).formatToParts(time)) values[part.type] = part.value;
    parts = { year: Number(values.year), month: Number(values.month), day: Number(values.day), hour: Number(values.hour), minute: Number(values.minute) };
    if (zone.size >= CACHE_LIMIT) zone.clear();
    zone.set(time, parts);
  }
  return parts;
}

function bucketOf(step, parts) {
  switch (step.unit) {
    case 'minute':
      // Local wall time treated as UTC: days are multiples of every minute step.
      return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / MINUTE / step.size);
    case 'day':
      return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / DAY);
    case 'dom':
      // Day-of-month blocks restart every month, so day 1 always starts a bucket.
      return (parts.year * 12 + parts.month - 1) * 32 + Math.floor((parts.day - 1) / step.size);
    case 'month':
      return Math.floor((parts.year * 12 + parts.month - 1) / step.size);
    default:
      return Math.floor(parts.year / step.size);
  }
}

function levelBetween(previous, current) {
  if (!previous) return 'year';
  if (previous.year !== current.year) return 'year';
  if (previous.month !== current.month) return 'month';
  if (previous.day !== current.day) return 'day';
  return 'time';
}

/** Typical distance between neighbouring slots: the median ignores overnight and weekend gaps. */
function typicalSlotDuration(times) {
  const differences = [];
  const stride = Math.max(1, Math.floor(times.length / 400));
  for (let i = stride; i < times.length; i += stride) {
    const difference = Math.abs(times[i] - times[i - stride]) / stride;
    if (difference > 0) differences.push(difference);
  }
  if (differences.length === 0) return MINUTE;
  differences.sort((a, b) => a - b);
  return differences[Math.floor(differences.length / 2)];
}

/** Smallest step whose duration is at least the time covered by `minPixels`. */
function chooseStep(slotDuration, barSpacing, minPixels) {
  const wanted = (minPixels / Math.max(barSpacing, 1e-9)) * slotDuration;
  return STEPS.find((step) => step.duration >= wanted) ?? STEPS[STEPS.length - 1];
}

/**
 * Returns null when the time mode cannot be used (some visible slot has no
 * time); otherwise `{ step, ticks: [{ index, level, parts, time }] }`.
 */
export function computeTimeTicks({ timeline, from, to, barSpacing, minPixels = 84, timeZone }) {
  const length = timeline.length;
  if (length === 0 || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const first = Math.max(0, Math.ceil(from));
  const last = Math.min(length - 1, Math.floor(to));
  if (first > last) return { step: null, ticks: [] };
  // The predecessor of the first visible slot gives it a comparison; without a time it is simply ignored.
  let start = Math.max(0, first - 1);
  if (start < first && !Number.isFinite(timeline.slotAt(start)?.time)) start = first;
  const cached = typeof timeline._timesBetween === 'function' ? timeline._timesBetween(start, last) : null;
  const times = cached ?? new Array(last - start + 1);
  let ascending = true;
  for (let index = start; index <= last; index += 1) {
    const time = cached ? times[index - start] : timeline.slotAt(index)?.time;
    if (!Number.isFinite(time)) return null;
    if (!cached) times[index - start] = time;
    if (index > start && time < times[index - start - 1]) ascending = false;
  }
  const step = chooseStep(typicalSlotDuration(times), barSpacing, minPixels);

  const candidates = [];
  let previousParts = null;
  let maxBucket = -Infinity;
  // Bucket starts are found by jumping to the next wall-clock boundary instead of
  // inspecting every visible slot: with minute histories one zoom frame otherwise
  // ran `wallClock` ten thousand times. Calendar steps stay on the exact scan.
  const jumpable = ascending && (step.unit === 'minute' || step.unit === 'day' || step.unit === 'dom');
  const stepMs = step.duration;
  for (let index = start; index <= last;) {
    const time = times[index - start];
    const parts = wallClock(time, timeZone);
    const bucket = bucketOf(step, parts);
    // Only a larger bucket starts a tick: repeated wall-clock hours at a DST shift cannot duplicate one.
    if (previousParts !== null && bucket > maxBucket && index >= first) {
      candidates.push({ index, level: levelBetween(previousParts, parts), parts, time });
    }
    if (bucket > maxBucket) maxBucket = bucket;
    previousParts = parts;
    if (!jumpable) {
      index += 1;
      continue;
    }
    const localMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const target = (Math.floor(localMs / stepMs) + 1) * stepMs - (localMs - time);
    let next = index + 1;
    while (next <= last && times[next - start] < target) next += 1;
    index = next;
  }

  const kept = [];
  const apart = (a, b) => (b.index - a.index) * barSpacing >= minPixels;
  for (const candidate of candidates) {
    while (kept.length > 0 && !apart(kept[kept.length - 1], candidate) && LEVEL_RANK[candidate.level] > LEVEL_RANK[kept[kept.length - 1].level]) kept.pop();
    if (kept.length === 0 || apart(kept[kept.length - 1], candidate)) kept.push(candidate);
  }
  return { step, ticks: kept };
}

export function isEmphasized(tick, step) {
  return LEVEL_RANK[tick.level] > LEVEL_RANK[step.level];
}

const monthFormatters = new Map();
export function formatTickLabel(tick, { locale, timeZone }) {
  if (tick.level === 'year') return String(tick.parts.year);
  if (tick.level === 'day') return String(tick.parts.day);
  if (tick.level === 'time') return `${String(tick.parts.hour).padStart(2, '0')}:${String(tick.parts.minute).padStart(2, '0')}`;
  const key = `${locale}|${timeZone}`;
  let formatter = monthFormatters.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, { timeZone, month: 'short' });
    } catch {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' });
    }
    monthFormatters.set(key, formatter);
  }
  return formatter.format(tick.time);
}
