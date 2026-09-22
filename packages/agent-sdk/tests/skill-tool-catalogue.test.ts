import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV3 } from "ai/test";
import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";
import { createSkillTool, SkillRegistry } from "../src/tools/skills.js";
import type { LanguageModel } from "../src/types.js";

// M02: the `skill` tool's model-facing definition. Default "snapshot" keeps
// the description and input schema byte-identical across the steps of a run
// (a loaded skill does not rewrite the tool block the model sees, so provider
// prompt caches keyed on tools stay warm). "live" opts into per-request
// re-evaluation.

const usage = {
  inputTokens: 1,
  outputTokens: 1,
  totalTokens: 2,
  inputTokenDetails: { noCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  outputTokenDetails: { reasoningTokens: 0 },
};

interface SeenDefinition {
  step: number;
  description: string | undefined;
  schema: unknown;
}

/**
 * Runs one generation where step 1 loads `git` via the skill tool and step 2
 * replies with text; records the `skill` tool definition the model was sent
 * on each step.
 */
async function runTwoStepSkillLoad(skillTool?: ReturnType<typeof createSkillTool>) {
  const seen: SeenDefinition[] = [];
  let step = 0;
  const model = new MockLanguageModelV3({
    doStream: async ({ tools }) => {
      step++;
      const def = (tools ?? []).find((t) => t.name === "skill") as
        | { description?: string; inputSchema?: unknown }
        | undefined;
      seen.push({ step, description: def?.description, schema: def?.inputSchema });
      const first = step === 1;
      const parts: LanguageModelV3StreamPart[] = first
        ? [
            {
              type: "tool-call",
              toolCallId: "c1",
              toolName: "skill",
              input: '{"skill_name":"git"}',
            },
          ]
        : [
            { type: "text-start", id: "a" },
            { type: "text-delta", id: "a", delta: "ok" },
            { type: "text-end", id: "a" },
          ];
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "stream-start", warnings: [] });
            for (const part of parts) controller.enqueue(part);
            controller.enqueue({
              type: "finish",
              finishReason: { unified: first ? "tool-calls" : "stop", raw: "x" },
              usage,
            });
            controller.close();
          },
        }),
      };
    },
  });

  const skills = [
    { name: "git", description: "Git ops", instructions: "Use git." },
    { name: "docker", description: "Docker ops", instructions: "Use docker." },
  ];
  const agent = skillTool
    ? createAgent({
        model: model as unknown as LanguageModel,
        tools: { skill: skillTool },
      })
    : createAgent({ model: model as unknown as LanguageModel, skills });

  const outputs: unknown[] = [];
  for await (const part of agent.stream({ prompt: "go" })) {
    if (part.type === "tool-result") outputs.push(part.output);
  }
  return { seen, outputs };
}

describe("skill tool catalogue mode", () => {
  it("snapshot (default): the model sees the same skill tool definition on every step", async () => {
    const { seen, outputs } = await runTwoStepSkillLoad();

    expect(seen).toHaveLength(2);
    expect(seen[0]!.description).toContain("- git: Git ops");
    expect(seen[0]!.description).toContain("- docker: Docker ops");
    // git loaded on step 1; the definition sent on step 2 is unchanged.
    expect(seen[1]!.description).toBe(seen[0]!.description);
    expect(seen[1]!.schema).toEqual(seen[0]!.schema);
    expect(Object.keys((seen[0]!.schema as { properties: object }).properties)).toEqual([
      "skill_name",
    ]);
    // The load itself still happened against the live registry.
    expect(outputs[0]).toMatchObject({ success: true, skill: "git" });
  });

  it("live: the definition sent on the next step drops the loaded skill", async () => {
    const registry = new SkillRegistry({
      skills: [
        { name: "git", description: "Git ops", instructions: "Use git." },
        { name: "docker", description: "Docker ops", instructions: "Use docker." },
      ],
    });
    const { seen, outputs } = await runTwoStepSkillLoad(
      createSkillTool({ registry, catalogue: "live" }),
    );

    expect(seen).toHaveLength(2);
    expect(seen[0]!.description).toContain("- git: Git ops");
    expect(seen[1]!.description).not.toContain("- git:");
    expect(seen[1]!.description).toContain("- docker: Docker ops");
    expect(outputs[0]).toMatchObject({ success: true, skill: "git" });
  });

  it("snapshot: execute consults the live registry, not the captured catalogue", async () => {
    const registry = new SkillRegistry({
      skills: [{ name: "git", description: "Git ops", instructions: "Use git." }],
    });
    const skillTool = createSkillTool({ registry });
    // Registered after creation: absent from the snapshot description...
    registry.register({ name: "docker", description: "Docker ops", instructions: "Use docker." });
    expect(skillTool.description).not.toContain("docker");

    // ...but loadable, because execute() goes through the registry.
    const result = (await skillTool.execute?.(
      { skill_name: "docker" },
      { toolCallId: "c", messages: [] },
    )) as { success: boolean; instructions?: string };
    expect(result).toMatchObject({ success: true, instructions: "Use docker." });
    expect(registry.listLoaded()).toContain("docker");
  });

  it("snapshot: description and schema are plain values, usable without resolving", () => {
    const registry = new SkillRegistry({
      skills: [{ name: "git", description: "Git ops", instructions: "Use git." }],
    });
    const skillTool = createSkillTool({ registry });

    expect(typeof skillTool.description).toBe("string");
    expect(skillTool.description).toContain("- git: Git ops");
    expect(typeof skillTool.inputSchema).not.toBe("function");
    const shape = (skillTool.inputSchema as { shape?: Record<string, unknown> }).shape;
    expect(Object.keys(shape ?? {})).toEqual(["skill_name"]);
  });
});
