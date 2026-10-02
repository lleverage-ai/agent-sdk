/**
 * The default projection adapter and the projection contract the log-mode
 * runtime records on versions.
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import { projectMessagesForModel } from "../agent/model-capabilities.js";
import type { ModelInputCapabilities } from "../types.js";
import { canonicalContextJson } from "./json.js";
import { activeContextEntries } from "./supersession.js";
import type {
  ContextEntryInput,
  ContextProjectionContractKey,
  ProjectedModelInput,
  ProjectionAdapter,
  ProjectionInput,
} from "./types.js";

/** Identifier of the adapter returned by {@link createMessageProjectionAdapter}. */
const MESSAGE_PROJECTION_ADAPTER_ID = "agent-sdk/messages";
/** Version of the adapter returned by {@link createMessageProjectionAdapter}. */
const MESSAGE_PROJECTION_ADAPTER_VERSION = "1";

/**
 * The contract values the runtime records for an adapter and a model's
 * capabilities.
 *
 * @internal
 */
export function buildProjectionContract(
  adapter: Pick<ProjectionAdapter, "id" | "version">,
  capabilities: ModelInputCapabilities | undefined,
): Record<ContextProjectionContractKey, string> {
  return {
    adapter: adapter.id,
    adapterVersion: adapter.version,
    imageInput: capabilities?.imageInput === false ? "false" : "true",
    fileInput: capabilities?.fileInput === false ? "false" : "true",
  };
}

/**
 * Keys of `expected` whose value differs in `actual`.
 *
 * @internal
 */
export function projectionContractMismatches(
  actual: Readonly<Record<string, string>>,
  expected: Record<ContextProjectionContractKey, string>,
): ContextProjectionContractKey[] {
  return (Object.keys(expected) as ContextProjectionContractKey[]).filter(
    (key) => actual[key] !== expected[key],
  );
}

/** Capabilities recorded in a version's contract. @internal */
function contractCapabilities(contract: Readonly<Record<string, string>>): ModelInputCapabilities {
  return {
    ...(contract.imageInput === "false" ? { imageInput: false } : {}),
    ...(contract.fileInput === "false" ? { fileInput: false } : {}),
  };
}

/** Render one active entry as a model message. @internal */
function renderEntry(entry: ContextEntryInput): ModelMessage {
  switch (entry.kind) {
    case "user":
    case "assistant":
    case "tool_result":
      return entry.message;
    case "runtime_context":
      return {
        role: "user",
        content: [
          {
            type: "text",
            text:
              typeof entry.payload === "string"
                ? entry.payload
                : canonicalContextJson(entry.payload),
          },
        ],
      };
  }
}

/**
 * Creates the default projection adapter for log mode.
 *
 * The adapter projects a path into AI SDK messages:
 *
 * - The version's core, when it is not empty, becomes the first message, a
 *   `system` message with exactly the core's bytes.
 * - Superseded entries and retractions are dropped (see `activeContextEntries`).
 * - `user`, `assistant` and `tool_result` entries are emitted exactly as stored.
 * - A `runtime_context` entry becomes a `user` message with one text part: a
 *   string payload as is, any other payload as canonical JSON (sorted keys).
 * - When the contract records `imageInput: "false"` or `fileInput: "false"`,
 *   tool-result media is replaced by the same text placeholders legacy mode
 *   uses. The decision follows the version's contract, not the live model
 *   settings, so a path always projects to the same messages.
 *
 * A host that renders runtime context or converts between providers
 * differently supplies its own adapter, with its own id and version.
 *
 * @returns The adapter, with id `agent-sdk/messages` and version `1`
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   model,
 *   systemPrompt: "You are a helpful assistant.",
 *   checkpointer,
 *   contextLog: { mode: "log", store, projection: createMessageProjectionAdapter() },
 * });
 * ```
 *
 * @experimental
 * @category Context Log
 */
export function createMessageProjectionAdapter(): ProjectionAdapter {
  return {
    id: MESSAGE_PROJECTION_ADAPTER_ID,
    version: MESSAGE_PROJECTION_ADAPTER_VERSION,
    project({ core, contract, entries }: ProjectionInput): ProjectedModelInput {
      const messages: ModelMessage[] = core === "" ? [] : [{ role: "system", content: core }];
      for (const entry of activeContextEntries(entries)) {
        messages.push(renderEntry(entry));
      }
      return { messages: projectMessagesForModel(messages, contractCapabilities(contract)) };
    },
  };
}
