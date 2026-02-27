import type { IEventStore, ReplayOptions, StoredEvent } from "../types.js";

/**
 * In-memory event store backed by a Map of arrays.
 *
 * Suitable for testing, development, and short-lived processes.
 * All data is lost when the process exits.
 *
 * @category Stores
 */
export class InMemoryEventStore<TEvent> implements IEventStore<TEvent> {
  private streams = new Map<string, StoredEvent<TEvent>[]>();

  async append(streamId: string, events: TEvent[]): Promise<StoredEvent<TEvent>[]> {
    if (events.length === 0) return [];

    let stream = this.streams.get(streamId);
    if (!stream) {
      stream = [];
      this.streams.set(streamId, stream);
    }

    const lastSeq = stream.length > 0 ? stream[stream.length - 1]!.seq : 0;
    const timestamp = new Date().toISOString();

    const stored: StoredEvent<TEvent>[] = events.map((event, i) => ({
      seq: lastSeq + i + 1,
      timestamp,
      streamId,
      event,
    }));

    stream.push(...stored);
    return stored;
  }

  async replay(streamId: string, options?: ReplayOptions): Promise<StoredEvent<TEvent>[]> {
    const stream = this.streams.get(streamId);
    if (!stream) return [];

    const afterSeq = options?.afterSeq ?? 0;
    const limit = options?.limit;

    let result = stream.filter((e) => e.seq > afterSeq);
    if (limit !== undefined && limit >= 0) {
      result = result.slice(0, limit);
    }

    return result;
  }

  async head(streamId: string): Promise<number> {
    const stream = this.streams.get(streamId);
    if (!stream || stream.length === 0) return 0;
    return stream[stream.length - 1]!.seq;
  }

  async delete(streamId: string): Promise<void> {
    this.streams.delete(streamId);
  }
}
