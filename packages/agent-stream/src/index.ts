/**
 * @lleverage-ai/agent-stream — Realtime event transport and replay.
 *
 * This barrel exports core types, the Projector, protocol helpers, and event stores.
 * WebSocket server and client are available via subpath imports:
 *
 * - `@lleverage-ai/agent-stream/server` — {@link WsServer}
 * - `@lleverage-ai/agent-stream/client` — {@link WsClient}
 * - `@lleverage-ai/agent-stream/stores/memory` — {@link InMemoryEventStore}
 * - `@lleverage-ai/agent-stream/stores/sqlite` — {@link SQLiteEventStore}
 *
 * @module
 */

// Types
export type { IEventStore, StoredEvent, ReplayOptions, ProjectorConfig, Logger } from "./types.js";
export { defaultLogger } from "./types.js";

// Stream events
export type { StreamEvent, CoreEventKind } from "./stream-event.js";
export { CORE_EVENT_KINDS, EventKindRegistry } from "./stream-event.js";

// Projector
export { Projector } from "./projector.js";

// Stores
export { InMemoryEventStore } from "./stores/memory.js";
export { SQLiteEventStore } from "./stores/sqlite.js";
export type { SQLiteDatabase, SQLiteStatement } from "./stores/sqlite.js";

// Protocol
export type {
	ClientMessage,
	ServerMessage,
	HelloMessage,
	SubscribeMessage,
	UnsubscribeMessage,
	PongMessage,
	ServerHelloMessage,
	EventMessage,
	ReplayEndMessage,
	PingMessage,
	ErrorMessage,
	ProtocolError,
} from "./protocol.js";
export { PROTOCOL_VERSION, PROTOCOL_ERRORS, encodeMessage, decodeMessage } from "./protocol.js";

// WebSocket types (for DI)
export type { IWebSocket, WebSocketConstructor } from "./ws-types.js";
export { WS_READY_STATE } from "./ws-types.js";

// Emitter
export { TypedEmitter } from "./emitter.js";
