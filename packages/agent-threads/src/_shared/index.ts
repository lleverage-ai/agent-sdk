/**
 * Shared infrastructure types used by both stream and ledger layers.
 *
 * @internal Not part of the public package exports.
 * @module
 */

export type { Logger } from "./types.js";
export { defaultLogger } from "./types.js";
export type { SQLiteDatabase, SQLiteStatement } from "./sqlite-types.js";
