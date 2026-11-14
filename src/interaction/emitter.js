/** Minimal synchronous event emitter with idempotent unsubscribe. */
export function createEmitter() {
  const handlers = new Map();
  return {
    on(event, handler) {
      if (typeof handler !== 'function') throw new TypeError('Handler must be a function');
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        const set = handlers.get(event);
        if (set) set.delete(handler);
      };
    },
    offAll() {
      handlers.clear();
    },
    emit(event, payload) {
      const set = handlers.get(event);
      if (!set) return;
      for (const handler of [...set]) handler(payload);
    },
    count(event) {
      const set = handlers.get(event);
      return set ? set.size : 0;
    },
  };
}
