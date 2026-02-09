/**
 * Tests for team hooks (createTeamHooks and fireTeamHook).
 */

import { describe, it, expect } from "vitest";
import type { HookRegistration } from "@lleverage-ai/agent-sdk";

import { createTeamHooks, type TeamHooksOptions } from "../src/hooks/team-hooks.js";
import { fireTeamHook } from "../src/hooks/invoke.js";

describe("createTeamHooks", () => {
  it("creates empty registration when no callbacks", () => {
    const hooks = createTeamHooks({});
    expect(hooks).toEqual({});
  });

  it("registers all 12 hook events when all callbacks provided", () => {
    const callback = async () => undefined;
    const options: TeamHooksOptions = {
      onMessageReceived: callback,
      onTaskAssigned: callback,
      onTaskCompleted: callback,
      onTaskCreated: callback,
      onTaskFailed: callback,
      onTeammateSpawned: callback,
      onTeammateCrashed: callback,
      onShutdownRequested: callback,
      onShutdownComplete: callback,
      onPlanSubmitted: callback,
      onPlanApproved: callback,
      onPlanRejected: callback,
    };

    const hooks = createTeamHooks(options);

    expect(hooks.TeamMessageReceived).toHaveLength(1);
    expect(hooks.TeamTaskAssigned).toHaveLength(1);
    expect(hooks.TeamTaskCompleted).toHaveLength(1);
    expect(hooks.TeamTaskCreated).toHaveLength(1);
    expect(hooks.TeamTaskFailed).toHaveLength(1);
    expect(hooks.TeamTeammateSpawned).toHaveLength(1);
    expect(hooks.TeamTeammateCrashed).toHaveLength(1);
    expect(hooks.TeamShutdownRequested).toHaveLength(1);
    expect(hooks.TeamShutdownComplete).toHaveLength(1);
    expect(hooks.TeamPlanSubmitted).toHaveLength(1);
    expect(hooks.TeamPlanApproved).toHaveLength(1);
    expect(hooks.TeamPlanRejected).toHaveLength(1);
  });

  it("only registers provided callbacks", () => {
    const callback = async () => undefined;
    const hooks = createTeamHooks({
      onTaskCreated: callback,
      onTaskFailed: callback,
    });

    expect(hooks.TeamTaskCreated).toHaveLength(1);
    expect(hooks.TeamTaskFailed).toHaveLength(1);
    expect(hooks.TeamMessageReceived).toBeUndefined();
    expect(hooks.TeamTaskAssigned).toBeUndefined();
    expect(hooks.TeamTaskCompleted).toBeUndefined();
  });

  it("returns proper HookRegistration structure", () => {
    const callback = async () => undefined;
    const hooks = createTeamHooks({ onTaskCreated: callback });

    // The callback in the array should be the same function
    expect(hooks.TeamTaskCreated![0]).toBe(callback);
  });
});

describe("fireTeamHook", () => {
  it("does nothing when hooks is undefined", async () => {
    // Should not throw
    await fireTeamHook(undefined, "TeamTaskCreated", { taskId: "123" });
  });

  it("does nothing when no callbacks registered for event", async () => {
    const hooks: HookRegistration = {};
    await fireTeamHook(hooks, "TeamTaskCreated", { taskId: "123" });
  });

  it("invokes registered callbacks with correct input", async () => {
    const receivedInputs: unknown[] = [];
    const hooks: HookRegistration = {
      TeamTaskCreated: [
        async (input) => {
          receivedInputs.push(input);
          return undefined;
        },
      ],
    };

    await fireTeamHook(hooks, "TeamTaskCreated", {
      taskId: "abc-123",
      taskTitle: "Test Task",
    }, "session-1");

    expect(receivedInputs).toHaveLength(1);
    const input = receivedInputs[0] as Record<string, unknown>;
    expect(input.hook_event_name).toBe("TeamTaskCreated");
    expect(input.session_id).toBe("session-1");
    expect(input.taskId).toBe("abc-123");
    expect(input.taskTitle).toBe("Test Task");
  });

  it("invokes multiple callbacks for the same event", async () => {
    const calls: number[] = [];
    const hooks: HookRegistration = {
      TeamTaskCompleted: [
        async () => { calls.push(1); return undefined; },
        async () => { calls.push(2); return undefined; },
      ],
    };

    await fireTeamHook(hooks, "TeamTaskCompleted", { taskId: "123" });
    expect(calls).toEqual([1, 2]);
  });

  it("continues on callback error", async () => {
    const calls: number[] = [];
    const hooks: HookRegistration = {
      TeamTaskFailed: [
        async () => { throw new Error("boom"); },
        async () => { calls.push(2); return undefined; },
      ],
    };

    // Should not throw
    await fireTeamHook(hooks, "TeamTaskFailed", { taskId: "123" });
    expect(calls).toEqual([2]);
  });

  it("uses empty session_id when not provided", async () => {
    let receivedSessionId = "not-set";
    const hooks: HookRegistration = {
      TeamShutdownComplete: [
        async (input) => {
          receivedSessionId = (input as Record<string, unknown>).session_id as string;
          return undefined;
        },
      ],
    };

    await fireTeamHook(hooks, "TeamShutdownComplete", {});
    expect(receivedSessionId).toBe("");
  });
});
