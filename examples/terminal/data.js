// Deterministic SYNTHETIC OHLCV generator for the terminal example.
// Every value is fictional: seeded random walk with volatility clustering,
// regime drift, session gaps and a U-shaped intraday volume profile. It is NOT
// market data and carries no relation to any real instrument.

export const INSTRUMENTS = Object.freeze([
  { id: 'DEMO01', name: 'Демо Нефтегаз', base: 182.4, vol: 0.016, volume: 4.2e6 },
  { id: 'DEMO02', name: 'Демо Банк', base: 312.8, vol: 0.014, volume: 6.8e6 },
  { id: 'DEMO03', name: 'Демо Металлы', base: 96.15, vol: 0.021, volume: 3.1e6 },
  { id: 'DEMO04', name: 'Демо Телеком', base: 41.76, vol: 0.012, volume: 9.4e6 },
  { id: 'DEMO05', name: 'Демо Ритейл', base: 2284.0, vol: 0.019, volume: 5.6e5 },
  { id: 'DEMO06', name: 'Демо Энергия', base: 5.382, vol: 0.026, volume: 2.2e7 },
  { id: 'DEMO07', name: 'Демо Химия', base: 6420.5, vol: 0.017, volume: 2.4e5 },
  { id: 'DEMO08', name: 'Демо Транспорт', base: 74.9, vol: 0.022, volume: 7.7e6 },
  { id: 'DEMO09', name: 'Демо Софт', base: 1105.2, vol: 0.028, volume: 8.1e5 },
  { id: 'DEMO10', name: 'Демо Агро', base: 3568.0, vol: 0.015, volume: 3.3e5 },
  { id: 'DEMO11', name: 'Демо Строй', base: 18.44, vol: 0.024, volume: 1.4e7 },
  { id: 'DEMO12', name: 'Демо Фарма', base: 842.3, vol: 0.018, volume: 1.2e6 },
]);

// minutes: bar length; sessionBars: trading minutes per day (10:00-18:50 MSK).
export const INTERVALS = Object.freeze([
  { id: '5', label: '5м', minutes: 5, count: 2600 },
  { id: '15', label: '15м', minutes: 15, count: 2400 },
  { id: '60', label: '1ч', minutes: 60, count: 2000 },
  { id: 'D', label: '1Д', minutes: 1440, count: 900 },
  { id: 'W', label: '1Н', minutes: 10080, count: 520 },
]);

const SESSION_OPEN_UTC_MIN = 7 * 60; // 10:00 MSK
const SESSION_MINUTES = 530; // 10:00-18:50 MSK
const MINUTE = 60_000;
const DAY = 86_400_000;
// Fixed anchor so the same instrument and interval always give the same series.
const ANCHOR_END_UTC = Date.UTC(2026, 10, 13, 15, 50);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function normal(random) {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const isWeekday = (utcMs) => {
  const day = new Date(utcMs).getUTCDay();
  return day !== 0 && day !== 6;
};

function startOfWeekUtc(utcMs) {
  const d = new Date(utcMs);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

// Slot times, oldest first, ending at the anchor.
function buildTimes(interval) {
  const times = [];
  if (interval.id === 'W') {
    let monday = startOfWeekUtc(ANCHOR_END_UTC);
    for (let i = 0; i < interval.count; i += 1) {
      times.push(monday + SESSION_OPEN_UTC_MIN * MINUTE);
      monday -= 7 * DAY;
    }
  } else if (interval.id === 'D') {
    let day = Date.UTC(2026, 10, 13);
    while (times.length < interval.count) {
      if (isWeekday(day)) times.push(day + SESSION_OPEN_UTC_MIN * MINUTE);
      day -= DAY;
    }
  } else {
    const perDay = Math.ceil(SESSION_MINUTES / interval.minutes);
    let day = Date.UTC(2026, 10, 13);
    while (times.length < interval.count) {
      if (isWeekday(day)) {
        for (let k = perDay - 1; k >= 0 && times.length < interval.count; k -= 1) {
          times.push(day + SESSION_OPEN_UTC_MIN * MINUTE + k * interval.minutes * MINUTE);
        }
      }
      day -= DAY;
    }
  }
  return times.reverse();
}

export function priceStep(price) {
  if (price >= 1000) return 0.5;
  if (price >= 100) return 0.05;
  if (price >= 10) return 0.01;
  return 0.001;
}

export function decimalsOf(step) {
  const text = String(step);
  return text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
}

export function generateSeries(instrument, interval) {
  const random = mulberry32(hash(`${instrument.id}|${interval.id}`));
  const times = buildTimes(interval);
  const step = priceStep(instrument.base);
  const round = (value) => Math.max(step, Math.round(value / step) * step);
  const dailyVol = instrument.vol;
  const barsPerDay = interval.minutes >= 1440 ? 1 : SESSION_MINUTES / interval.minutes;
  const sigma = interval.id === 'W' ? dailyVol * Math.sqrt(5) : interval.id === 'D' ? dailyVol : dailyVol / Math.sqrt(barsPerDay);
  const microSteps = 14;

  // The walk runs from the last bar to the first: an Ornstein-Uhlenbeck process
  // is time-reversible, so the series ends exactly at the reference level with
  // no rescaling artifact. Output is reversed back into chronological order.
  let price = instrument.base;
  let logVol = 0;
  let drift = 0;
  const raw = [];
  for (let i = times.length - 1; i >= 0; i -= 1) {
    const time = times[i];
    logVol = 0.96 * logVol + 0.22 * normal(random);
    drift = 0.985 * drift + 0.0006 * sigma * normal(random);
    // Pull toward the reference level so long histories stay in a plausible band.
    const revert = -0.012 * Math.min(5, Math.max(0.12, interval.minutes / 1440)) * Math.log(price / instrument.base);
    const barSigma = sigma * Math.exp(logVol * 0.75);
    const close = price;
    let current = close;
    let high = close;
    let low = close;
    for (let m = 0; m < microSteps; m += 1) {
      current *= Math.exp(drift * 2 + revert / microSteps + (barSigma / Math.sqrt(microSteps)) * normal(random));
      if (current > high) high = current;
      if (current < low) low = current;
    }
    const open = current;
    const dayKey = Math.floor(time / DAY);
    const previousDayKey = i > 0 ? Math.floor(times[i - 1] / DAY) : dayKey;
    // An overnight gap separates sessions on intraday charts.
    price = interval.minutes < 1440 && previousDayKey !== dayKey ? open * Math.exp(dailyVol * 0.35 * normal(random)) : open;
    const minuteOfSession = (((time - SESSION_OPEN_UTC_MIN * MINUTE) % DAY) + DAY) % DAY / MINUTE;
    const u = interval.minutes >= 1440 ? 1 : 1 + 1.6 * Math.exp(-minuteOfSession / 40) + 1.1 * Math.exp(-(SESSION_MINUTES - minuteOfSession) / 45);
    const move = Math.abs(Math.log(close / open)) / Math.max(barSigma, 1e-9);
    const volume = Math.round(
      instrument.volume * (interval.minutes >= 1440 ? interval.minutes / 1440 : interval.minutes / SESSION_MINUTES) *
        Math.exp(0.45 * normal(random)) * (1 + 0.9 * Math.min(move, 4)) * u * (0.8 + 0.4 * Math.exp(logVol)),
    );
    raw.push({ time, open, high, low, close, volume });
  }
  raw.reverse();

  const slots = [];
  const bars = [];
  for (const bar of raw) {
    const barId = new Date(bar.time).toISOString();
    const open = round(bar.open);
    const close = round(bar.close);
    const high = Math.max(round(bar.high), open, close);
    const low = Math.min(round(bar.low), open, close);
    slots.push({ barId, time: bar.time });
    bars.push({ barId, open: +open.toFixed(6), high: +high.toFixed(6), low: +low.toFixed(6), close: +close.toFixed(6), volume: bar.volume });
  }
  return { slots, bars, step };
}

// Seeded per-tick random walk for the optional demo stream (still synthetic).
export function createTicker(seed, instrument, step) {
  const random = mulberry32(hash(`${seed}|tick`));
  return (last) => {
    const move = (instrument.vol / Math.sqrt(SESSION_MINUTES * 60)) * 6 * normal(random);
    const close = Math.max(step, Math.round((last.close * Math.exp(move)) / step) * step);
    return {
      barId: last.barId,
      open: last.open,
      high: Math.max(last.high, close),
      low: Math.min(last.low, close),
      close,
      volume: last.volume + Math.round(instrument.volume / 40000 * (0.5 + random())),
    };
  };
}
