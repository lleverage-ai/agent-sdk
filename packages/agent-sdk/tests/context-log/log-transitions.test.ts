/**
 * Log mode declares a new version by its cause, never by comparing request
 * content: `adapter_change` for a new version of the same projection
 * adapter, `core_policy_change` for another host core version
 * (`contextLog.coreVersion`), and `model_change` for another model, in that
 * precedence when several causes hold on one call.
 */

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import type { LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentOptions,
  CORE_VERSION_CONTRACT_KEY,
  ConfigurationError,
  type ContextAdmitInput,
  type ContextCoreInput,
  type ContextLogOptions,
  type ContextLogStore,
  type ContextStreamRef,
  type ContextTransition,
  type ContextVersion,
  createAgent,
  createMessageProjectionAdapter,
  createRetryHooks,
  MemoryContextLogStore,
  type ProjectionAdapter,
} from "../../src/index.js";

const THREAD = "thread-1";
const STREAM: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** A model that answers `<label>1`, `<label>2`, ..., failing the calls `fail` names. */
function createModel(
  options: { modelId?: string; label?: string; fail?: (call: number) => boolean } = {},
) {
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    modelId: options.modelId ?? "mock-model-id",
    doGenerate: async (request) => {
      requests.push(request);
      if (options.fail?.(requests.length)) {
        throw new Error("rate limit exceeded");
      }
      return {
        content: [{ type: "text", text: `${options.label ?? "A"}${requests.length}` }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

/** The default message adapter under a host id and version. */
function hostAdapter(version: string): ProjectionAdapter {
  const inner = createMessageProjectionAdapter();
  return { id: "host/adapter", version, project: (input) => inner.project(input) };
}

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  contextLog: Partial<ContextLogOptions> = {},
  overrides: Partial<AgentOptions> = {},
) {
  return createAgent({
    model,
    systemPrompt: "Core v1",
    ...overrides,
    contextLog: { mode: "log", store, ...contextLog },
  });
}

/** The head's version, then each ancestor back to the root. */
async function readLineage(store: ContextLogStore): Promise<ContextVersion[]> {
  const head = await store.readHead(STREAM);
  const lineage: ContextVersion[] = [];
  let versionId: string | null = head?.versionId ?? null;
  while (versionId !== null) {
    const version = await store.readVersion(versionId);
    lineage.push(version);
    versionId = version.parentVersionId;
  }
  return lineage;
}

/** An admit hook that records the transition each prepare declares. */
function recordingAdmit() {
  const transitions: Array<ContextTransition | undefined> = [];
  const admit = vi.fn((input: ContextAdmitInput) => {
    if (input.phase === "prepare") transitions.push(input.request.transition);
    return { allow: true as const };
  });
  return { admit, transitions };
}

const userMediaContract = (adapterVersion: string) => ({
  adapter: "host/adapter",
  adapterVersion,
  imageInput: "true",
  fileInput: "true",
  userMedia: "placeholder",
  supersession: "append",
});

describe("adapter_change", () => {
  it("declares an adapter_change for a new version of the same adapter, keeping the core", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(() => "Resolved core");
    const first = createModel();
    await logAgent(
      first.model,
      store,
      { projection: hostAdapter("1"), resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "hi", threadId: THREAD });
    const before = await store.readHead(STREAM);

    resolveCore.mockReturnValue("A newer resolved core");
    const { admit, transitions } = recordingAdmit();
    const second = createModel({ label: "B" });
    await logAgent(
      second.model,
      store,
      { projection: hostAdapter("2"), resolveCore, admit },
      { systemPrompt: undefined },
    ).generate({ prompt: "next", threadId: THREAD });

    // The resolver is not consulted: the adapter's version is the only cause.
    expect(resolveCore).toHaveBeenCalledTimes(1);
    expect(transitions).toEqual([
      {
        reason: "adapter_change",
        parent: { versionId: before!.versionId, inheritedCount: before!.entryCount },
        core: "Resolved core",
        contract: userMediaContract("2"),
      },
    ]);
    const [version, parent] = await readLineage(store);
    expect(version).toMatchObject({
      reason: "adapter_change",
      parentVersionId: parent!.id,
      inheritedCount: 2,
      core: "Resolved core",
      contract: userMediaContract("2"),
    });
    expect(second.requests[0]!.prompt).toEqual([
      ...first.requests[0]!.prompt,
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ]);
  });

  it("declares nothing again once the adapter_change is committed", async () => {
    const store = new MemoryContextLogStore();
    await logAgent(createModel().model, store, { projection: hostAdapter("1") }).generate({
      prompt: "hi",
      threadId: THREAD,
    });
    const { admit, transitions } = recordingAdmit();
    const agent = logAgent(createModel().model, store, { projection: hostAdapter("2"), admit });

    await agent.generate({ prompt: "second", threadId: THREAD });
    await agent.generate({ prompt: "third", threadId: THREAD });

    expect(transitions.map((transition) => transition?.reason)).toEqual([
      "adapter_change",
      undefined,
    ]);
    expect((await readLineage(store)).map((version) => version.reason)).toEqual([
      "adapter_change",
      "initial",
    ]);
  });

  it("does not count an adapter version change as a model change", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(({ reason }: ContextCoreInput) => `core for ${reason}`);
    await logAgent(
      createModel().model,
      store,
      { projection: hostAdapter("1"), resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "hi", threadId: THREAD });

    await logAgent(
      createModel().model,
      store,
      { projection: hostAdapter("2"), resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "next", threadId: THREAD });

    expect(resolveCore.mock.calls.map(([input]) => input.reason)).toEqual(["initial"]);
    const [version] = await readLineage(store);
    expect(version).toMatchObject({ reason: "adapter_change", core: "core for initial" });
  });
});

describe("core_policy_change", () => {
  it("records the host's core version on every version it creates", async () => {
    const store = new MemoryContextLogStore();
    await logAgent(createModel().model, store, { coreVersion: "1" }).generate({
      prompt: "hi",
      threadId: THREAD,
    });

    const [version] = await readLineage(store);
    expect(CORE_VERSION_CONTRACT_KEY).toBe("coreVersion");
    expect(version).toMatchObject({
      reason: "initial",
      contract: { [CORE_VERSION_CONTRACT_KEY]: "1" },
    });
  });

  it("adopts the static core of a new core version with a declared core_policy_change", async () => {
    const store = new MemoryContextLogStore();
    const first = createModel();
    await logAgent(first.model, store, { coreVersion: "1" }).generate({
      prompt: "hi",
      threadId: THREAD,
    });
    const before = await store.readHead(STREAM);
    const { admit, transitions } = recordingAdmit();
    const second = createModel({ label: "B" });
    const agent = logAgent(
      second.model,
      store,
      { coreVersion: "2", admit },
      { systemPrompt: "Core v2" },
    );

    await agent.generate({ prompt: "next", threadId: THREAD });
    await agent.generate({ prompt: "again", threadId: THREAD });

    expect(transitions).toEqual([
      {
        reason: "core_policy_change",
        parent: { versionId: before!.versionId, inheritedCount: before!.entryCount },
        core: "Core v2",
        contract: {
          adapter: "agent-sdk/messages",
          adapterVersion: "2",
          imageInput: "true",
          fileInput: "true",
          userMedia: "placeholder",
          supersession: "append",
          coreVersion: "2",
        },
      },
      undefined,
    ]);
    expect(second.requests[0]!.prompt).toEqual([
      { role: "system", content: "Core v2" },
      ...first.requests[0]!.prompt.slice(1),
      { role: "assistant", content: [{ type: "text", text: "A1" }] },
      { role: "user", content: [{ type: "text", text: "next" }] },
    ]);
    expect((await readLineage(store)).map((version) => version.reason)).toEqual([
      "core_policy_change",
      "initial",
    ]);
  });

  it("asks the resolver for the core of a core_policy_change", async () => {
    const store = new MemoryContextLogStore();
    const { model } = createModel();
    const resolveCore = vi.fn(({ reason }: ContextCoreInput) => `core for ${reason}`);
    await logAgent(
      model,
      store,
      { coreVersion: "1", resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "hi", threadId: THREAD });
    const before = await store.readHead(STREAM);

    await logAgent(
      model,
      store,
      { coreVersion: "2", resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "next", threadId: THREAD });

    expect(resolveCore.mock.calls.map(([input]) => input)).toEqual([
      expect.objectContaining({ reason: "initial" }),
      {
        stream: STREAM,
        reason: "core_policy_change",
        parent: { versionId: before!.versionId, inheritedCount: before!.entryCount },
        target: { provider: "mock-provider", modelId: "mock-model-id" },
        model,
      },
    ]);
    const [version] = await readLineage(store);
    expect(version).toMatchObject({
      reason: "core_policy_change",
      core: "core for core_policy_change",
      contract: { coreVersion: "2" },
    });
  });

  it("declares a core_policy_change for a head version that recorded no core version", async () => {
    const store = new MemoryContextLogStore();
    await logAgent(createModel().model, store).generate({ prompt: "hi", threadId: THREAD });

    await logAgent(createModel().model, store, { coreVersion: "1" }).generate({
      prompt: "next",
      threadId: THREAD,
    });

    const [version, parent] = await readLineage(store);
    expect(parent!.contract).not.toHaveProperty(CORE_VERSION_CONTRACT_KEY);
    expect(version).toMatchObject({ reason: "core_policy_change", contract: { coreVersion: "1" } });
  });

  it("records and declares nothing without a core version", async () => {
    const store = new MemoryContextLogStore();
    const { admit, transitions } = recordingAdmit();
    const first = createModel();
    await logAgent(first.model, store, { coreVersion: "1" }).generate({
      prompt: "hi",
      threadId: THREAD,
    });

    // A host without the option keeps the head's core, whatever it recorded.
    const second = createModel();
    await logAgent(second.model, store, { admit }, { systemPrompt: "Core v2" }).generate({
      prompt: "next",
      threadId: THREAD,
    });
    // A new stream records no core version.
    const other = new MemoryContextLogStore();
    await logAgent(createModel().model, other).generate({ prompt: "hi", threadId: THREAD });

    expect(transitions).toEqual([undefined]);
    expect(second.requests[0]!.prompt[0]).toEqual({ role: "system", content: "Core v1" });
    expect((await readLineage(store)).map((version) => version.reason)).toEqual(["initial"]);
    const [version] = await readLineage(other);
    expect(version!.contract).toEqual({
      adapter: "agent-sdk/messages",
      adapterVersion: "2",
      imageInput: "true",
      fileInput: "true",
      userMedia: "placeholder",
      supersession: "append",
    });
  });

  it("declares one core_policy_change across a retry after it was committed", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(({ reason }: ContextCoreInput) => `core for ${reason}`);
    await logAgent(
      createModel().model,
      store,
      { coreVersion: "1", resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "hi", threadId: THREAD });
    const { admit, transitions } = recordingAdmit();
    // The first attempt commits the transition, then the provider fails.
    const { model, requests } = createModel({ fail: (call) => call === 1 });

    await logAgent(
      model,
      store,
      { coreVersion: "2", resolveCore, admit },
      {
        systemPrompt: undefined,
        hooks: {
          PostGenerateFailure: [createRetryHooks({ maxRetries: 2, baseDelay: 1, jitter: false })],
        },
      },
    ).generate({ prompt: "next", threadId: THREAD });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
    expect(transitions.map((transition) => transition?.reason)).toEqual([
      "core_policy_change",
      undefined,
    ]);
    expect(resolveCore.mock.calls.map(([input]) => input.reason)).toEqual([
      "initial",
      "core_policy_change",
    ]);
    expect((await readLineage(store)).map((version) => version.reason)).toEqual([
      "core_policy_change",
      "initial",
    ]);
  });

  it("rejects an empty core version", () => {
    expect(() =>
      logAgent(createModel().model, new MemoryContextLogStore(), { coreVersion: "" }),
    ).toThrow(ConfigurationError);
  });
});

describe("transition precedence", () => {
  it("declares one core_policy_change when the core, model and adapter all changed", async () => {
    const store = new MemoryContextLogStore();
    await logAgent(createModel().model, store, {
      coreVersion: "1",
      projection: hostAdapter("1"),
    }).generate({ prompt: "hi", threadId: THREAD });
    const { admit, transitions } = recordingAdmit();
    const agent = logAgent(
      createModel({ modelId: "other-model" }).model,
      store,
      { coreVersion: "2", projection: hostAdapter("2"), admit },
      { systemPrompt: "Core v2", modelCapabilities: { imageInput: false } },
    );

    await agent.generate({ prompt: "next", threadId: THREAD });
    await agent.generate({ prompt: "again", threadId: THREAD });

    expect(transitions.map((transition) => transition?.reason)).toEqual([
      "core_policy_change",
      undefined,
    ]);
    const [version] = await readLineage(store);
    expect(version).toMatchObject({
      reason: "core_policy_change",
      core: "Core v2",
      contract: { ...userMediaContract("2"), imageInput: "false", coreVersion: "2" },
    });
  });

  it("declares a model_change over an adapter_change, recording the new contract", async () => {
    const store = new MemoryContextLogStore();
    const resolveCore = vi.fn(({ target }: ContextCoreInput) => `core for ${target.modelId}`);
    await logAgent(
      createModel().model,
      store,
      { coreVersion: "1", projection: hostAdapter("1"), resolveCore },
      { systemPrompt: undefined },
    ).generate({ prompt: "hi", threadId: THREAD });
    const { admit, transitions } = recordingAdmit();
    const agent = logAgent(
      createModel({ modelId: "other-model" }).model,
      store,
      { coreVersion: "1", projection: hostAdapter("2"), resolveCore, admit },
      { systemPrompt: undefined },
    );

    await agent.generate({ prompt: "next", threadId: THREAD });
    await agent.generate({ prompt: "again", threadId: THREAD });

    expect(transitions.map((transition) => transition?.reason)).toEqual([
      "model_change",
      undefined,
    ]);
    const [version] = await readLineage(store);
    expect(version).toMatchObject({
      reason: "model_change",
      core: "core for other-model",
      contract: { ...userMediaContract("2"), coreVersion: "1" },
    });
  });
});
