import { fail } from '../errors.js';

// Only library-defined handles and declared subscription methods are scoped.
export function createModuleScope(chart, name, api, shape = {}) {
  let active = true;
  const releases = new Set();
  const cache = new WeakMap();
  const originals = new WeakMap();
  const dropTargets = new Set();
  const assertActive = operation => {
    chart._assertAlive(operation);
    if (!active) fail('MODULE_DETACHED', operation, 'chart module has been detached');
  };
  function wrap(value, descriptor, operation) {
    if (value == null) return value;
    if (descriptor.array) return value.map(item => wrap(item, descriptor.array, operation));
    if (cache.has(value)) return cache.get(value);
    const target = typeof value === 'function' ? function () {} : Object.create(Object.getPrototypeOf(value));
    let proxy;
    const invoke = (fn, receiver, args, method, resultShape) => {
      assertActive(operation + (method ? `.${String(method)}` : ''));
      args = args.map(arg => originals.get(arg) ?? arg);
      const isSubscription = descriptor.subscriptions?.includes(method);
      const callArgs = isSubscription ? args.map(arg => typeof arg === 'function'
        ? (...values) => { if (active && !chart._destroyed) return arg(...values); }
        : arg) : descriptor.collection && method === 'forEach' && typeof args[0] === 'function'
          ? [(entry, key) => { assertActive(operation); args[0].call(args[1], entry, key, proxy); }]
          : args;
      const result = Reflect.apply(fn, receiver, callArgs);
      if (isSubscription && typeof result === 'function') {
        let cancel = result;
        let subscribed = true;
        const release = () => {
          if (!subscribed) return;
          subscribed = false;
          releases.delete(release);
          const unsubscribe = cancel;
          cancel = null;
          return unsubscribe();
        };
        releases.add(release);
        return release;
      }
      if (result === value) return proxy;
      const nextShape = typeof resultShape === 'function' ? resultShape(result) : resultShape;
      return nextShape ? wrap(result, nextShape, `${operation}.${String(method)}()`) : result;
    };
    proxy = new Proxy(target, {
      get(_target, key) {
        assertActive(`${operation}.${String(key)}`);
        const member = Reflect.get(value, key, value);
        if (typeof member === 'function') {
          if (descriptor.methods && !descriptor.methods.includes(key)) return member;
          return (...args) => invoke(member, value, args, key, descriptor.results?.[key]);
        }
        return descriptor.properties?.[key]
          ? wrap(member, descriptor.properties[key], `${operation}.${String(key)}`)
          : member;
      },
      set(_target, key, next) {
        assertActive(`${operation}.${String(key)}`);
        return Reflect.set(value, key, next, value);
      },
      has(_target, key) {
        assertActive(`${operation}.${String(key)}`);
        return Reflect.has(value, key);
      },
      ownKeys() {
        assertActive(operation);
        return [...new Set([...Reflect.ownKeys(target), ...Reflect.ownKeys(value)])];
      },
      getOwnPropertyDescriptor(_target, key) {
        assertActive(`${operation}.${String(key)}`);
        const existing = Reflect.getOwnPropertyDescriptor(target, key);
        if (existing && !existing.configurable) return existing;
        const property = Reflect.getOwnPropertyDescriptor(value, key);
        return property ? { configurable: true, enumerable: property.enumerable, writable: true, value: proxy[key] } : existing;
      },
      apply(_target, thisArg, args) {
        return invoke(value, thisArg, args, null, descriptor.callResult);
      }
    });
    cache.set(value, proxy);
    originals.set(proxy, value);
    dropTargets.add(() => { originals.delete(proxy); value = null; });
    return proxy;
  }
  const exposed = wrap(api, shape, `chart.${name}`);
  return {
    api: exposed,
    dispose() {
      if (!active) return;
      active = false;
      const errors = [];
      for (const release of [...releases]) {
        try { release(); } catch (error) { errors.push(error); }
      }
      for (const drop of dropTargets) drop();
      dropTargets.clear();
      if (errors.length) throw new AggregateError(errors, `chart.${name}: failed to release subscriptions`);
    }
  };
}
