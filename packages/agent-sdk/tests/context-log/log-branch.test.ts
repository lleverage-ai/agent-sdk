/**
 * A host declares that a new branch continues another branch's path with
 * `contextStream.branchFrom`: the branch's first prepare commits a `branch`
 * transition that inherits exactly that path (a fork, an edited message or a
 * regenerated reply), and later calls continue it.
 */

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { APICallError, type LanguageModel } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import {
  type AgentOptions,
  type ContextAdmitInput,
  type ContextLogStore,
  type ContextPathRef,
  type ContextStreamRef,
  createAgent,
  isContextLogError,
  MemoryContextLogStore,
  ValidationError,
} from "../../src/index.js";

const THREAD = "thread-1";
const MAIN: ContextStreamRef = { threadId: THREAD, branchId: "main", streamId: "main" };
const EDIT: ContextStreamRef = { threadId: THREAD, branchId: "edit", streamId: "main" };

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};

/** A model that answers `A1`, `A2`, ... and records every request. */
function createRecordingModel() {
  let calls = 0;
  const requests: LanguageModelV3CallOptions[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      requests.push(options);
      calls++;
      return {
        content: [{ type: "text", text: `A${calls}` }],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
  });
  return { model: model as LanguageModel, requests };
}

function logAgent(
  model: LanguageModel,
  store: ContextLogStore,
  contextLog: Partial<NonNullable<AgentOptions["contextLog"]>> = {},
) {
  return createAgent({
    model,
    systemPrompt: "You are the core.",
    contextLog: { mode: "log", store, ...contextLog },
  });
}

const text = (role: "user" | "assistant", value: string) => ({
  role,
  content: [{ type: "text", text: value }],
});

/** Main branch: first, A1, second, A2. Returns the store, model and head. */
async function seedMain() {
  const store = new MemoryContextLogStore();
  const recording = createRecordingModel();
  const agent = logAgent(recording.model, store);
  await agent.generate({ prompt: "first", threadId: THREAD });
  await agent.generate({ prompt: "second", threadId: THREAD });
  const head = (await store.readHead(MAIN))!;
  expect(head.entryCount).toBe(4);
  return { store, ...recording, head };
}

const refAt = (head: ContextPathRef, entryCount: number): ContextPathRef => ({
  stream: head.stream,
  versionId: head.versionId,
  entryCount,
});

describe("log-mode branch transitions", () => {
  it("edits a message on a new branch that inherits the unedited prefix", async () => {
    const { store, model, requests, head } = await seedMain();

    await logAgent(model, store).generate({
      prompt: "second, edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
    });

    expect(requests.at(-1)!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      text("user", "first"),
      text("assistant", "A1"),
      text("user", "second, edited"),
    ]);
    const branchHead = (await store.readHead(EDIT))!;
    const version = await store.readVersion(branchHead.versionId);
    expect(version).toMatchObject({
      stream: EDIT,
      reason: "branch",
      parentVersionId: head.versionId,
      inheritedCount: 2,
      core: "You are the core.",
    });
    expect(branchHead.entryCount).toBe(4);
    // The source branch is unchanged.
    expect(await store.readHead(MAIN)).toEqual(head);
  });

  it("continues the branch afterwards, with or without the declared source", async () => {
    const { store, model, requests, head } = await seedMain();
    const branchFrom = refAt(head, 2);
    const agent = logAgent(model, store);

    await agent.generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom },
    });
    // A later call of the same run (or a retry) still declares the source.
    await agent.generate({
      prompt: "again",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom },
    });
    await agent.generate({ prompt: "then", threadId: THREAD, contextStream: { branchId: "edit" } });

    expect(requests.at(-1)!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      text("user", "first"),
      text("assistant", "A1"),
      text("user", "edited"),
      text("assistant", "A3"),
      text("user", "again"),
      text("assistant", "A4"),
      text("user", "then"),
    ]);
    // Only the first call on the branch started a version.
    const branchHead = (await store.readHead(EDIT))!;
    expect(await store.readVersion(branchHead.versionId)).toMatchObject({
      reason: "branch",
      parentVersionId: head.versionId,
    });
    expect(await store.readHead(MAIN)).toEqual(head);
  });

  it("retries the branch's first call on the committed branch without a second transition", async () => {
    const { store, head } = await seedMain();
    const requests: LanguageModelV3CallOptions[] = [];
    let failed = false;
    const model = new MockLanguageModelV3({
      doGenerate: async (options) => {
        requests.push(options);
        if (!failed) {
          failed = true;
          throw new APICallError({
            message: "overloaded",
            url: "https://provider.test",
            requestBodyValues: {},
            statusCode: 529,
            isRetryable: true,
          });
        }
        return {
          content: [{ type: "text", text: "edited reply" }],
          finishReason: { unified: "stop", raw: "stop" },
          usage,
          warnings: [],
        };
      },
    });

    await logAgent(model as LanguageModel, store).generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
    });

    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.prompt)).toBe(JSON.stringify(requests[0]!.prompt));
    const branchHead = (await store.readHead(EDIT))!;
    const path = (await store.readPath(branchHead)).entries;
    // The inherited prefix, the edited input once, the reply.
    expect(path.map((entry) => entry.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(await store.readVersion(branchHead.versionId)).toMatchObject({
      reason: "branch",
      inheritedCount: 2,
    });
  });

  it("regenerates a reply on a new branch without new input", async () => {
    const { store, model, requests, head } = await seedMain();

    const result = await logAgent(model, store).generate({
      threadId: THREAD,
      contextStream: { branchId: "regen", branchFrom: refAt(head, 3) },
    });

    expect(result.text).toBe("A3");
    expect(requests.at(-1)!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      text("user", "first"),
      text("assistant", "A1"),
      text("user", "second"),
    ]);
    const regen = (await store.readHead({ ...MAIN, branchId: "regen" }))!;
    expect(regen.entryCount).toBe(4);
    expect(await store.readVersion(regen.versionId)).toMatchObject({
      reason: "branch",
      parentVersionId: head.versionId,
      inheritedCount: 3,
    });
  });

  it("forks a forked branch, inheriting through both versions", async () => {
    const { store, model, requests, head } = await seedMain();
    const agent = logAgent(model, store);
    await agent.generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
    });
    const edit = (await store.readHead(EDIT))!;

    await agent.generate({
      prompt: "fork of the edit",
      threadId: THREAD,
      contextStream: { branchId: "fork", branchFrom: edit },
    });

    expect(requests.at(-1)!.prompt).toEqual([
      { role: "system", content: "You are the core." },
      text("user", "first"),
      text("assistant", "A1"),
      text("user", "edited"),
      text("assistant", "A3"),
      text("user", "fork of the edit"),
    ]);
  });

  it("declares the transition to the admit hook and the core resolver", async () => {
    const { store, model, head } = await seedMain();
    const admitted: ContextAdmitInput[] = [];
    const resolveCore = vi.fn(() => "Branch core");

    await createAgent({
      model,
      contextLog: {
        mode: "log",
        store,
        resolveCore,
        admit: (input) => {
          admitted.push(input);
          return { allow: true };
        },
      },
    }).generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
    });

    const parent = { versionId: head.versionId, inheritedCount: 2 };
    expect(resolveCore).toHaveBeenCalledTimes(1);
    expect(resolveCore.mock.calls[0]![0]).toMatchObject({ stream: EDIT, reason: "branch", parent });
    const prepare = admitted.find((input) => input.phase === "prepare");
    expect(prepare?.phase === "prepare" && prepare.request.transition).toMatchObject({
      reason: "branch",
      parent,
      core: "Branch core",
    });
  });

  it("refuses a branch whose head does not continue the declared source", async () => {
    const { store, model, requests, head } = await seedMain();
    const agent = logAgent(model, store);
    // The branch already started from another point.
    await agent.generate({
      prompt: "edited",
      threadId: THREAD,
      contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
    });
    const before = (await store.readHead(EDIT))!;
    const calls = requests.length;

    const error = await agent
      .generate({
        prompt: "elsewhere",
        threadId: THREAD,
        contextStream: { branchId: "edit", branchFrom: refAt(head, 0) },
      })
      .catch((caught: unknown) => caught);

    expect(isContextLogError(error) && error.reason).toBe("branch_source_mismatch");
    expect(requests.length).toBe(calls);
    expect(await store.readHead(EDIT)).toEqual(before);
  });

  it("refuses a declared source on a branch that started as a root", async () => {
    const { store, model, requests, head } = await seedMain();
    const agent = logAgent(model, store);
    await agent.generate({ prompt: "root", threadId: THREAD, contextStream: { branchId: "edit" } });
    const calls = requests.length;

    const error = await agent
      .generate({
        prompt: "edited",
        threadId: THREAD,
        contextStream: { branchId: "edit", branchFrom: refAt(head, 2) },
      })
      .catch((caught: unknown) => caught);

    expect(isContextLogError(error) && error.reason).toBe("branch_source_mismatch");
    expect(requests.length).toBe(calls);
  });

  it.each([
    ["the same branch", (head: ContextPathRef) => ({ branchId: "main", branchFrom: head })],
    [
      "another thread",
      (head: ContextPathRef) => ({
        branchId: "edit",
        branchFrom: { ...head, stream: { ...head.stream, threadId: "other" } },
      }),
    ],
    [
      "another stream id",
      (head: ContextPathRef) => ({
        branchId: "edit",
        branchFrom: { ...head, stream: { ...head.stream, streamId: "child" } },
      }),
    ],
    [
      "a negative entry count",
      (head: ContextPathRef) => ({ branchId: "edit", branchFrom: { ...head, entryCount: -1 } }),
    ],
  ])("rejects a source on %s before anything is committed", async (_name, build) => {
    const { store, model, requests, head } = await seedMain();
    const calls = requests.length;

    await expect(
      logAgent(model, store).generate({
        prompt: "edited",
        threadId: THREAD,
        contextStream: build(head),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(requests.length).toBe(calls);
    expect(await store.readHead(EDIT)).toBeNull();
    expect(await store.readHead(MAIN)).toEqual(head);
  });

  it("refuses a source beyond its version's path without committing", async () => {
    const { store, model, requests, head } = await seedMain();
    const calls = requests.length;

    const error = await logAgent(model, store)
      .generate({
        prompt: "edited",
        threadId: THREAD,
        contextStream: { branchId: "edit", branchFrom: refAt(head, 9) },
      })
      .catch((caught: unknown) => caught);

    expect(isContextLogError(error)).toBe(true);
    expect(requests.length).toBe(calls);
    expect(await store.readHead(EDIT)).toBeNull();
  });

  it("rejects contextStream.branchFrom outside log mode", async () => {
    const { model } = createRecordingModel();
    const { head } = await seedMain();
    await expect(
      createAgent({ model, systemPrompt: "core" }).generate({
        prompt: "x",
        threadId: THREAD,
        contextStream: { branchId: "edit", branchFrom: head },
      }),
    ).rejects.toThrow(/contextStream only applies in context log mode/);
  });
});
