/**
 * A stored event with metadata assigned by the event store.
 *
 * @category Types
 */
export interface StoredEvent<TEvent> {
  /** Monotonic sequence number within the stream */
  seq: number;
  /** ISO 8601 timestamp of when the event was stored */
  timestamp: string;
  /** The stream this event belongs to */
  streamId: string;
  /** The event payload */
  event: TEvent;
}

/**
 * Options for replaying events from a store.
 *
 * @category Types
 */
export interface ReplayOptions {
  /** Exclusive lower bound — only events with seq > afterSeq are returned */
  afterSeq?: number;
  /** Maximum number of events to return */
  limit?: number;
}

/**
 * Interface for event stores that persist and replay ordered event streams.
 *
 * Event stores provide append-only, ordered storage for events grouped by stream ID.
 * Each event receives a monotonically increasing sequence number within its stream.
 *
 * @category Types
 */
export interface IEventStore<TEvent> {
  /**
   * Append one or more events to a stream.
   *
   * @param streamId - The stream to append to
   * @param events - Events to append (in order)
   * @returns The stored events with assigned seq numbers and timestamps
   */
  append(streamId: string, events: TEvent[]): Promise<StoredEvent<TEvent>[]>;

  /**
   * Replay events from a stream.
   *
   * @param streamId - The stream to replay from
   * @param options - Filtering options (afterSeq, limit)
   * @returns Stored events in seq order
   */
  replay(streamId: string, options?: ReplayOptions): Promise<StoredEvent<TEvent>[]>;

  /**
   * Get the highest sequence number in a stream.
   *
   * @param streamId - The stream to query
   * @returns The highest seq number, or 0 if the stream is empty
   */
  head(streamId: string): Promise<number>;

  /**
   * Delete all events in a stream.
   *
   * @param streamId - The stream to delete
   */
  delete(streamId: string): Promise<void>;
}

/**
 * Configuration for a Projector that reduces events into state.
 *
 * @category Types
 */
export interface ProjectorConfig<TState, TEvent> {
  /** The initial state before any events are applied */
  initialState: TState;
  /** Reducer function that produces new state from current state and an event */
  reducer: (state: TState, event: StoredEvent<TEvent>) => TState;
}

/**
 * Minimal logger interface for routing diagnostics through the host application's
 * logging pipeline instead of writing directly to the console.
 *
 * @category Types
 */
export interface Logger {
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** @internal */
export const defaultLogger: Logger = {
  warn: (message, meta) => console.warn(message, meta),
  error: (message, meta) => console.error(message, meta),
};
