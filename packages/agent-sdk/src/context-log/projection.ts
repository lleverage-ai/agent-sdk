/**
 * The default projection adapter and the projection contract the log-mode
 * runtime records on versions.
 *
 * @packageDocumentation
 */

import type { ModelMessage } from "ai";
import { projectMessagesForModel, projectUserMediaForModel } from "../agent/model-capabilities.js";
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
 * Contract key recording that the version projects user image and file
 * parts its capabilities exclude as text placeholders. The runtime records
 * it on every version it creates; versions created before it existed lack
 * it and keep projecting user media as stored, so a version always projects
 * to the same bytes. It is not compared with the expected contract, so its
 * absence never requires a transition.
 *
 * @internal
 */
export const USER_MEDIA_CONTRACT_KEY = "userMedia";

/**
 * Contract key recording the host's core version
 * (`ContextLogOptions.coreVersion`) on every version the log-mode
 * runtime creates while the option is set.
 *
 * It is not a `ContextProjectionContractKey`: a version whose recorded
 * core version differs from the configured one is still projected, but the
 * next call declares a `core_policy_change` transition that adopts the
 * current core. Without `coreVersion` the key is never recorded or compared.
 *
 * @experimental
 * @category Context Log
 */
export const CORE_VERSION_CONTRACT_KEY = "coreVersion";

/**
 * The contract a new version records: the expected contract plus the
 * projection behaviours this runtime version applies, and the host's core
 * version when it declares one.
 *
 * @internal
 */
export function newVersionContract(
  expected: Record<ContextProjectionContractKey, string>,
  coreVersion?: string,
): Record<string, string> {
  return {
    ...expected,
    [USER_MEDIA_CONTRACT_KEY]: "placeholder",
    ...(coreVersion !== undefined && { [CORE_VERSION_CONTRACT_KEY]: coreVersion }),
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
 *   uses. On a version whose contract records `userMedia: "placeholder"`
 *   (every version the runtime creates from 1.0.0-rc.6), user image and
 *   file parts are replaced too (a file part with an image media type counts
 *   as an image); older versions project user parts as stored. The decision
 *   follows the version's contract, not the live model settings, so a path
 *   always projects to the same messages.
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
      const capabilities = contractCapabilities(contract);
      const projected = projectMessagesForModel(messages, capabilities);
      return {
        messages:
          contract[USER_MEDIA_CONTRACT_KEY] === "placeholder"
            ? projectUserMediaForModel(projected, capabilities)
            : projected,
      };
    },
  };
}
