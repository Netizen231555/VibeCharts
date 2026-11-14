import { validateSessionDate, validateTime } from '../core/validate.js';
import { provenanceDigest } from '../core/provenance.js';

// Replay positions are host-provided safe integers, not timestamps or bar indices.
const copy = value => structuredClone(value);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0;
const fail = message => { throw new Error(message); };

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const fingerprint = value => provenanceDigest(canonical(value));
function serializable(value, field) {
  const check = v => {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (Array.isArray(v)) { v.forEach(check); return; }
    if (object(v) && Object.getPrototypeOf(v) === Object.prototype) { Object.values(v).forEach(check); return; }
    fail(`${field} must contain only finite JSON values`);
  };
  check(value);
}
function checkSlot(slot) {
  if (!object(slot) || !id(slot.barId)) fail('slot requires barId');
  if (slot.time !== undefined) validateTime(slot.time, 'replay.validateInput', 'slot.time');
  if (slot.sessionDate !== undefined) validateSessionDate(slot.sessionDate, 'replay.validateInput', 'sessionDate');
}

// Bar sessions require the host's complete slot order; only available slots are exposed.
export function validateReplayInput({ sourceId, events, streams, intervals, slots } = {}) {
  if (!id(sourceId)) fail('sourceId is required');
  if (!Array.isArray(events)) fail('events must be an array');
  serializable(events, 'events');
  if (streams !== undefined && (!Array.isArray(streams) || streams.some(s => !id(s)) || new Set(streams).size !== streams.length)) fail('streams must be unique identifiers');
  const streamIds = streams && new Set(streams);
  if (slots !== undefined) {
    if (!Array.isArray(slots)) fail('slots must be an array');
    serializable(slots, 'slots');
    slots.forEach(checkSlot);
    if (new Set(slots.map(s => s.barId)).size !== slots.length) fail('duplicate slot barId');
  }
  if (intervals !== undefined && (!Array.isArray(intervals) || ![events.length, Math.max(0, events.length - 1)].includes(intervals.length) || intervals.some(n => !Number.isFinite(n) || n < 0))) fail('intervals must provide nonnegative finite delays');
  let previous = -Infinity;
  const known = new Map();
  const slotsById = slots && new Map(slots.map(slot => [slot.barId, slot]));
  for (const event of events) {
    if (!object(event) || !id(event.streamId) || !Number.isSafeInteger(event.position) || event.position <= previous) fail('events require a unique increasing full-order position and streamId');
    previous = event.position;
    if (streamIds && !streamIds.has(event.streamId)) fail('unknown streamId');
    if (!object(event.payload)) fail('event payload is required');
    if (!['partial', 'close', 'correct', 'observation'].includes(event.type)) fail('invalid event type');
    if (event.time !== undefined) validateTime(event.time, 'replay.validateInput', 'event.time');
    if (event.type === 'observation') {
      if (event.payload.barId !== undefined && !id(event.payload.barId)) fail('observation barId must be a nonempty identifier');
      continue;
    }
    const p = event.payload;
    if (!id(p.barId)) fail('bar event requires barId');
    if (slotsById && !slotsById.has(p.barId)) fail('barId is absent from host slots');
    if (p.slot !== undefined) {
      checkSlot(p.slot);
      if (p.slot.barId !== p.barId || (slotsById && canonical(p.slot) !== canonical(slotsById.get(p.barId)))) fail('slot metadata conflicts with host slots');
    }
    if (!object(p.values) || !Object.keys(p.values).length || Object.values(p.values).some(v => typeof v !== 'number' || !Number.isFinite(v))) fail('bar values must be finite numbers');
    const key = JSON.stringify([event.streamId, p.barId]);
    if (event.type === 'correct' && !known.has(key)) fail('unknown correction target');
    if (event.type !== 'correct' && known.get(key) === 'closed') fail('closed bar requires explicit correction');
    known.set(key, event.type === 'correct' ? known.get(key) : event.type === 'close' ? 'closed' : 'partial');
  }
  if (events.some(event => event.type !== 'observation') && slots === undefined) fail('bar replay requires the host slot order');
  return true;
}

// Definitions use an explicit stream, numeric field and constant threshold.
export function createSimulation(alertDefinitions) {
  if (!Array.isArray(alertDefinitions)) fail('simulation definitions must be an array');
  serializable(alertDefinitions, 'simulation definitions');
  const definitions = copy(alertDefinitions);
  const ids = new Set();
  for (const d of definitions) {
    if (!object(d) || !id(d.id) || ids.has(d.id) || !id(d.streamId) || !id(d.field) || !['above','below','crossUp','crossDown'].includes(d.operation) || !Number.isFinite(d.level) || (d.hysteresis !== undefined && (!Number.isFinite(d.hysteresis) || d.hysteresis < 0)) || (d.mode !== undefined && !['once','repeating'].includes(d.mode)) || (d.observationMode !== undefined && !['partial','closed'].includes(d.observationMode))) fail('invalid simulation definition');
    ids.add(d.id);
  }
  return {
    evaluate(events) {
      const states = definitions.map(() => ({ initialized: false, armed: false, done: false, quiet: false }));
      const results = [];
      for (const event of events) {
        definitions.forEach((d, index) => {
          const s = states[index];
          if (s.done || event.streamId !== d.streamId) return;
          if (event.type === 'correct') { s.initialized = false; s.armed = false; s.quiet = true; return; }
          if (event.type !== 'observation' && d.observationMode !== 'partial' && event.type !== 'close') return;
          const value = event.type === 'observation' ? event.payload[d.field] : event.payload.values[d.field];
          if (typeof value !== 'number' || !Number.isFinite(value)) { s.initialized = false; s.armed = false; s.quiet = true; return; }
          const delta = value - d.level;
          if (!Number.isFinite(delta)) fail('simulation comparison overflow');
          const up = d.operation === 'above' || d.operation === 'crossUp';
          const positive = up ? delta > 0 : delta < 0;
          const initial = !s.initialized;
          const immediate = initial && !s.quiet && (d.operation === 'above' || d.operation === 'below') && positive;
          if (immediate || (!initial && s.armed && positive)) {
            const result = { simulation: true, alertId: d.id, position: event.position, streamId: event.streamId, value, level: d.level, operation: d.operation };
            if (event.payload.barId !== undefined) result.barId = event.payload.barId;
            results.push(result); s.armed = false;
            if (d.mode === 'once') s.done = true;
          } else if (initial && (d.operation === 'crossUp' || d.operation === 'crossDown')) {
            s.armed = up ? delta <= 0 : delta >= 0;
          } else if (up ? delta <= -(d.hysteresis ?? 0) : delta >= (d.hysteresis ?? 0)) s.armed = true;
          s.quiet = false;
          s.initialized = true;
        });
      }
      return results;
    },
  };
}

export function createReplaySession({ source, events, config = {}, scheduler, onState } = {}) {
  if (!object(source)) fail('source is required');
  if (!object(config)) fail('config must be an object');
  serializable(config, 'config');
  validateReplayInput({ sourceId: source.sourceId, events, streams: source.streams, intervals: source.intervals, slots: source.slots });
  if (onState !== undefined && typeof onState !== 'function') fail('onState must be a function');
  if (source.apply !== undefined && typeof source.apply !== 'function') fail('source.apply must be a function');
  if (source.views !== undefined && (!Array.isArray(source.views) || source.views.some(view => !view || typeof view.apply !== 'function' || typeof view.rollback !== 'function'))) fail('source.views require apply and rollback functions');
  // apply must itself be atomic. Each view must restore its pre-apply state in
  // rollback, including when its own apply throws after a partial change.
  const views = source.views ? [...source.views] : [];
  if (scheduler !== undefined && (!scheduler || typeof scheduler.setTimeout !== 'function' || typeof scheduler.clearTimeout !== 'function')) fail('invalid scheduler');
  const timers = scheduler ?? globalThis;
  const input = copy(events), slots = copy(source.slots ?? []), intervals = source.intervals && copy(source.intervals);
  const slotById = new Map(slots.map(slot => [slot.barId, slot]));
  const slotOrder = new Map(slots.map((slot, index) => [slot.barId, index]));
  const sourceId = source.sourceId, orderHash = fingerprint({ events: input, slots, streams: source.streams ? [...source.streams].sort() : null, intervals: intervals ?? null }), configHash = fingerprint(config);
  const listeners = new Set();
  let index = -1, playing = false, speed = 1, timer = null, generation = 0, destroyed = false, simulation = null, simulationDefinitions = null;
  let state = build(-1);
  function alive() { if (destroyed) fail('replay session is destroyed'); }
  function cancel() { generation++; if (timer !== null) { timers.clearTimeout(timer); timer = null; } }
  function build(end) {
    const visible = input.slice(0, end + 1), timeline = [], streamMap = new Map(), visibleSlots = new Map(), barsByStream = new Map();
    for (const event of visible) {
      if (!streamMap.has(event.streamId)) {
        streamMap.set(event.streamId, { streamId: event.streamId, bars: [], observations: [] });
        barsByStream.set(event.streamId, new Map());
      }
      const stream = streamMap.get(event.streamId), p = event.payload;
      if (event.type === 'observation') { stream.observations.push(copy(p)); continue; }
      if (!visibleSlots.has(p.barId)) {
        const slot = slotById.get(p.barId);
        visibleSlots.set(p.barId, copy(slot)); timeline.push(copy(slot));
      }
      const barsById = barsByStream.get(event.streamId);
      const existing = barsById.get(p.barId);
      if (event.type === 'correct') { existing.values = { ...existing.values, ...copy(p.values) }; }
      else if (existing) { existing.values = { ...existing.values, ...copy(p.values) }; existing.closed = event.type === 'close'; }
      else {
        const bar = { barId: p.barId, values: copy(p.values), closed: event.type === 'close' };
        stream.bars.push(bar);
        barsById.set(p.barId, bar);
      }
    }
    if (slots.length) {
      timeline.sort((a, b) => slotOrder.get(a.barId) - slotOrder.get(b.barId));
      for (const stream of streamMap.values()) stream.bars.sort((a, b) => slotOrder.get(a.barId) - slotOrder.get(b.barId));
    }
    return { position: end < 0 ? null : input[end].position, events: copy(visible), timeline, streams: [...streamMap.values()], simulation: simulation ? simulation.evaluate(visible) : [] };
  }
  function publish(next, nextIndex, afterCommit) {
    const applied = [];
    const previousState = state, previousIndex = index;
    try {
      for (const view of views) {
        applied.push(view);
        view.apply(copy(next));
      }
      // The final source application may notify chart observers. Earlier
      // linked views must apply silently, and the cursor must already match.
      state = next; index = nextIndex;
      if (source.apply) source.apply(copy(next));
    } catch (error) {
      state = previousState; index = previousIndex;
      const errors = [error];
      for (let i = applied.length - 1; i >= 0; i--) {
        try { applied[i].rollback(copy(previousState)); } catch (rollbackError) { errors.push(rollbackError); }
      }
      if (errors.length > 1) throw new AggregateError(errors, 'replay application and rollback failed');
      throw error;
    }
    if (afterCommit) afterCommit();
    const exposed = copy(state);
    if (onState) onState(copy(exposed));
    for (const listener of [...listeners]) listener(copy(exposed));
  }
  function schedule() {
    if (!playing || index >= input.length - 1) { playing = false; return; }
    const next = index + 1;
    const delay = intervals.length === input.length ? intervals[next] : next === 0 ? 0 : intervals[next - 1];
    const token = generation;
    timer = timers.setTimeout(() => {
      if (destroyed || !playing || token !== generation) return;
      timer = null;
      const target = index + 1;
      try { publish(build(target), target); } catch (error) { playing = false; throw error; }
      schedule();
    }, delay / speed);
  }
  return {
    play() { alive(); if (playing) return { end: false }; if (index === input.length - 1) return { end: true }; if (!intervals) fail('timed play requires host intervals'); if (typeof timers.setTimeout !== 'function' || typeof timers.clearTimeout !== 'function') fail('timed replay requires timer support'); playing = true; try { schedule(); } catch (error) { playing = false; throw error; } return { end: false }; },
    pause() { alive(); cancel(); playing = false; },
    step() { alive(); if (index === input.length - 1) return { end: true }; const next = index + 1, result = build(next); publish(result, next, () => { cancel(); playing = false; }); return { end: false }; },
    seek(position) { alive(); const target = position === null ? -1 : input.findIndex(e => e.position === position); if (target < 0 && position !== null) fail('invalid replay position'); const result = build(target); publish(result, target, () => { cancel(); playing = false; }); },
    setSpeed(value) { alive(); if (!Number.isFinite(value) || value <= 0) fail('speed must be positive and finite'); speed = value; if (playing) { cancel(); schedule(); } },
    snapshot() {
      alive();
      return { version: 3, sourceId, orderHash, configHash, position: state.position, speed, simulationDefinitions: copy(simulationDefinitions), state: copy(state) };
    },
    restore(snapshot) {
      alive();
      if (!object(snapshot) || snapshot.version !== 3 || snapshot.sourceId !== sourceId || snapshot.orderHash !== orderHash || snapshot.configHash !== configHash ||
          !Number.isFinite(snapshot.speed) || snapshot.speed <= 0 || (snapshot.simulationDefinitions !== null && !Array.isArray(snapshot.simulationDefinitions))) fail('incompatible replay snapshot');
      const target = snapshot.position === null ? -1 : input.findIndex(event => event.position === snapshot.position);
      if (target < 0 && snapshot.position !== null) fail('invalid snapshot position');
      const previous = simulation, previousDefinitions = simulationDefinitions;
      simulation = snapshot.simulationDefinitions === null ? null : createSimulation(snapshot.simulationDefinitions);
      simulationDefinitions = copy(snapshot.simulationDefinitions);
      let result;
      try {
        result = build(target);
        if (canonical(result) !== canonical(snapshot.state)) fail('incompatible snapshot state');
        publish(result, target, () => { cancel(); playing = false; speed = snapshot.speed; });
      } catch (error) {
        if (state !== result) { simulation = previous; simulationDefinitions = previousDefinitions; }
        throw error;
      }
    },
    getState() { alive(); return copy(state); },
    subscribe(listener) { alive(); if (typeof listener !== 'function') fail('listener must be a function'); listeners.add(listener); let active = true; return () => { if (active) { active = false; listeners.delete(listener); } }; },
    createSimulation(definitions) { alive(); const next = createSimulation(definitions); const prior = simulation, priorDefinitions = simulationDefinitions; simulation = next; simulationDefinitions = copy(definitions); let result; try { result = build(index); publish(result, index); } catch (error) { if (state !== result) { simulation = prior; simulationDefinitions = priorDefinitions; } throw error; } },
    destroy() { if (destroyed) return; cancel(); playing = false; destroyed = true; listeners.clear(); simulation = null; simulationDefinitions = null; },
  };
}
