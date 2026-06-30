/**
 * Minimal WebSocket interface for dependency injection.
 *
 * Compatible with both browser `WebSocket` and Node.js `ws` library.
 *
 * @category WebSocket
 */
export interface IWebSocket {
  readonly readyState: 0 | 1 | 2 | 3;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/**
 * WebSocket ready-state constants.
 *
 * @category WebSocket
 */
export const WS_READY_STATE = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * Constructor type for creating WebSocket instances via dependency injection.
 *
 * @category WebSocket
 */
export type WebSocketConstructor = new (url: string, protocols?: string | string[]) => IWebSocket;

/**
 * Extract the data string from a WebSocket message event.
 *
 * Handles both the browser `MessageEvent` shape (`{ data: string }`)
 * and the bare-string shape used by some mocks.
 *
 * @internal
 */
export function extractMessageData(event: unknown): string {
  return typeof event === "object" && event !== null && "data" in event
    ? (event as { data: string }).data
    : String(event);
}
