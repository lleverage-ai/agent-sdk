/**
 * Recorded response playback system for testing.
 *
 * Allows recording agent interactions and replaying them deterministically
 * for testing and development purposes.
 *
 * @packageDocumentation
 */

import type { LanguageModelUsage, ModelMessage } from "ai";
import type {
  Agent,
  FinishReason,
  GenerateOptions,
  GenerateResult,
  GenerateResultComplete,
  StreamPart,
} from "../types.js";
import { createMockAgent, type MockAgent, type MockResponse } from "./mock-agent.js";

// =============================================================================
// Recording Types
// =============================================================================

/**
 * A single recorded interaction.
 *
 * @category Testing
 */
export interface RecordedInteraction {
  /** Timestamp when the interaction was recorded */
  timestamp: string;

  /** The request options */
  request: {
    prompt?: string;
    messages?: ModelMessage[];
    threadId?: string;
    maxTokens?: number;
    temperature?: number;
  };

  /** The response */
  response: {
    text: string;
    finishReason: FinishReason;
    usage?: LanguageModelUsage;
    output?: unknown;
    steps?: GenerateResultComplete["steps"];
  };

  /** Method used (generate or stream) */
  method: "generate" | "stream";

  /** Duration in milliseconds */
  duration?: number;

  /** Any error that occurred */
  error?: {
    message: string;
    name: string;
    stack?: string;
  };
}

/**
 * A recording session containing multiple interactions.
 *
 * @category Testing
 */
export interface Recording {
  /** Version of the recording format */
  version: string;

  /** When the recording was created */
  createdAt: string;

  /** Optional description of the recording */
  description?: string;

  /** Optional tags for categorization */
  tags?: string[];

  /** The recorded interactions in order */
  interactions: RecordedInteraction[];

  /** Metadata about the recording session */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// Recording Agent
// =============================================================================

/**
 * An agent that records all interactions.
 *
 * @category Testing
 */
export interface RecordingAgent extends Agent {
  /** Get all recorded interactions */
  getRecording(): Recording;

  /** Clear all recorded interactions */
  clearRecording(): void;

  /** Export recording to JSON */
  exportRecording(): string;

  /** The underlying agent being recorded */
  readonly wrappedAgent: Agent;
}

/**
 * Options for creating a recording agent.
 *
 * @category Testing
 */
export interface RecordingAgentOptions {
  /** Description for the recording */
  description?: string;

  /** Tags for the recording */
  tags?: string[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Wraps an agent to record all interactions.
 *
 * Use this to capture real agent interactions that can later be replayed
 * for testing. This is useful for creating deterministic test fixtures
 * from actual API calls.
 *
 * @param agent - The agent to wrap and record
 * @param options - Recording options
 * @returns A recording agent that captures all interactions
 *
 * @example
 * ```typescript
 * import { createRecordingAgent } from "@lleverage-ai/agent-sdk/testing";
 *
 * // Wrap a real agent
 * const recordingAgent = createRecordingAgent(realAgent, {
 *   description: "User authentication flow",
 * });
 *
 * // Make some real calls
 * await recordingAgent.generate({ prompt: "Hello" });
 * await recordingAgent.generate({ prompt: "How are you?" });
 *
 * // Export the recording
 * const json = recordingAgent.exportRecording();
 * fs.writeFileSync("auth-flow.json", json);
 * ```
 *
 * @category Testing
 */
export function createRecordingAgent(
  agent: Agent,
  options: RecordingAgentOptions = {},
): RecordingAgent {
  const interactions: RecordedInteraction[] = [];
  const createdAt = new Date().toISOString();

  function getRecording(): Recording {
    return {
      version: "1.0.0",
      createdAt,
      description: options.description,
      tags: options.tags,
      interactions: [...interactions],
      metadata: options.metadata,
    };
  }

  function clearRecording(): void {
    interactions.length = 0;
  }

  function exportRecording(): string {
    return JSON.stringify(getRecording(), null, 2);
  }

  return {
    id: agent.id,
    options: agent.options,
    backend: agent.backend,
    state: agent.state,
    wrappedAgent: agent,

    getSkills() {
      return agent.getSkills();
    },

    async generate(genOptions: GenerateOptions): Promise<GenerateResult> {
      const startTime = Date.now();
      const timestamp = new Date().toISOString();

      try {
        const result = await agent.generate(genOptions);

        // Only record complete results
        if (result.status === "complete") {
          interactions.push({
            timestamp,
            request: {
              prompt: genOptions.prompt,
              messages: genOptions.messages,
              threadId: genOptions.threadId,
              maxTokens: genOptions.maxTokens,
              temperature: genOptions.temperature,
            },
            response: {
              text: result.text,
              finishReason: result.finishReason,
              usage: result.usage,
              output: result.output,
              steps: result.steps,
            },
            method: "generate",
            duration: Date.now() - startTime,
          });
        }

        return result;
      } catch (error) {
        const err = error as Error;
        interactions.push({
          timestamp,
          request: {
            prompt: genOptions.prompt,
            messages: genOptions.messages,
            threadId: genOptions.threadId,
            maxTokens: genOptions.maxTokens,
            temperature: genOptions.temperature,
          },
          response: {
            text: "",
            finishReason: "error",
          },
          method: "generate",
          duration: Date.now() - startTime,
          error: {
            message: err.message,
            name: err.name,
            stack: err.stack,
          },
        });
        throw error;
      }
    },

    async *stream(genOptions: GenerateOptions): AsyncGenerator<StreamPart> {
      const startTime = Date.now();
      const timestamp = new Date().toISOString();
      const chunks: StreamPart[] = [];
      let finalText = "";
      let finishReason: FinishReason = "stop";
      let usage: LanguageModelUsage | undefined;

      try {
        for await (const chunk of agent.stream(genOptions)) {
          chunks.push(chunk);
          if (chunk.type === "text-delta") {
            finalText += chunk.text;
          } else if (chunk.type === "finish") {
            finishReason = chunk.finishReason;
            usage = chunk.usage;
          }
          yield chunk;
        }

        interactions.push({
          timestamp,
          request: {
            prompt: genOptions.prompt,
            messages: genOptions.messages,
            threadId: genOptions.threadId,
            maxTokens: genOptions.maxTokens,
            temperature: genOptions.temperature,
          },
          response: {
            text: finalText,
            finishReason,
            usage,
          },
          method: "stream",
          duration: Date.now() - startTime,
        });
      } catch (error) {
        const err = error as Error;
        interactions.push({
          timestamp,
          request: {
            prompt: genOptions.prompt,
            messages: genOptions.messages,
            threadId: genOptions.threadId,
            maxTokens: genOptions.maxTokens,
            temperature: genOptions.temperature,
          },
          response: {
            text: finalText,
            finishReason: "error",
          },
          method: "stream",
          duration: Date.now() - startTime,
          error: {
            message: err.message,
            name: err.name,
            stack: err.stack,
          },
        });
        throw error;
      }
    },

    async streamResponse(genOptions: GenerateOptions): Promise<Response> {
      // Recording streamResponse is complex due to Response streaming
      // Just pass through to the wrapped agent
      return agent.streamResponse(genOptions);
    },

    async streamDataResponse(genOptions: GenerateOptions): Promise<Response> {
      // Recording streamDataResponse is complex due to Response streaming
      // Just pass through to the wrapped agent
      return agent.streamDataResponse(genOptions);
    },

    async streamRaw(genOptions: GenerateOptions) {
      // Recording streamRaw is complex due to the raw stream
      // Just pass through to the wrapped agent
      return agent.streamRaw(genOptions);
    },

    getRecording,
    clearRecording,
    exportRecording,

    getActiveTools() {
      return agent.getActiveTools();
    },

    loadTools(toolNames: string[]) {
      return agent.loadTools(toolNames);
    },

    setPermissionMode(mode) {
      agent.setPermissionMode(mode);
    },

    async getInterrupt(threadId: string) {
      return agent.getInterrupt(threadId);
    },

    async resume(
      threadId: string,
      interruptId: string,
      response: unknown,
      genOptions?: Partial<GenerateOptions>,
    ) {
      return agent.resume(threadId, interruptId, response, genOptions);
    },

    // Delegate to wrapped agent's ready promise
    get ready() {
      return agent.ready;
    },

    // Delegate to wrapped agent's task manager
    get taskManager() {
      return agent.taskManager;
    },

    // Delegate to wrapped agent's dispose
    async dispose() {
      return agent.dispose();
    },
  };
}

// =============================================================================
// Playback Agent
// =============================================================================

/**
 * Options for creating a playback agent.
 *
 * @category Testing
 */
export interface PlaybackAgentOptions {
  /** The recording to play back */
  recording: Recording;

  /** How to match requests to recordings */
  matchMode?: "sequence" | "prompt" | "fuzzy";

  /** Throw error if no matching recording found */
  strict?: boolean;

  /** Delay multiplier for simulating timing (0 = instant, 1 = real timing) */
  timingMultiplier?: number;
}

/**
 * An agent that plays back recorded interactions.
 *
 * @category Testing
 */
export interface PlaybackAgent extends MockAgent {
  /** Get the current playback position */
  getPlaybackPosition(): number;

  /** Reset playback to the beginning */
  resetPlayback(): void;

  /** Get remaining interactions count */
  getRemainingCount(): number;

  /** Check if playback is complete */
  isComplete(): boolean;
}

/**
 * Creates an agent that plays back recorded interactions.
 *
 * Use this to replay previously recorded agent interactions for
 * deterministic testing. This is useful for regression tests and
 * testing code that depends on agent behavior.
 *
 * @param options - Playback configuration
 * @returns A playback agent
 *
 * @example
 * ```typescript
 * import { createPlaybackAgent, parseRecording } from "@lleverage-ai/agent-sdk/testing";
 * import recordingJson from "./fixtures/auth-flow.json";
 *
 * const agent = createPlaybackAgent({
 *   recording: parseRecording(recordingJson),
 *   matchMode: "sequence",
 * });
 *
 * // Calls will return recorded responses in order
 * const r1 = await agent.generate({ prompt: "Hello" });
 * const r2 = await agent.generate({ prompt: "How are you?" });
 *
 * expect(agent.isComplete()).toBe(true);
 * ```
 *
 * @example
 * ```typescript
 * // Match by prompt content
 * const agent = createPlaybackAgent({
 *   recording,
 *   matchMode: "prompt",
 * });
 *
 * // Order doesn't matter - matches by prompt text
 * await agent.generate({ prompt: "How are you?" }); // Matches second recording
 * await agent.generate({ prompt: "Hello" }); // Matches first recording
 * ```
 *
 * @category Testing
 */
export function createPlaybackAgent(options: PlaybackAgentOptions): PlaybackAgent {
  const { recording, matchMode = "sequence", strict = true, timingMultiplier = 0 } = options;

  let playbackPosition = 0;
  const usedIndices = new Set<number>();

  /**
   * Find matching interaction for a request.
   */
  function findMatchingInteraction(genOptions: GenerateOptions): RecordedInteraction | undefined {
    switch (matchMode) {
      case "sequence": {
        // Return interactions in order
        if (playbackPosition >= recording.interactions.length) {
          return undefined;
        }
        return recording.interactions[playbackPosition++];
      }

      case "prompt": {
        // Match by exact prompt
        const prompt = genOptions.prompt ?? "";
        for (let i = 0; i < recording.interactions.length; i++) {
          const interaction = recording.interactions[i];
          if (interaction && !usedIndices.has(i) && interaction.request.prompt === prompt) {
            usedIndices.add(i);
            playbackPosition = Math.max(playbackPosition, i + 1);
            return interaction;
          }
        }
        return undefined;
      }

      case "fuzzy": {
        // Match by similar prompt (contains)
        const prompt = (genOptions.prompt ?? "").toLowerCase();
        for (let i = 0; i < recording.interactions.length; i++) {
          const interaction = recording.interactions[i];
          if (!interaction) continue;
          const recordedPrompt = (interaction.request.prompt ?? "").toLowerCase();
          if (
            !usedIndices.has(i) &&
            (recordedPrompt.includes(prompt) || prompt.includes(recordedPrompt))
          ) {
            usedIndices.add(i);
            playbackPosition = Math.max(playbackPosition, i + 1);
            return interaction;
          }
        }
        return undefined;
      }
    }
  }

  /**
   * Convert interaction to mock response.
   */
  function interactionToResponse(interaction: RecordedInteraction): MockResponse {
    if (interaction.error) {
      return {
        text: "",
        error: new Error(interaction.error.message),
      };
    }

    return {
      text: interaction.response.text,
      finishReason: interaction.response.finishReason,
      usage: interaction.response.usage,
      output: interaction.response.output,
      steps: interaction.response.steps,
      delay: timingMultiplier > 0 ? (interaction.duration ?? 0) * timingMultiplier : 0,
    };
  }

  // Create base mock agent with dynamic handler
  const mockAgent = createMockAgent({
    responseHandler: (genOptions) => {
      const interaction = findMatchingInteraction(genOptions);

      if (!interaction) {
        if (strict) {
          throw new Error(
            `No matching recording found for request: ${JSON.stringify({
              prompt: genOptions.prompt,
              threadId: genOptions.threadId,
            })}`,
          );
        }
        return { text: "No recording found", finishReason: "stop" };
      }

      return interactionToResponse(interaction);
    },
  });

  // Extend with playback-specific methods
  const playbackAgent: PlaybackAgent = {
    ...mockAgent,

    getPlaybackPosition(): number {
      return playbackPosition;
    },

    resetPlayback(): void {
      playbackPosition = 0;
      usedIndices.clear();
      mockAgent.resetHistory();
    },

    getRemainingCount(): number {
      return recording.interactions.length - playbackPosition;
    },

    isComplete(): boolean {
      return playbackPosition >= recording.interactions.length;
    },
  };

  return playbackAgent;
}

// =============================================================================
// Recording Utilities
// =============================================================================

/**
 * Parse a recording from JSON.
 *
 * @param json - JSON string or object
 * @returns Parsed recording
 *
 * @example
 * ```typescript
 * const recording = parseRecording(fs.readFileSync("recording.json", "utf-8"));
 * ```
 *
 * @category Testing
 */
export function parseRecording(json: string | object): Recording {
  const data = typeof json === "string" ? JSON.parse(json) : json;

  // Validate required fields
  if (!data.version || !data.createdAt || !Array.isArray(data.interactions)) {
    throw new Error("Invalid recording format: missing required fields");
  }

  return data as Recording;
}

/**
 * Merge multiple recordings into one.
 *
 * @param recordings - Recordings to merge
 * @param options - Merge options
 * @returns Merged recording
 *
 * @example
 * ```typescript
 * const merged = mergeRecordings([recording1, recording2], {
 *   description: "Combined test fixtures",
 * });
 * ```
 *
 * @category Testing
 */
export function mergeRecordings(
  recordings: Recording[],
  options?: { description?: string; tags?: string[] },
): Recording {
  const allInteractions: RecordedInteraction[] = [];
  const allTags = new Set<string>();

  for (const recording of recordings) {
    allInteractions.push(...recording.interactions);
    if (recording.tags) {
      for (const tag of recording.tags) {
        allTags.add(tag);
      }
    }
  }

  // Sort by timestamp
  allInteractions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    description: options?.description,
    tags: options?.tags ?? (allTags.size > 0 ? Array.from(allTags) : undefined),
    interactions: allInteractions,
  };
}

/**
 * Filter a recording to include only matching interactions.
 *
 * @param recording - Recording to filter
 * @param predicate - Filter function
 * @returns Filtered recording
 *
 * @example
 * ```typescript
 * // Keep only successful interactions
 * const filtered = filterRecording(recording, (i) => !i.error);
 *
 * // Keep only generate calls
 * const generates = filterRecording(recording, (i) => i.method === "generate");
 * ```
 *
 * @category Testing
 */
export function filterRecording(
  recording: Recording,
  predicate: (interaction: RecordedInteraction) => boolean,
): Recording {
  return {
    ...recording,
    interactions: recording.interactions.filter(predicate),
  };
}

/**
 * Create a recording from manual interaction definitions.
 *
 * Useful for creating test fixtures without running actual agent calls.
 *
 * @param interactions - Interactions to include
 * @param options - Recording options
 * @returns A recording object
 *
 * @example
 * ```typescript
 * const recording = createRecording([
 *   {
 *     request: { prompt: "Hello" },
 *     response: { text: "Hi there!", finishReason: "stop" },
 *   },
 *   {
 *     request: { prompt: "Goodbye" },
 *     response: { text: "See you!", finishReason: "stop" },
 *   },
 * ], { description: "Basic greeting flow" });
 * ```
 *
 * @category Testing
 */
export function createRecording(
  interactions: Array<{
    request: RecordedInteraction["request"];
    response: RecordedInteraction["response"];
    method?: "generate" | "stream";
    duration?: number;
    error?: RecordedInteraction["error"];
  }>,
  options?: { description?: string; tags?: string[]; metadata?: Record<string, unknown> },
): Recording {
  const now = new Date();

  return {
    version: "1.0.0",
    createdAt: now.toISOString(),
    description: options?.description,
    tags: options?.tags,
    metadata: options?.metadata,
    interactions: interactions.map((i, index) => ({
      timestamp: new Date(now.getTime() + index * 1000).toISOString(),
      request: i.request,
      response: i.response,
      method: i.method ?? "generate",
      duration: i.duration,
      error: i.error,
    })),
  };
}
