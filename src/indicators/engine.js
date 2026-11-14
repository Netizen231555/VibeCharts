export const INDICATOR_SEMANTIC_VERSION = '1.0.0';

const period = (value) => ({ type: 'integer', default: value, min: 1 });
const sourceField = { type: 'field', values: ['open', 'high', 'low', 'close', 'volume', 'value'] };
const output = (units, scale = 'linear') => ({ units, scale });
const nonNegativeInputs = new Set(['volume', 'buyVolume', 'sellVolume']);
const define = (parameters, inputs, outputs, extra = {}) => ({ semanticVersion: INDICATOR_SEMANTIC_VERSION, parameters, inputs, outputs, ...extra });
export const BUILTIN_INDICATORS = Object.freeze({
  sma: define({ period: period(14), sourceField }, ['sourceField'], { value: output('source') }),
  ema: define({ period: period(14), sourceField }, ['sourceField'], { value: output('source') }),
  rsi: define({ period: period(14), sourceField }, ['sourceField'], { value: output('dimensionless', '0-100') }),
  macd: define({ fast: period(12), slow: period(26), signal: period(9), sourceField }, ['sourceField'], { macd: output('source'), signal: output('source'), histogram: output('source') }),
  bollinger: define({ period: period(20), k: { type: 'number', default: 2, min: 0 }, sourceField }, ['sourceField'], { middle: output('source'), upper: output('source'), lower: output('source') }),
  volume: define({}, ['volume'], { value: output('volume') }),
  delta: define({}, ['buyVolume', 'sellVolume'], { value: output('volume') }, { description: 'Per-bar buyVolume minus sellVolume.' }),
  vwap: define({}, ['high', 'low', 'close', 'volume', 'sessionDate'], { value: output('price') }, { description: 'Bar approximation of VWAP, not tick VWAP.' }),
  atr: define({ period: period(14) }, ['high', 'low', 'close'], { value: output('price') }),
  stochastic: define({ lookback: period(14), smoothK: period(3), smoothD: period(3) }, ['high', 'low', 'close'], { K: output('dimensionless', '0-100'), D: output('dimensionless', '0-100') }),
});
const custom = new Map();
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const idPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
function definition(type) {
  const def = own(BUILTIN_INDICATORS, type) ? BUILTIN_INDICATORS[type] : custom.get(type);
  if (!def) throw new Error(`Unknown indicator type: ${type}`);
  return def;
}
function checkParameter(name, value, spec) {
  if (spec.type === 'integer' && (!Number.isSafeInteger(value) || value < (spec.min ?? 1))) throw new RangeError(`${name} must be a positive safe integer`);
  if (spec.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (spec.min !== undefined && value < spec.min))) throw new RangeError(`${name} must be a finite number${spec.min !== undefined ? ` >= ${spec.min}` : ''}`);
  if (spec.type === 'field' && !spec.values.includes(value)) throw new RangeError(`${name} must be one of ${spec.values.join(', ')}`);
  if (spec.type === 'string' && typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  if (spec.type === 'boolean' && typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  if (spec.max !== undefined && value > spec.max) throw new RangeError(`${name} must be <= ${spec.max}`);
  if (spec.values && spec.type !== 'field' && !spec.values.includes(value)) throw new RangeError(`${name} is not an allowed value`);
}
export function validateIndicatorParameters(type, parameters = {}) {
  const def = definition(type);
  if (!object(parameters)) throw new TypeError('parameters must be an object');
  for (const key of Object.keys(parameters)) if (!own(def.parameters, key)) throw new Error(`Unknown parameter: ${key}`);
  const result = {};
  for (const [name, spec] of Object.entries(def.parameters)) {
    const value = own(parameters, name) ? parameters[name] : spec.default;
    if (value === undefined) throw new Error(`Missing parameter: ${name}`);
    checkParameter(name, value, spec);
    result[name] = value;
  }
  if (type === 'macd' && result.fast >= result.slow) throw new RangeError('fast must be less than slow');
  return result;
}
export function registerIndicatorType(spec) {
  if (!object(spec) || typeof spec.id !== 'string' || !idPattern.test(spec.id)) throw new TypeError('id must be a valid identifier');
  if (typeof spec.semanticVersion !== 'string' || !semver.test(spec.semanticVersion)) throw new TypeError('semanticVersion must be a semantic version');
  if (own(BUILTIN_INDICATORS, spec.id) || custom.has(spec.id)) throw new Error(`Indicator type conflict: ${spec.id}`);
  if (!object(spec.parameters)) throw new TypeError('parameters must be an object');
  const parameters = {};
  for (const [name, descriptor] of Object.entries(spec.parameters)) {
    if (!idPattern.test(name) || !object(descriptor) || !['integer', 'number', 'field', 'string', 'boolean'].includes(descriptor.type)) throw new TypeError(`Invalid parameter ${name}`);
    if (descriptor.min !== undefined && (typeof descriptor.min !== 'number' || !Number.isFinite(descriptor.min))) throw new TypeError(`Invalid ${name} min`);
    if (descriptor.max !== undefined && (typeof descriptor.max !== 'number' || !Number.isFinite(descriptor.max) || (descriptor.min !== undefined && descriptor.max < descriptor.min))) throw new TypeError(`Invalid ${name} max`);
    if (descriptor.values !== undefined && (!Array.isArray(descriptor.values) || !descriptor.values.length)) throw new TypeError(`Invalid ${name} values`);
    if (descriptor.type === 'field' && !Array.isArray(descriptor.values)) throw new TypeError(`Invalid ${name} values`);
    if (own(descriptor, 'default')) checkParameter(name, descriptor.default, descriptor);
    parameters[name] = { ...descriptor, ...(descriptor.values ? { values: [...descriptor.values] } : {}) };
  }
  if (!Array.isArray(spec.inputs) || !spec.inputs.length || spec.inputs.some(x => typeof x !== 'string' || !idPattern.test(x)) || new Set(spec.inputs).size !== spec.inputs.length) throw new TypeError('inputs must be unique field names');
  if (!object(spec.outputs) || !Object.keys(spec.outputs).length || Object.entries(spec.outputs).some(([key, value]) => !idPattern.test(key) || !object(value) || typeof value.units !== 'string' || !value.units || typeof value.scale !== 'string' || !value.scale)) throw new TypeError('outputs must declare named units and scale');
  if (typeof spec.compute !== 'function') throw new TypeError('compute must be a function');
  const entry = { ...spec, parameters, inputs: [...spec.inputs], outputs: Object.fromEntries(Object.entries(spec.outputs).map(([k, v]) => [k, { ...v }])) };
  custom.set(spec.id, entry);
  return () => { if (custom.get(spec.id) === entry) custom.delete(spec.id); };
}
export function listIndicatorTypes() {
  return [...Object.entries(BUILTIN_INDICATORS).map(([id, metadata]) => ({ id, ...metadata })), ...[...custom.values()].map(({ compute, ...metadata }) => ({ ...metadata }))];
}
function rolling(n) {
  let values = [], sum = 0, correction = 0, index = 0;
  function accumulate(value) {
    const next = sum + value;
    correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
    sum = next;
  }
  return {
    push(x) {
      if (x === null) { values = []; sum = 0; correction = 0; index = 0; return null; }
      if (values.length < n) values.push(x);
      else { accumulate(-values[index]); values[index] = x; index = (index + 1) % n; }
      accumulate(x);
      return values.length === n ? (sum + correction) / n : null;
    },
    values: () => values,
  };
}
function ema(n) {
  const seed = rolling(n); let previous = null; const alpha = 2 / (n + 1);
  return x => { if (x === null) { seed.push(null); previous = null; return null; } if (previous === null) previous = seed.push(x); else previous = alpha * x + (1 - alpha) * previous; return previous; };
}
function extrema(n, better) {
  let entries = [], first = 0, index = 0;
  return {
    push(value) {
      while (entries.length > first && better(value, entries[entries.length - 1].value)) entries.pop();
      entries.push({ index, value });
      while (entries[first].index <= index - n) first++;
      index++;
      if (first > 1024 && first * 2 > entries.length) {
        entries = entries.slice(first);
        first = 0;
      }
      return index >= n ? entries[first].value : null;
    },
    reset() { entries = []; first = 0; index = 0; },
  };
}
function sessionKey(date) {
  if (!object(date) || !Number.isInteger(date.year) || date.year < 1 || date.year > 9999 || !Number.isInteger(date.month) || date.month < 1 || date.month > 12 || !Number.isInteger(date.day)) return null;
  const leap = date.year % 4 === 0 && (date.year % 100 !== 0 || date.year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return date.day >= 1 && date.day <= days[date.month - 1] ? `${date.year}-${date.month}-${date.day}` : null;
}
export function computeIndicator(type, parameters, rows) {
  const def = definition(type), params = validateIndicatorParameters(type, parameters);
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const errors = [], outputs = Object.fromEntries(Object.keys(def.outputs).map(name => [name, []]));
  const seen = new Set();
  const validRows = rows.map((row, index) => {
    if (!object(row) || typeof row.barId !== 'string' || !row.barId || seen.has(row.barId)) throw new TypeError(`rows[${index}].barId must be a unique nonempty string`);
    seen.add(row.barId);
    if (own(row, 'time') && (!Number.isSafeInteger(row.time) || Math.abs(row.time) > 8640000000000000)) throw new TypeError(`rows[${index}].time must be Unix milliseconds`);
    return { ...row };
  });
  const point = (row, value) => ({ barId: row.barId, ...(own(row, 'time') ? { time: row.time } : {}), value });
  const issue = (index, field, message) => errors.push({ index, barId: validRows[index].barId, field, message });
  if (custom.has(type)) {
    for (const name of Object.keys(outputs)) outputs[name] = validRows.map(row => point(row, null));
    const computeSegment = (start, end) => {
      if (start === end) return;
      const segment = validRows.slice(start, end);
      try {
        const result = def.compute(segment.map(row => ({ ...row })), { ...params });
        if (!object(result) || Object.keys(result).length !== Object.keys(outputs).length) throw new Error('compute must return declared named outputs');
        const validated = {};
        for (const name of Object.keys(outputs)) {
          const series = result[name];
          if (!Array.isArray(series) || series.length !== segment.length) throw new Error(`${name} must contain one point per row`);
          validated[name] = series.map((p, i) => {
            if (!object(p) || p.barId !== segment[i].barId || (p.value !== null && (typeof p.value !== 'number' || !Number.isFinite(p.value)))) throw new Error(`${name}[${i}] has invalid barId or value`);
            if (own(p, 'time') && (!own(segment[i], 'time') || p.time !== segment[i].time)) throw new Error(`${name}[${i}] has invalid time`);
            return point(segment[i], p.value);
          });
        }
        for (const name of Object.keys(outputs)) for (let i = 0; i < segment.length; i++) outputs[name][start + i] = validated[name][i];
      } catch (error) { errors.push({ field: 'compute', message: String(error?.message ?? error) }); }
    };
    let start = 0;
    validRows.forEach((row, index) => {
      let missing = false;
      for (const field of def.inputs) {
        const value = row[field];
        if (value === null || value === undefined) missing = true;
        else if (field === 'sessionDate' ? sessionKey(value) === null :
          typeof value !== 'number' || !Number.isFinite(value) || (nonNegativeInputs.has(field) && value < 0)) {
          issue(index, field, field === 'sessionDate' ? 'Invalid session date' : 'Expected a finite number' + (nonNegativeInputs.has(field) ? ' >= 0' : ''));
          missing = true;
        }
      }
      if (missing) { computeSegment(start, index); start = index + 1; }
    });
    computeSegment(start, validRows.length);
    return { type, parameters: params, outputs, errors };
  }
  const window = rolling(params.period || 1), fast = ema(params.fast || 1), slow = ema(params.slow || 1), signal = ema(params.signal || 1), average = ema(params.period || 1);
  const kWindow = rolling(params.smoothK || 1), dWindow = rolling(params.smoothD || 1);
  const highest = extrema(params.lookback || 1, (a, b) => a >= b);
  const lowest = extrema(params.lookback || 1, (a, b) => a <= b);
  let prev = null, gain = 0, loss = 0, count = 0, atr = null, session = null, pv = 0, volume = 0;
  const reset = () => { window.push(null); average(null); fast(null); slow(null); signal(null); kWindow.push(null); dWindow.push(null); highest.reset(); lowest.reset(); prev = null; gain = 0; loss = 0; count = 0; atr = null; session = null; pv = 0; volume = 0; };
  validRows.forEach((row, index) => {
    const result = Object.fromEntries(Object.keys(outputs).map(name => [name, null]));
    const fields = def.inputs.map(field => field === 'sourceField' ? params.sourceField : field);
    let missing = false;
    for (const field of fields) {
      const value = row[field];
      if (value === null || value === undefined) { missing = true; continue; }
      if (field === 'sessionDate') { if (sessionKey(value) === null) { issue(index, field, 'Invalid session date'); missing = true; } }
      else if (typeof value !== 'number' || !Number.isFinite(value) || (nonNegativeInputs.has(field) && value < 0)) { issue(index, field, 'Expected a finite number' + (nonNegativeInputs.has(field) ? ' >= 0' : '')); missing = true; }
    }
    if (!missing && ['vwap', 'atr', 'stochastic'].includes(type) && (row.low > row.high || row.close < row.low || row.close > row.high || (row.open != null && (typeof row.open !== 'number' || !Number.isFinite(row.open) || row.open < row.low || row.open > row.high)))) { issue(index, 'ohlc', 'Invalid OHLC range'); missing = true; }
    if (missing) reset();
    else {
      const x = row[params.sourceField];
      if (type === 'sma') result.value = window.push(x);
      if (type === 'ema') result.value = average(x);
      if (type === 'rsi') {
        if (prev !== null) { const change = x - prev, g = Math.max(change, 0), l = Math.max(-change, 0); count++; if (count <= params.period) { gain += g; loss += l; if (count === params.period) { gain /= params.period; loss /= params.period; } } else { gain = (gain * (params.period - 1) + g) / params.period; loss = (loss * (params.period - 1) + l) / params.period; } if (count >= params.period) result.value = loss === 0 ? (gain === 0 ? 50 : 100) : gain === 0 ? 0 : 100 - 100 / (1 + gain / loss); } prev = x;
      }
      if (type === 'macd') { const a = fast(x), b = slow(x); if (a !== null && b !== null) { result.macd = a - b; result.signal = signal(result.macd); if (result.signal !== null) result.histogram = result.macd - result.signal; } }
      if (type === 'bollinger') { const mid = window.push(x); if (mid !== null) { const sd = Math.sqrt(window.values().reduce((sum, v) => sum + (v - mid) ** 2, 0) / params.period); result.middle = mid; result.upper = mid + params.k * sd; result.lower = mid - params.k * sd; } }
      if (type === 'volume') result.value = row.volume;
      if (type === 'delta') result.value = row.buyVolume - row.sellVolume;
      if (type === 'vwap') { const key = sessionKey(row.sessionDate); if (key !== session) { pv = 0; volume = 0; session = key; } pv += ((row.high + row.low + row.close) / 3) * row.volume; volume += row.volume; if (volume !== 0) result.value = pv / volume; }
      if (type === 'atr') { const tr = prev === null ? row.high - row.low : Math.max(row.high - row.low, Math.abs(row.high - prev), Math.abs(row.low - prev)); prev = row.close; if (atr === null) atr = window.push(tr); else atr = (atr * (params.period - 1) + tr) / params.period; result.value = atr; }
      if (type === 'stochastic') { const high = highest.push(row.high), low = lowest.push(row.low); let raw = null; if (high !== null && high !== low) raw = 100 * (row.close - low) / (high - low); result.K = kWindow.push(raw); result.D = dWindow.push(result.K); }
    }
    for (const [name, value] of Object.entries(result)) { if (value !== null && !Number.isFinite(value)) { issue(index, name, 'Non-finite calculation result'); outputs[name].push(point(row, null)); reset(); } else outputs[name].push(point(row, value)); }
  });
  return { type, parameters: params, outputs, errors };
}
