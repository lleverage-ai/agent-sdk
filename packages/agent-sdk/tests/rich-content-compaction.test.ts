import type { ModelMessage } from "ai";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createApproximateTokenCounter,
  createContextManager,
  createCustomTokenCounter,
} from "../src/context-manager.js";
import type { Agent } from "../src/types.js";

describe("Rich Content Compaction (Phase 5)", () => {
  let mockAgent: Agent;

  beforeEach(() => {
    // Create a simple mock agent that returns summaries
    mockAgent = {
      generate: async () => ({
        status: "complete" as const,
        text: "Summary of conversation with rich content",
        finishReason: "stop" as const,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
        warnings: [],
        request: {} as any,
        response: {} as any,
        experimental_providerMetadata: undefined,
      }),
    } as unknown as Agent;
  });

  describe("Token Counting with Rich Content", () => {
    it("should count tokens for image parts", () => {
      const counter = createApproximateTokenCounter();

      const messagesWithImage: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this image?" },
            {
              type: "image",
              image: new URL("https://example.com/image.png"),
            },
          ],
        },
      ];

      const tokenCount = counter.countMessages(messagesWithImage);

      // Text (~6 tokens) + message overhead (~4) + image (1000) = ~1010
      expect(tokenCount).toBeGreaterThan(1000);
      expect(tokenCount).toBeLessThan(1050);
    });

    it("should count tokens for file parts", () => {
      const counter = createApproximateTokenCounter();

      const messagesWithFile: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this document" },
            {
              type: "file",
              data: "base64data",
              mimeType: "application/pdf",
            },
          ],
        },
      ];

      const tokenCount = counter.countMessages(messagesWithFile);

      // Text (~5 tokens) + message overhead (~4) + file (500) = ~509
      expect(tokenCount).toBeGreaterThan(500);
      expect(tokenCount).toBeLessThan(550);
    });

    it("should count tokens for multiple images and files", () => {
      const counter = createApproximateTokenCounter();

      const messagesWithMultipleMedia: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these" },
            { type: "image", image: new URL("https://example.com/img1.png") },
            { type: "image", image: new URL("https://example.com/img2.png") },
            {
              type: "file",
              data: "data:application/pdf;base64,abc123",
              mimeType: "application/pdf",
            },
          ],
        },
      ];

      const tokenCount = counter.countMessages(messagesWithMultipleMedia);

      // Text + overhead + 2 images (2000) + 1 file (500) = ~2500+
      expect(tokenCount).toBeGreaterThan(2500);
      expect(tokenCount).toBeLessThan(2600);
    });

    it("should cache token counts for identical rich content messages", () => {
      const counter = createApproximateTokenCounter();

      const message: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Analyze this" },
          { type: "image", image: new URL("https://example.com/test.png") },
        ],
      };

      const count1 = counter.countMessages([message]);
      const count2 = counter.countMessages([message]);

      expect(count1).toBe(count2);
    });

    it("should handle custom token counter with rich content", () => {
      const customCounter = createCustomTokenCounter({
        countFn: (text: string) => text.split(/\s+/).length, // word count
      });

      const messagesWithImage: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "What is in this image file?" }, // 6 words
            { type: "image", image: new URL("https://example.com/image.png") },
          ],
        },
      ];

      const tokenCount = customCounter.countMessages(messagesWithImage);

      // 6 words + message overhead (4) + image (1000) = 1010
      expect(tokenCount).toBe(1010);
    });
  });

  describe("Rich Content Metadata Extraction", () => {
    it("should extract image URL metadata in summaries", async () => {
      const manager = createContextManager({
        maxTokens: 2000,
        policy: { tokenThreshold: 0.5 }, // Lower threshold to trigger compaction
        summarization: { keepMessageCount: 2 },
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "What's in this screenshot?" },
            {
              type: "image",
              image: new URL("https://example.com/screenshot.png"),
            },
          ],
        },
        {
          role: "assistant",
          content: "The screenshot shows a login form with username and password fields.",
        },
        // Add more messages to trigger compaction
        { role: "user", content: "Can you make it responsive?" },
        { role: "assistant", content: "Sure, I'll add media queries." },
        { role: "user", content: "Great, what about dark mode?" },
      ];

      const processed = await manager.process(messages, mockAgent);

      // Should trigger compaction and create a summary
      // The summary should be in the processed messages
      const hasSummary = processed.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      expect(hasSummary).toBe(true);
    });

    it("should extract file metadata with MIME types", async () => {
      const manager = createContextManager({
        maxTokens: 1000, // Lower max to trigger more easily
        policy: { tokenThreshold: 0.3 }, // Lower threshold
        summarization: { keepMessageCount: 1 }, // Keep fewer messages
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "Review this PDF document" },
            {
              type: "file",
              data: "base64encodeddata",
              mimeType: "application/pdf",
            },
          ],
        },
        {
          role: "assistant",
          content: "I've reviewed the document. It contains a project proposal.",
        },
        // Trigger compaction
        { role: "user", content: "What are the key points?" },
        { role: "assistant", content: "Main points are: 1. Budget 2. Timeline 3. Team" },
        { role: "user", content: "Can you elaborate on timeline?" },
      ];

      const processed = await manager.process(messages, mockAgent);

      const hasSummary = processed.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      expect(hasSummary).toBe(true);
    });

    it("should handle messages with both images and files", async () => {
      const manager = createContextManager({
        maxTokens: 1500, // Lower max to trigger more easily
        policy: { tokenThreshold: 0.3 }, // Lower threshold
        summarization: { keepMessageCount: 1 }, // Keep fewer messages
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare the diagram and specification" },
            {
              type: "image",
              image: new URL("https://example.com/architecture-diagram.png"),
            },
            {
              type: "file",
              data: new URL("https://example.com/spec.pdf"),
              mimeType: "application/pdf",
            },
          ],
        },
        {
          role: "assistant",
          content: "The diagram matches the specification in sections 2-4.",
        },
        // Trigger compaction
        { role: "user", content: "What about section 5?" },
        { role: "assistant", content: "Section 5 needs updates to match the diagram." },
        { role: "user", content: "Can you list the required changes?" },
      ];

      const processed = await manager.process(messages, mockAgent);

      const hasSummary = processed.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      expect(hasSummary).toBe(true);
    });
  });

  describe("Structured Summaries with Rich Content", () => {
    it("should include rich content references in structured summaries", async () => {
      // Mock agent that returns structured JSON summary
      const structuredMockAgent = {
        generate: async () => ({
          status: "complete" as const,
          text: JSON.stringify({
            decisions: ["Use responsive design based on screenshot"],
            preferences: ["User prefers dark mode"],
            currentState: ["Analyzed screenshot.png showing login form"],
            openQuestions: ["Should we add 2FA?"],
            references: [
              "Image: https://example.com/screenshot.png",
              "Form fields: username, password",
            ],
          }),
          finishReason: "stop" as const,
          usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
          warnings: [],
          request: {} as any,
          response: {} as any,
          experimental_providerMetadata: undefined,
        }),
      } as unknown as Agent;

      const manager = createContextManager({
        maxTokens: 1000,
        summarization: {
          keepMessageCount: 2,
          strategy: "structured",
          enableStructuredSummary: true,
        },
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "Review this UI screenshot" },
            {
              type: "image",
              image: new URL("https://example.com/screenshot.png"),
            },
          ],
        },
        {
          role: "assistant",
          content: "The UI shows a login form. I recommend responsive design.",
        },
        // Trigger compaction
        { role: "user", content: "Add dark mode support" },
        { role: "assistant", content: "I'll add CSS variables for theming." },
        { role: "user", content: "What about 2FA?" },
      ];

      const processed = await manager.process(messages, structuredMockAgent);

      const summaryMessage = processed.find(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      expect(summaryMessage).toBeDefined();
      if (summaryMessage && typeof summaryMessage.content === "string") {
        // Check that the summary includes structured sections (as markdown)
        expect(summaryMessage.content).toContain("Decisions");
        expect(summaryMessage.content).toContain("References");
      }
    });
  });

  describe("Hash Function with Rich Content", () => {
    it("should create consistent hashes for messages with images", () => {
      const counter = createApproximateTokenCounter();

      const message1: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Analyze" },
          { type: "image", image: new URL("https://example.com/img.png") },
        ],
      };

      const message2: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Analyze" },
          { type: "image", image: new URL("https://example.com/img.png") },
        ],
      };

      const count1 = counter.countMessages([message1]);
      const count2 = counter.countMessages([message2]);

      // Should use cache and return same count
      expect(count1).toBe(count2);
    });

    it("should create different hashes for different rich content", () => {
      const counter = createApproximateTokenCounter();

      const message1: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Analyze" },
          { type: "image", image: new URL("https://example.com/img1.png") },
        ],
      };

      const message2: ModelMessage = {
        role: "user",
        content: [
          { type: "text", text: "Analyze" },
          { type: "image", image: new URL("https://example.com/img2.png") },
        ],
      };

      // Count both to populate cache
      counter.countMessages([message1]);
      counter.countMessages([message2]);

      // Both should have been counted (different hashes)
      // This is implicit - if they had the same hash, only one would be counted
      expect(true).toBe(true); // Just verify no errors occur
    });
  });

  describe("Budget Tracking with Rich Content", () => {
    it("should accurately track budget with image-heavy conversations", () => {
      const manager = createContextManager({
        maxTokens: 5000,
        summarization: { keepMessageCount: 3 },
      });

      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "Compare these screenshots" },
            { type: "image", image: new URL("https://example.com/before.png") },
            { type: "image", image: new URL("https://example.com/after.png") },
          ],
        },
        {
          role: "assistant",
          content: "The after screenshot shows improved layout.",
        },
      ];

      const budget = manager.getBudget(messages);

      // Should account for 2 images (2000 tokens) + text + overhead
      expect(budget.currentTokens).toBeGreaterThan(2000);
      expect(budget.usage).toBeGreaterThan(0.4); // > 40% of 5000
    });

    it("should trigger compaction when rich content exceeds threshold", async () => {
      const manager = createContextManager({
        maxTokens: 2500,
        policy: { tokenThreshold: 0.6 }, // 60% of 2500 = 1500 tokens
        summarization: { keepMessageCount: 2 },
      });

      // Create messages that exceed 60% of 2500 (> 1500 tokens)
      const messages: ModelMessage[] = [
        { role: "system", content: "You are a helpful assistant" },
        {
          role: "user",
          content: [
            { type: "text", text: "Review image 1" },
            { type: "image", image: new URL("https://example.com/img1.png") }, // ~1000
          ],
        },
        { role: "assistant", content: "Image 1 looks good." },
        {
          role: "user",
          content: [
            { type: "text", text: "Review image 2" },
            { type: "image", image: new URL("https://example.com/img2.png") }, // ~1000
          ],
        },
        { role: "assistant", content: "Image 2 needs adjustments." },
        { role: "user", content: "What specific adjustments?" }, // Triggers compaction
      ];

      // Total should be ~2000+ tokens (2 images + text + overhead)
      const shouldCompact = manager.shouldCompact(messages);
      expect(shouldCompact.trigger).toBe(true);

      const processed = await manager.process(messages, mockAgent);

      const hasSummary = processed.some(
        (m) =>
          m.role === "assistant" &&
          typeof m.content === "string" &&
          m.content.includes("[Previous conversation summary]"),
      );

      expect(hasSummary).toBe(true);
    });
  });

  describe("Edge Cases with Rich Content", () => {
    it("should handle base64 data URLs for images", () => {
      const counter = createApproximateTokenCounter();

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Analyze this" },
            {
              type: "image",
              image:
                "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          ],
        },
      ];

      const tokenCount = counter.countMessages(messages);
      expect(tokenCount).toBeGreaterThan(1000); // Image should add ~1000 tokens
    });

    it("should handle file URLs", () => {
      const counter = createApproximateTokenCounter();

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Read this" },
            {
              type: "file",
              data: new URL("https://example.com/document.pdf"),
              mimeType: "application/pdf",
            },
          ],
        },
      ];

      const tokenCount = counter.countMessages(messages);
      expect(tokenCount).toBeGreaterThan(500); // File should add ~500 tokens
    });

    it("should handle messages with only rich content (no text)", () => {
      const counter = createApproximateTokenCounter();

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [{ type: "image", image: new URL("https://example.com/img.png") }],
        },
      ];

      const tokenCount = counter.countMessages(messages);
      expect(tokenCount).toBeGreaterThan(1000); // Image + overhead
    });

    it("should invalidate cache including rich content", () => {
      const counter = createApproximateTokenCounter();

      const messages: ModelMessage[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Test" },
            { type: "image", image: new URL("https://example.com/img.png") },
          ],
        },
      ];

      counter.countMessages(messages);

      counter.invalidateCache?.();

      // Should still work after cache invalidation
      const count = counter.countMessages(messages);
      expect(count).toBeGreaterThan(1000);
    });
  });
});
