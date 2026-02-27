/**
 * Cross-platform typed event emitter backed by `Map<string, Set<Function>>`.
 *
 * Zero dependencies — works in browsers and Node.js.
 * `on()` returns an unsubscribe function for convenient cleanup.
 *
 * @category Events
 */
// biome-ignore lint/suspicious/noExplicitAny: event map must allow any value types
export class TypedEmitter<TEvents extends Record<string, (...args: any[]) => void>> {
  // biome-ignore lint/complexity/noBannedTypes: generic callback store requires Function
  private listeners = new Map<string, Set<Function>>();

  on<K extends keyof TEvents & string>(event: K, fn: TEvents[K]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  off<K extends keyof TEvents & string>(event: K, fn: TEvents[K]): void {
    this.listeners.get(event)?.delete(fn);
  }

  emit<K extends keyof TEvents & string>(event: K, ...args: Parameters<TEvents[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as TEvents[K])(...args);
      } catch (error) {
        console.error("[TypedEmitter] listener threw", { event, error });
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
