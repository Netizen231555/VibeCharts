/**
 * Accessible alternatives, status model and polite announcements.
 *
 * The accessible table is built from the same slots and series values as the
 * chart. Missing time, session date, volume or a whole series point is rendered
 * as explicit absence; nothing is substituted with zero or a synthesized date.
 * Status changes use `role=status`; errors use `role=alert`. Crosshair
 * announcements are limited to `barId` changes and a minimum interval so a
 * moving pointer cannot flood a live region.
 */
import { isFiniteNumber } from './geometry.js';

export const ABSENT = 'нет данных';

const DEFAULT_LOCALE = 'ru-RU';
const UTC_LABEL = 'UTC';

export function formatTimestamp(time, { locale = DEFAULT_LOCALE, timeZone = null } = {}) {
  if (!isFiniteNumber(time)) return ABSENT;
  const zone = timeZone || 'UTC';
  try {
    const formatter = new Intl.DateTimeFormat(locale, {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const text = formatter.format(new Date(time));
    return !timeZone || timeZone === 'UTC' ? `${text} ${UTC_LABEL}` : text;
  } catch {
    return `${new Date(time).toISOString()} (${UTC_LABEL})`;
  }
}

export function formatSessionDate(sessionDate, { absent = ABSENT } = {}) {
  if (!sessionDate) return absent;
  const { year, month, day } = sessionDate;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return absent;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function valueText(value, unit, absent) {
  if (!isFiniteNumber(value)) return { text: absent, absent: true };
  return { text: unit ? `${value} ${unit}` : String(value), absent: false };
}

/**
 * Rows for the semantic data table. One row per slot in host order; a series
 * without a point in a slot reports absence for that series' fields.
 */
export function buildAccessibleRows({ slots = [], series = [], getValues = () => [], metadata = {}, absent = ABSENT, locale = DEFAULT_LOCALE, timeZone = null } = {}) {
  const rows = [];
  for (const slot of slots) {
    const values = getValues(slot.barId) || [];
    const row = {
      barId: slot.barId,
      time: isFiniteNumber(slot.time) ? formatTimestamp(slot.time, { locale, timeZone }) : absent,
      timeAbsent: !isFiniteNumber(slot.time),
      sessionDate: formatSessionDate(slot.sessionDate, { absent }),
      sessionDateAbsent: !slot.sessionDate,
      series: {},
    };
    for (const entry of series) {
      const match = values.find((item) => item.seriesId === entry.id || item.seriesId === entry.seriesId);
      if (!match || !match.values) {
        row.series[entry.id] = { present: false, fields: {}, text: absent };
        continue;
      }
      const fields = {};
      if (Object.prototype.hasOwnProperty.call(match.values, 'close')) {
        for (const field of ['open', 'high', 'low', 'close']) {
          fields[field] = valueText(match.values[field], entry.metadata?.priceUnit ?? metadata.priceUnit, absent);
        }
        fields.volume = valueText(match.values.volume, entry.metadata?.volumeUnit ?? metadata.volumeUnit, absent);
      } else {
        fields.value = valueText(match.values.value, entry.metadata?.priceUnit ?? metadata.priceUnit, absent);
      }
      row.series[entry.id] = { present: true, fields };
    }
    rows.push(row);
  }
  return rows;
}

export function buildTableModel(rows, { caption, series = [], seriesLabels = {} } = {}) {
  const columns = [{ key: 'barId', label: 'Идентификатор слота' }, { key: 'time', label: 'Время' }, { key: 'sessionDate', label: 'Торговая дата' }];
  const fieldsBySeries = new Map(series.map((entry) => {
    const numeric = ['line', 'histogram', 'area', 'baseline'].includes(entry.type) ||
      rows.some((row) => Object.hasOwn(row.series[entry.id]?.fields ?? {}, 'value'));
    return [entry.id, numeric ? ['value'] : ['open', 'high', 'low', 'close', 'volume']];
  }));
  for (const entry of series) {
    const label = seriesLabels[entry.id] || entry.label || entry.id;
    for (const field of fieldsBySeries.get(entry.id)) {
      columns.push({ key: `${entry.id}:${field}`, label: `${label} ${field}` });
    }
  }
  const body = rows.map((row) => {
    const cells = [row.barId, row.time, row.sessionDate];
    for (const entry of series) {
      const data = row.series[entry.id];
      for (const field of fieldsBySeries.get(entry.id)) {
        if (!data || !data.present) cells.push(ABSENT);
        else if (data.fields[field]) cells.push(data.fields[field].text);
        else cells.push(ABSENT);
      }
    }
    return cells;
  });
  return { caption: caption || 'Данные графика', columns, rows: body };
}

const STATUS_TEXT = Object.freeze({
  unknown: 'Состояние данных не сообщено',
  initialLoading: 'Загрузка данных',
  loading: 'Обновление данных',
  empty: 'Успешная загрузка не вернула данных',
  available: 'Данные доступны',
  error: 'Ошибка загрузки данных',
  unavailable: 'Значение недоступно',
});

/**
 * Distinct loading / empty / available / unavailable / error states.
 * A failed refresh keeps the previous rows but marks them stale, so they are
 * never presented as freshly updated.
 */
export function createStatusModel() {
  let state = {
    phase: 'unknown',
    operation: null,
    message: null,
    rows: [],
    stale: false,
    unavailableFields: [],
    meta: {},
  };

  function snapshot() {
    return { ...state, rows: state.rows.slice(), unavailableFields: state.unavailableFields.slice(), meta: { ...state.meta } };
  }

  return {
    get state() {
      return snapshot();
    },
    startLoading({ operation = 'загрузка данных' } = {}) {
      const hasRows = state.rows.length > 0;
      state = {
        ...state,
        phase: hasRows ? 'loading' : 'initial-loading',
        operation,
        stale: hasRows,
        message: null,
      };
      return snapshot();
    },
    resolveEmpty({ operation = 'загрузка данных', meta = {} } = {}) {
      state = { phase: 'empty', operation, message: null, rows: [], stale: false, unavailableFields: [], meta };
      return snapshot();
    },
    resolveAvailable({ rows = [], operation = 'загрузка данных', meta = {} } = {}) {
      state = { phase: 'available', operation, message: null, rows: rows.slice(), stale: false, unavailableFields: [], meta };
      return snapshot();
    },
    setValueUnavailable(field, reason) {
      if (typeof field !== 'string' || field.length === 0) return snapshot();
      state = { ...state, unavailableFields: [...state.unavailableFields.filter((entry) => entry.field !== field), { field, reason: reason || null }] };
      return snapshot();
    },
    fail({ operation = 'загрузка данных', message = 'Операция завершилась ошибкой' } = {}) {
      state = {
        ...state,
        phase: 'error',
        operation,
        message,
        stale: state.rows.length > 0,
      };
      return snapshot();
    },
    describe() {
      const staleSuffix = state.stale && state.phase !== 'initial-loading' ? '; показаны прежние данные, они не считаются свежими' : '';
      if (state.phase === 'unknown') return { role: 'status', phase: state.phase, text: STATUS_TEXT.unknown, stale: false };
      if (state.phase === 'error') {
        return { role: 'alert', phase: state.phase, text: `${STATUS_TEXT.error}: ${state.operation}. ${state.message}${staleSuffix}`, stale: state.stale };
      }
      if (state.phase === 'empty') {
        return { role: 'status', phase: state.phase, text: `${STATUS_TEXT.empty}: ${state.operation}`, stale: false };
      }
      if (state.phase === 'available') {
        const unavailable = state.unavailableFields.length > 0 ? `; недоступно: ${state.unavailableFields.map((entry) => entry.field).join(', ')}` : '';
        return { role: 'status', phase: state.phase, text: `${STATUS_TEXT.available}${unavailable}${staleSuffix}`, stale: state.stale };
      }
      return { role: 'status', phase: state.phase, text: `${STATUS_TEXT[state.phase === 'initial-loading' ? 'initialLoading' : 'loading']}: ${state.operation}${staleSuffix}`, stale: state.stale };
    },
    sourceInfo() {
      const { source, observedAt, delay, delayText } = state.meta;
      const info = {};
      if (source !== undefined && source !== null) info.source = source;
      if (isFiniteNumber(observedAt)) info.observedAt = observedAt;
      if (delay !== undefined && delay !== null) info.delay = delay;
      if (delayText) info.delayText = delayText;
      return info;
    },
  };
}

/**
 * Live-region bookkeeping. Announcements happen only when the selected barId
 * changes, at most once per `minIntervalMs`; the latest pending text is what a
 * later flush publishes. Errors bypass the throttle but remain deduplicated.
 */
export function createAnnouncer({ now = () => Date.now(), minIntervalMs = 750 } = {}) {
  let lastBarId = null;
  let lastAt = -Infinity;
  let pending = null;
  let lastStatus = null;
  let lastError = null;

  return {
    get pending() {
      return pending;
    },
    announceBar(barId, text) {
      if (barId === null || barId === undefined) return { announced: false, reason: 'no-bar' };
      if (barId === lastBarId) return { announced: false, reason: 'same-bar' };
      const at = now();
      if (at - lastAt < minIntervalMs) {
        pending = { barId, text, at };
        return { announced: false, reason: 'throttled' };
      }
      lastBarId = barId;
      lastAt = at;
      pending = null;
      return { announced: true, barId, text };
    },
    flush() {
      if (!pending) return { announced: false };
      if (now() - lastAt < minIntervalMs) return { announced: false, reason: 'throttled' };
      const entry = pending;
      pending = null;
      lastBarId = entry.barId;
      lastAt = now();
      return { announced: true, barId: entry.barId, text: entry.text };
    },
    announceStatus(text) {
      if (text === lastStatus) return { announced: false, role: 'status' };
      lastStatus = text;
      return { announced: true, role: 'status', text };
    },
    announceError(text) {
      if (text === lastError) return { announced: false, role: 'alert' };
      lastError = text;
      return { announced: true, role: 'alert', text };
    },
    reset() {
      lastBarId = null;
      pending = null;
      lastStatus = null;
      lastError = null;
    },
  };
}
