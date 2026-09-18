import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeWorkflowToolCall,
  DEFAULT_WORKFLOW_EXECUTION_GATE_TIMEOUT_MS,
  resolveWorkflowExecutionGate,
  type WorkflowExecutionGateOption,
  type WorkflowExecutionGateReceipt,
} from "../src/index.js";

const request = {
  toolName: "read",
  toolInput: { path: "private" },
  toolCallId: "call-1",
  sessionId: "thread-1",
  stage: "pre-hook" as const,
};

function gate(option: WorkflowExecutionGateOption) {
  const resolved = resolveWorkflowExecutionGate(option);
  if (!resolved) throw new Error("Test gate must be configured");
  return resolved;
}

afterEach(() => vi.useRealTimers());

describe("workflow authority lookup", () => {
  it("keeps an omitted gate absent and defaults a supplied gate to 10 seconds", () => {
    expect(resolveWorkflowExecutionGate(undefined)).toBeUndefined();
    expect(gate({ version: 1, authorize: () => ({ decision: "allow" }) }).timeoutMs).toBe(
      DEFAULT_WORKFLOW_EXECUTION_GATE_TIMEOUT_MS,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, "100"])(
    "rejects an invalid lookup deadline: %s",
    (timeoutMs) => {
      expect(() =>
        gate({
          version: 1,
          authorize: () => ({ decision: "allow" }),
          timeoutMs: timeoutMs as number,
        }),
      ).toThrow(/finite positive number/);
    },
  );

  it.each([null, false, "allow"])("rejects malformed configuration: %s", (option) => {
    expect(() =>
      resolveWorkflowExecutionGate(option as unknown as WorkflowExecutionGateOption),
    ).toThrow(/must be an object/);
  });

  it("rejects malformed denial reasons rather than trusting the decision", async () => {
    const configured = gate({
      version: 1,
      authorize: () => ({ decision: "deny", reason: 42 }) as unknown as { decision: "deny" },
    });
    await expect(authorizeWorkflowToolCall(configured, request)).rejects.toMatchObject({
      name: "WorkflowExecutionGateError",
      gateCode: "invalid",
      retryable: false,
    });
  });

  it.each(["allow", "deny"] as const)("receipt exceptions cannot alter %s", async (decision) => {
    const configured = gate({
      version: 1,
      authorize: () => ({ decision }),
      onDecision: () => {
        throw new Error("diagnostic sink failed");
      },
    });
    if (decision === "allow") {
      await expect(authorizeWorkflowToolCall(configured, request)).resolves.toBeUndefined();
    } else {
      await expect(authorizeWorkflowToolCall(configured, request)).rejects.toMatchObject({
        name: "ToolPermissionDeniedError",
      });
    }
  });

  it.each(["allow", "deny"] as const)(
    "contains an async receipt rejection after %s",
    async (decision) => {
      const onDecision = vi.fn(async () => {
        throw new Error("async diagnostic sink failed");
      });
      const configured = gate({ version: 1, authorize: () => ({ decision }), onDecision });
      if (decision === "allow") {
        await expect(authorizeWorkflowToolCall(configured, request)).resolves.toBeUndefined();
      } else {
        await expect(authorizeWorkflowToolCall(configured, request)).rejects.toMatchObject({
          name: "ToolPermissionDeniedError",
        });
      }
      expect(onDecision).toHaveBeenCalledTimes(1);
      // Give an unhandled rejection a turn to surface; Vitest fails the run if it does.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  );

  it("does not await a diagnostic sink that never settles", async () => {
    const configured = gate({
      version: 1,
      authorize: () => ({ decision: "allow" }),
      onDecision: () => new Promise<void>(() => {}),
    });
    await expect(authorizeWorkflowToolCall(configured, request)).resolves.toBeUndefined();
  });

  it("cleans deadline timers and source listeners on success", async () => {
    vi.useFakeTimers();
    const run = new AbortController();
    const call = new AbortController();
    const removeRun = vi.spyOn(run.signal, "removeEventListener");
    const removeCall = vi.spyOn(call.signal, "removeEventListener");
    const configured = gate({
      version: 1,
      signal: run.signal,
      authorize: () => ({ decision: "allow" }),
    });
    await authorizeWorkflowToolCall(configured, { ...request, signal: call.signal });
    expect(vi.getTimerCount()).toBe(0);
    expect(removeRun).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(removeCall).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("aborts on the per-call signal and observes a late authority rejection", async () => {
    vi.useFakeTimers();
    const call = new AbortController();
    const reason = new Error("call cancelled");
    const receipts: WorkflowExecutionGateReceipt[] = [];
    let rejectAuthority: (error: Error) => void = () => {
      throw new Error("not started");
    };
    let signal: AbortSignal | undefined;
    const configured = gate({
      version: 1,
      authorize: (input) => {
        signal = input.signal;
        return new Promise((_resolve, reject) => {
          rejectAuthority = reject;
        });
      },
      onDecision: (receipt) => {
        receipts.push(receipt);
      },
    });
    const pending = authorizeWorkflowToolCall(configured, { ...request, signal: call.signal });
    const assertion = expect(pending).rejects.toBe(reason);
    call.abort(reason);
    await assertion;
    rejectAuthority(new Error("late failure"));
    await Promise.resolve();
    expect(signal?.aborted).toBe(true);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.outcome).toBe("cancelled");
    expect(vi.getTimerCount()).toBe(0);
  });
});
