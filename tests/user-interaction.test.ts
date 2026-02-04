/**
 * Tests for user interaction tools.
 */

import { describe, expect, it, vi } from "vitest";
import type { AskUserCallback, QuestionOption } from "../src/tools/user-interaction.js";
import { createAskUserQuestionTool } from "../src/tools/user-interaction.js";

describe("createAskUserQuestionTool", () => {
  // Helper to create a mock callback
  const createMockCallback = (response: string | string[]): AskUserCallback => {
    return vi.fn(async (_question, _options, _multiSelect) => response);
  };

  describe("single-select questions", () => {
    it("should execute callback with question and options", async () => {
      const callback = vi.fn(async () => "option1");
      const tool = createAskUserQuestionTool(callback);

      const options: QuestionOption[] = [
        { label: "Option 1", value: "option1" },
        { label: "Option 2", value: "option2" },
      ];

      await tool.execute({
        question: "Which option do you prefer?",
        options,
        multiSelect: false,
      });

      expect(callback).toHaveBeenCalledWith("Which option do you prefer?", options, false);
    });

    it("should return formatted response with selected label", async () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Choose one",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: First");
    });

    it("should handle option with description", async () => {
      const callback = createMockCallback("yes");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Do you want to proceed?",
        options: [
          {
            label: "Yes",
            description: "Proceed with the operation",
            value: "yes",
          },
          { label: "No", description: "Cancel the operation", value: "no" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: Yes");
    });

    it("should default multiSelect to false when not provided", async () => {
      const callback = vi.fn(async () => "option1");
      const tool = createAskUserQuestionTool(callback);

      await tool.execute({
        question: "Choose one",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
      });

      expect(callback).toHaveBeenCalledWith("Choose one", expect.any(Array), false);
    });

    it("should handle value not in options", async () => {
      const callback = createMockCallback("unknown");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Choose one",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: unknown");
    });
  });

  describe("multi-select questions", () => {
    it("should execute callback with multiSelect=true", async () => {
      const callback = vi.fn(async () => ["option1", "option2"]);
      const tool = createAskUserQuestionTool(callback);

      const options: QuestionOption[] = [
        { label: "Option 1", value: "option1" },
        { label: "Option 2", value: "option2" },
        { label: "Option 3", value: "option3" },
      ];

      await tool.execute({
        question: "Select all that apply",
        options,
        multiSelect: true,
      });

      expect(callback).toHaveBeenCalledWith("Select all that apply", options, true);
    });

    it("should return formatted response with multiple selections", async () => {
      const callback = createMockCallback(["option1", "option3"]);
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Select all that apply",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
          { label: "Third", value: "option3" },
        ],
        multiSelect: true,
      });

      expect(result).toBe("User selected: First, Third");
    });

    it("should handle single selection in multi-select", async () => {
      const callback = createMockCallback(["option1"]);
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Select at least one",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
        multiSelect: true,
      });

      expect(result).toBe("User selected: First");
    });

    it("should handle all selections", async () => {
      const callback = createMockCallback(["option1", "option2", "option3"]);
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Select all that apply",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
          { label: "Third", value: "option3" },
        ],
        multiSelect: true,
      });

      expect(result).toBe("User selected: First, Second, Third");
    });

    it("should handle unknown values in multi-select", async () => {
      const callback = createMockCallback(["option1", "unknown"]);
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Select all that apply",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
        multiSelect: true,
      });

      expect(result).toBe("User selected: First, unknown");
    });
  });

  describe("validation", () => {
    it("should reject questions with less than 2 options", async () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Choose one",
        options: [{ label: "Only Option", value: "option1" }],
        multiSelect: false,
      });

      expect(result).toBe("Error: At least 2 options are required for a question.");
    });

    it("should reject questions with more than 10 options", async () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const options = Array.from({ length: 11 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `option${i + 1}`,
      }));

      const result = await tool.execute({
        question: "Choose one",
        options,
        multiSelect: false,
      });

      expect(result).toBe("Error: Maximum 10 options allowed per question.");
    });

    it("should accept exactly 2 options", async () => {
      const callback = createMockCallback("yes");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Yes or no?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: Yes");
    });

    it("should accept exactly 10 options", async () => {
      const callback = createMockCallback("option5");
      const tool = createAskUserQuestionTool(callback);

      const options = Array.from({ length: 10 }, (_, i) => ({
        label: `Option ${i + 1}`,
        value: `option${i + 1}`,
      }));

      const result = await tool.execute({
        question: "Choose one",
        options,
        multiSelect: false,
      });

      expect(result).toBe("User selected: Option 5");
    });
  });

  describe("schema validation", () => {
    it("should have correct description", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      expect(tool.description).toContain("Ask the user a clarifying question");
    });

    it("should have inputSchema with required fields", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const schema = tool.inputSchema;
      expect(schema).toBeDefined();
      expect(schema.shape).toHaveProperty("question");
      expect(schema.shape).toHaveProperty("options");
      expect(schema.shape).toHaveProperty("multiSelect");
    });

    it("should validate question as string", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const schema = tool.inputSchema;
      const result = schema.safeParse({
        question: "Valid question?",
        options: [
          { label: "Yes", value: "yes" },
          { label: "No", value: "no" },
        ],
      });

      expect(result.success).toBe(true);
    });

    it("should validate options as array", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const schema = tool.inputSchema;
      const result = schema.safeParse({
        question: "Choose?",
        options: "not-an-array",
      });

      expect(result.success).toBe(false);
    });

    it("should validate option structure", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const schema = tool.inputSchema;
      const result = schema.safeParse({
        question: "Choose?",
        options: [
          { label: "Valid", value: "valid" },
          { label: "Also valid", description: "With description", value: "valid2" },
        ],
      });

      expect(result.success).toBe(true);
    });

    it("should reject options missing required fields", () => {
      const callback = createMockCallback("option1");
      const tool = createAskUserQuestionTool(callback);

      const schema = tool.inputSchema;
      const result = schema.safeParse({
        question: "Choose?",
        options: [{ label: "Missing value" }, { value: "missing-label" }],
      });

      expect(result.success).toBe(false);
    });
  });

  describe("async callback", () => {
    it("should handle async callbacks with delay", async () => {
      const callback: AskUserCallback = async (question, options, multiSelect) => {
        // Simulate user thinking time
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "option1";
      };

      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Choose one",
        options: [
          { label: "First", value: "option1" },
          { label: "Second", value: "option2" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: First");
    });

    it("should propagate callback errors", async () => {
      const callback: AskUserCallback = async () => {
        throw new Error("User cancelled");
      };

      const tool = createAskUserQuestionTool(callback);

      await expect(
        tool.execute({
          question: "Choose one",
          options: [
            { label: "First", value: "option1" },
            { label: "Second", value: "option2" },
          ],
          multiSelect: false,
        }),
      ).rejects.toThrow("User cancelled");
    });
  });

  describe("integration scenarios", () => {
    it("should handle binary yes/no question", async () => {
      const callback = createMockCallback("yes");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Do you want to continue?",
        options: [
          {
            label: "Yes",
            description: "Proceed with the operation",
            value: "yes",
          },
          {
            label: "No",
            description: "Cancel and go back",
            value: "no",
          },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: Yes");
    });

    it("should handle feature selection", async () => {
      const callback = createMockCallback(["auth", "database", "api"]);
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "Which features do you want to enable?",
        options: [
          {
            label: "Authentication",
            description: "User login and registration",
            value: "auth",
          },
          {
            label: "Database",
            description: "PostgreSQL integration",
            value: "database",
          },
          {
            label: "API",
            description: "REST API endpoints",
            value: "api",
          },
          {
            label: "WebSockets",
            description: "Real-time communication",
            value: "websockets",
          },
        ],
        multiSelect: true,
      });

      expect(result).toBe("User selected: Authentication, Database, API");
    });

    it("should handle priority selection", async () => {
      const callback = createMockCallback("high");
      const tool = createAskUserQuestionTool(callback);

      const result = await tool.execute({
        question: "What is the priority of this task?",
        options: [
          { label: "Critical (P0)", value: "critical" },
          { label: "High (P1)", value: "high" },
          { label: "Medium (P2)", value: "medium" },
          { label: "Low (P3)", value: "low" },
        ],
        multiSelect: false,
      });

      expect(result).toBe("User selected: High (P1)");
    });
  });
});
