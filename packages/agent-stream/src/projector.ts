import type { IEventStore, ProjectorConfig, StoredEvent } from "./types.js";

function cloneState<T>(state: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(state);
  }
  if (Array.isArray(state)) {
    return [...state] as T;
  }
  if (state && typeof state === "object") {
    return { ...(state as Record<string, unknown>) } as T;
  }
  return state;
}

/**
 * Reduces a stream of stored events into materialized state.
 *
 * The Projector maintains the current reduced state and the sequence number
 * of the last event it processed. It can catch up from an event store by
 * replaying only events it hasn't seen yet.
 *
 * @category Projection
 */
export class Projector<TState, TEvent> {
  private state: TState;
  private lastSeq: number;
  private readonly config: ProjectorConfig<TState, TEvent>;

  constructor(config: ProjectorConfig<TState, TEvent>) {
    this.config = config;
    this.state = cloneState(config.initialState);
    this.lastSeq = 0;
  }

  /**
   * Apply stored events to the current state.
   *
   * Events with seq ≤ lastSeq are silently skipped (idempotent).
   *
   * @param events - Stored events to reduce into state
   */
  apply(events: StoredEvent<TEvent>[]): void {
    for (const event of events) {
      if (event.seq <= this.lastSeq) continue;
      this.state = this.config.reducer(this.state, event);
      this.lastSeq = event.seq;
    }
  }

  /**
   * Catch up from an event store by replaying events after the last processed seq.
   *
   * @param store - The event store to replay from
   * @param streamId - The stream to catch up on
   * @returns The number of new events applied
   */
  async catchUp(store: IEventStore<TEvent>, streamId: string): Promise<number> {
    const events = await store.replay(streamId, { afterSeq: this.lastSeq });
    this.apply(events);
    return events.length;
  }

  /**
   * Get the current materialized state.
   */
  getState(): TState {
    return this.state;
  }

  /**
   * Get the sequence number of the last event processed.
   * Returns 0 if no events have been processed.
   */
  getLastSeq(): number {
    return this.lastSeq;
  }

  /**
   * Reset the projector to its initial state.
   */
  reset(): void {
    this.state = cloneState(this.config.initialState);
    this.lastSeq = 0;
  }
}
