export const API_VERSION = '1.0.0';

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function versionParts(value) {
  const match = typeof value === 'string' && semver.exec(value);
  if (!match) throw new Error(`Invalid semantic version: ${value}`);
  return match.slice(1).map(Number);
}
export function parseSemverRange(range) {
  if (typeof range !== 'string') throw new Error('Invalid API range');
  const match = /^(\^|~|>=)?(\d+\.\d+\.\d+)$/.exec(range.trim());
  if (!match) throw new Error(`Invalid API range: ${range}`);
  return { operator: match[1] || '=', version: match[2], parts: versionParts(match[2]) };
}
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}
export function satisfiesRange(version, range) {
  const v = versionParts(version), r = parseSemverRange(range), c = compare(v, r.parts);
  if (r.operator === '=') return c === 0;
  if (r.operator === '>=') return c >= 0;
  if (c < 0) return false;
  if (r.operator === '~') return v[0] === r.parts[0] && v[1] === r.parts[1];
  if (r.parts[0] !== 0) return v[0] === r.parts[0];
  if (r.parts[1] !== 0) return v[0] === 0 && v[1] === r.parts[1];
  return v[0] === 0 && v[1] === 0 && v[2] === r.parts[2];
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a nonempty string`);
}
function serializable(value, field, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || seen.has(value)) throw new Error(`${field} must contain serializable data`);
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) throw new Error(`${field} must be plain data`);
  seen.add(value);
  for (const [key, child] of Object.entries(value)) serializable(child, `${field}.${key}`, seen);
  seen.delete(value);
}
const copy = value => JSON.parse(JSON.stringify(value));
function validateAnchor(anchor, field) {
  if (!object(anchor)) throw new Error(`${field} must be an anchor`);
  text(anchor.anchorBarId, `${field}.anchorBarId`);
  if (!Number.isFinite(anchor.offset)) throw new Error(`${field}.offset must be finite`);
  if ('price' in anchor && !Number.isFinite(anchor.price)) throw new Error(`${field}.price must be finite`);
  if ('time' in anchor && (!Number.isSafeInteger(anchor.time) || Math.abs(anchor.time) > 8640000000000000)) throw new Error(`${field}.time must be Unix milliseconds within the Date range`);
}
function slotsOf(timeline) {
  if (Array.isArray(timeline)) return timeline;
  if (typeof timeline?.getSlots === 'function') return timeline.getSlots();
  if (typeof timeline?.listSlots === 'function') return timeline.listSlots();
  if (typeof timeline?.list === 'function') return timeline.list();
  if (typeof timeline?.slots === 'function') return timeline.slots();
  return timeline?.slots ?? [];
}
function slotIndex(timeline, id) {
  if (typeof timeline?.indexOf === 'function' && !Array.isArray(timeline)) return timeline.indexOf(id) ?? -1;
  return slotsOf(timeline).findIndex(slot => slot.barId === id);
}
function validateConfig(type, config, timeline) {
  if (!object(config)) throw new Error('config must be an object');
  serializable(config, 'config');
  if (type === 'series') {
    if (!Array.isArray(config.points)) throw new Error('config.points must be an array');
    for (const [i, point] of config.points.entries()) {
      if (!object(point)) throw new Error(`config.points.${i} must be a point`);
      text(point.barId, `config.points.${i}.barId`);
      if (slotIndex(timeline, point.barId) < 0) throw new Error(`config.points.${i}.barId is not on timeline`);
      if (!Number.isFinite(point.value)) throw new Error(`config.points.${i}.value must be finite`);
      if ('time' in point && (!Number.isSafeInteger(point.time) || Math.abs(point.time) > 8640000000000000)) throw new Error(`config.points.${i}.time must be Unix milliseconds within the Date range`);
    }
  }
  if (type === 'drawing') {
    if (config.anchors !== undefined) {
      if (!Array.isArray(config.anchors)) throw new Error('config.anchors must be an array');
      config.anchors.forEach((a, i) => validateAnchor(a, `config.anchors.${i}`));
    }
    if ('price' in config && !Number.isFinite(config.price)) throw new Error('config.price must be finite');
  }
  if (type === 'indicator') {
    if (!Array.isArray(config.inputFields) || !config.inputFields.length) throw new Error('config.inputFields is required');
    config.inputFields.forEach((field, i) => text(field, `config.inputFields.${i}`));
    if (!object(config.units)) throw new Error('config.units is required');
    for (const field of config.inputFields) text(config.units[field], `config.units.${field}`);
    if (!object(config.outputs) || !Object.keys(config.outputs).length) throw new Error('config.outputs is required');
    for (const [name, unit] of Object.entries(config.outputs)) text(unit, `config.outputs.${name}`);
    if (!Array.isArray(config.points)) throw new Error('config.points is required');
    for (const [i, point] of config.points.entries()) {
      if (!object(point)) throw new Error(`config.points.${i} must be an object`);
      text(point.barId, `config.points.${i}.barId`);
      if (slotIndex(timeline, point.barId) < 0) throw new Error(`config.points.${i}.barId is not on timeline`);
      for (const field of config.inputFields) if (!Number.isFinite(point[field])) throw new Error(`config.points.${i}.${field} is required and finite`);
      if ('time' in point && (!Number.isSafeInteger(point.time) || Math.abs(point.time) > 8640000000000000)) throw new Error(`config.points.${i}.time must be Unix milliseconds within the Date range`);
    }
  }
}

/** Extensions are trusted host code, not sandboxed. Storage and external actions belong to the host. */
export function createExtensionRegistry({ chartContext, onError = () => {} }) {
  if (!object(chartContext)) throw new Error('chartContext is required');
  if (typeof onError !== 'function') throw new Error('onError must be a function');
  const registrations = new Map(), instances = new Map(), listeners = new Set();
  let nextId = 1;
  const report = (id, operation, error) => { try { onError({ id, operation, error }); } catch { /* A host error handler must not interrupt cleanup. */ } };
  const emit = event => { for (const listener of listeners) { try { listener(event); } catch (error) { report(event.id, 'subscribe', error); } } };
  const timeline = chartContext.timeline;
  function stateContext() {
    const context = typeof chartContext.context === 'function' ? chartContext.context() : chartContext.context;
    if (!object(context)) throw new Error('extension state: chart context is required');
    for (const field of ['instrumentId', 'interval', 'sourceId', 'view']) text(context[field], `context.${field}`);
    return { instrumentId: context.instrumentId, interval: context.interval, sourceId: context.sourceId, view: context.view };
  }
  function register(extension) {
    if (!object(extension)) throw new Error('extension must be an object');
    const { id, version, apiRange, type, factory, schemaVersion } = extension;
    text(id, 'id'); versionParts(version); text(type, 'type');
    if (typeof factory !== 'function') throw new Error(`${id}: factory must be a function`);
    if (!(typeof schemaVersion === 'string' && schemaVersion.trim()) && !(Number.isSafeInteger(schemaVersion) && schemaVersion > 0)) throw new Error(`${id}: schemaVersion is required`);
    for (const key of ['cleanup', 'exportState', 'importState', 'validate']) if (extension[key] !== undefined && typeof extension[key] !== 'function') throw new Error(`${id}: ${key} must be a function`);
    if (!satisfiesRange(API_VERSION, apiRange)) throw new Error(`${id}: API range ${apiRange} is incompatible with ${API_VERSION}`);
    const previous = registrations.get(id);
    if (previous) throw new Error(`${id}: registration conflict between versions ${previous.version} and ${version}`);
    const entry = { ...extension, instances: new Set() };
    registrations.set(id, entry);
    emit({ operation: 'register', id });
    return { id, version, type, unregister: () => { if (registrations.get(id) === entry) unregister(id); } };
  }
  function unregister(id) {
    const entry = registrations.get(id);
    if (!entry) return;
    for (const instance of [...entry.instances]) instance.dispose();
    registrations.delete(id);
    emit({ operation: 'unregister', id });
  }
  function create(id, config, importedState) {
    const entry = registrations.get(id);
    if (!entry) throw new Error(`${id}: unknown extension`);
    const resources = new Set();
    const own = cleanup => {
      if (typeof cleanup !== 'function') throw new Error(`${id}: resource must provide cleanup`);
      let active = true;
      const release = () => { if (!active) return; active = false; resources.delete(release); cleanup(); };
      resources.add(release); return release;
    };
    const releaseAll = () => { for (const release of [...resources]) { try { release(); } catch (error) { report(id, 'cleanup', error); } } };
    const context = Object.freeze({
      indexScale: () => chartContext.indexScale(), timeline,
      subscribe: (...args) => own(chartContext.subscribe(...args)),
      requestRender: (...args) => chartContext.requestRender(...args),
      addControl: control => {
        if (!object(control)) throw new Error('control must be an object');
        text(control.id, 'control.id'); text(control.name, 'control.name'); text(control.role, 'control.role');
        if (control.render !== undefined && typeof control.render !== 'function') throw new Error('control.render must be a function');
        if (typeof control.onActivate !== 'function') throw new Error('control.onActivate must be a function');
        const wrapped = { ...control, onActivate(...args) {
          try { return control.onActivate(...args); }
          catch (error) { report(id, 'control-activate', error); throw error; }
        } };
        const result = chartContext.addControl(wrapped);
        const remove = typeof result === 'function' ? result : () => chartContext.removeControl(control.id);
        return own(remove);
      },
      removeControl: release => { if (typeof release !== 'function' || !resources.has(release)) throw new Error('control is not owned by this instance'); release(); },
      resolveAnchor: anchor => { validateAnchor(anchor, 'anchor'); const index = slotIndex(timeline, anchor.anchorBarId); return index < 0 || index == null ? null : index + anchor.offset; },
      series: chartContext.series,
      reportError: (operation, error) => report(id, operation, error)
    });
    let implementation;
    try {
      validateConfig(entry.type, config, timeline);
      if (entry.validate) entry.validate(config, importedState);
      implementation = entry.factory(context, copy(config));
      if (!object(implementation)) throw new Error('factory must return an instance object');
      if (entry.type === 'indicator' && typeof implementation.compute !== 'function') throw new Error('indicator compute must be a function');
      if (typeof implementation.init === 'function') implementation.init();
      if (importedState !== undefined) {
        if (entry.importState) entry.importState(implementation, copy(importedState), context);
        else if (typeof implementation.importState === 'function') implementation.importState(copy(importedState));
        else implementation.state = copy(importedState);
      }
    } catch (error) { releaseAll(); report(id, 'create', error); throw error; }
    let currentConfig = copy(config), disposed = false;
    const instanceId = `${id}:${nextId++}`;
    const descriptor = {
      id, instanceId, type: entry.type,
      renderable: typeof implementation.render === 'function',
      get state() { return implementation.state; },
      get config() { return copy(currentConfig); },
      render(...args) {
        if (disposed) throw new Error(`${id}: instance is disposed`);
        if (typeof implementation.render !== 'function') throw new Error(`${id}: render is not supported`);
        try { return implementation.render(...args); } catch (error) { report(id, 'render', error); throw error; }
      },
      compute() {
        if (disposed) throw new Error(`${id}: instance is disposed`);
        if (entry.type !== 'indicator') throw new Error(`${id}: compute is only available for indicators`);
        try {
          const result = implementation.compute(copy(currentConfig.points), copy(currentConfig.parameters ?? {}));
          if (!object(result)) throw new Error('indicator result must contain named outputs');
          const inputs = new Map(currentConfig.points.map(point => [point.barId, point]));
          for (const name of Object.keys(currentConfig.outputs)) {
            if (!Array.isArray(result[name])) throw new Error(`indicator output ${name} is required`);
            for (const point of result[name]) {
              if (!object(point) || slotIndex(timeline, point.barId) < 0 || !(point.value === null || Number.isFinite(point.value))) throw new Error(`indicator output ${name} has an invalid point`);
              if ('time' in point && (!Number.isSafeInteger(point.time) || Math.abs(point.time) > 8640000000000000 ||
                  !inputs.has(point.barId) || inputs.get(point.barId).time !== point.time)) throw new Error(`indicator output ${name} has invalid time`);
            }
          }
          return result;
        } catch (error) { report(id, 'compute', error); throw error; }
      },
      update(next) {
        if (disposed) throw new Error(`${id}: instance is disposed`);
        try {
          validateConfig(entry.type, next, timeline);
          if (entry.validate) entry.validate(next);
          if (typeof implementation.update !== 'function') throw new Error(`${id}: update is not supported`);
          implementation.update(copy(next)); currentConfig = copy(next);
        } catch (error) { report(id, 'update', error); throw error; }
        emit({ operation: 'update', id, instanceId });
      },
      dispose() {
        if (disposed) return;
        disposed = true; instances.delete(instanceId); entry.instances.delete(descriptor);
        for (const cleanup of [implementation.dispose, entry.cleanup]) if (typeof cleanup === 'function') {
          try { cleanup.call(implementation, implementation, context); } catch (error) { report(id, 'cleanup', error); }
        }
        releaseAll(); emit({ operation: 'dispose', id, instanceId });
      }
    };
    instances.set(instanceId, descriptor); entry.instances.add(descriptor);
    emit({ operation: 'create', id, instanceId });
    return descriptor;
  }
  function exportState() {
    const records = [];
    for (const instance of instances.values()) {
      const entry = registrations.get(instance.id);
      let state = entry.exportState ? entry.exportState(instance.state, instance.config) : instance.state;
      if (state === undefined) state = null;
      serializable(state, `${instance.id}.state`);
      records.push({ id: instance.id, type: entry.type, version: entry.version, schemaVersion: entry.schemaVersion, config: instance.config, state: copy(state) });
    }
    return { version: 2, context: stateContext(), instances: records };
  }
  function importState(document) {
    if (!object(document) || document.version !== 2 || !object(document.context) || !Array.isArray(document.instances)) throw new Error('import: invalid document version, context or instances');
    serializable(document, 'import');
    const context = stateContext();
    for (const field of ['instrumentId', 'interval', 'sourceId', 'view']) {
      if (document.context[field] !== context[field]) throw new Error(`import: incompatible context.${field}`);
    }
    for (const record of document.instances) {
      if (!object(record)) throw new Error('import: invalid instance');
      const entry = registrations.get(record.id);
      if (!entry) throw new Error(`import: unknown extension ${record.id}`);
      if (record.type !== entry.type) throw new Error(`import ${record.id}: incompatible type`);
      if (record.version !== entry.version) throw new Error(`import ${record.id}: incompatible version ${record.version}`);
      if (record.schemaVersion !== entry.schemaVersion) throw new Error(`import ${record.id}: unsupported schemaVersion ${record.schemaVersion}`);
      if (!('state' in record)) throw new Error(`import ${record.id}: missing state`);
      try {
        validateConfig(entry.type, record.config, timeline);
        if (entry.validate) entry.validate(record.config, record.state);
      } catch (error) {
        throw new Error(`import ${record.id}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
    }
    const created = [];
    try { for (const record of document.instances) created.push(create(record.id, record.config, record.state)); }
    catch (error) { for (const instance of created) instance.dispose(); throw error; }
    return created;
  }
  return {
    register, unregister, create,
    listRegistrations: () => [...registrations.values()].map(({ id, version, apiRange, type, schemaVersion }) => ({ id, version, apiRange, type, schemaVersion })),
    listInstances: () => [...instances.values()],
    get counts() { return { registrations: registrations.size, instances: instances.size }; },
    disposeAll() { for (const id of [...registrations.keys()]) unregister(id); },
    subscribe(listener) { if (typeof listener !== 'function') throw new Error('listener must be a function'); listeners.add(listener); return () => listeners.delete(listener); },
    exportState, importState
  };
}
