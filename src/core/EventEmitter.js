/** Minimal pub/sub used by Models to notify Views/Controllers of state changes. */
export class EventEmitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }

  emit(event, payload) {
    for (const fn of this.#handlers.get(event) ?? []) fn(payload);
  }
}
