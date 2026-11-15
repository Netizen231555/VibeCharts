// The one time-plate text of the chart: the crosshair plate and the drawing axis plates read the same
// default formatter, and a host `crosshair.timeFormatter` replaces it with the same validation and failure
// surface for both callers.

const formatterCache = new Map();
const CACHE_LIMIT = 32;

function formatter(presentation) {
  const key = `${presentation.locale || ''}|${presentation.timeZone || 'UTC'}`;
  let format = formatterCache.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(presentation.locale, {
      timeZone: presentation.timeZone || 'UTC', year: '2-digit', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
    });
    if (formatterCache.size >= CACHE_LIMIT) formatterCache.delete(formatterCache.keys().next().value);
    formatterCache.set(key, format);
  }
  return format;
}

/** Default plate text of a timestamp in the chart's locale and time zone. */
export function formatAxisTime(time, presentation = {}) {
  return formatter(presentation).format(new Date(time));
}

/**
 * Plate text with the host formatter applied: `crosshair.timeFormatter(time, slot)` when the host set one,
 * otherwise the default. Throws on a host formatter that throws or returns a non-string; the caller reports
 * the failure and omits the plate, exactly as the crosshair does.
 */
export function axisTimeText(time, presentation, hostFormatter, slot = null) {
  if (typeof hostFormatter === 'function') {
    const text = hostFormatter(time, slot);
    if (typeof text !== 'string') throw new TypeError('crosshair.timeFormatter must return a string');
    return text;
  }
  return formatAxisTime(time, presentation);
}
