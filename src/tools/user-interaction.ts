/**
 * User interaction tools for agent-user communication.
 *
 * These tools allow agents to ask clarifying questions and get user input
 * during execution. This enables interactive workflows where the agent
 * needs additional information from the user to proceed.
 *
 * @packageDocumentation
 */

import { tool } from "ai";
import { z } from "zod";

// =============================================================================
// Types
// =============================================================================

/**
 * An option for a multiple-choice question.
 */
export interface QuestionOption {
  /** Display label for this option */
  label: string;
  /** Description of what this option means or what will happen if chosen */
  description?: string;
  /** Value to return if this option is selected */
  value: string;
}

/**
 * Callback function to prompt the user for input.
 *
 * @param question - The question to ask the user
 * @param options - Available answer options
 * @param multiSelect - Whether the user can select multiple options
 * @returns The selected option value(s) as string or string array
 */
export type AskUserCallback = (
  question: string,
  options: QuestionOption[],
  multiSelect: boolean,
) => Promise<string | string[]>;

// =============================================================================
// AskUserQuestion Tool
// =============================================================================

/**
 * Creates a tool for asking the user clarifying questions.
 *
 * This tool allows agents to request additional information from users
 * during execution. It supports both single-select and multi-select
 * questions with multiple choice options.
 *
 * The tool requires a callback function that handles the actual UI
 * interaction with the user. The callback receives the question and
 * options, prompts the user, and returns their selection.
 *
 * @param onAskUser - Callback function to handle user prompts
 * @returns An AI SDK compatible tool for asking questions
 *
 * @example
 * Single-select question
 * ```typescript
 * import { createAskUserQuestionTool } from "@lleverage-ai/agent-sdk";
 *
 * const askUserQuestion = createAskUserQuestionTool(
 *   async (question, options, multiSelect) => {
 *     console.log(question);
 *     options.forEach((opt, i) => {
 *       console.log(`${i + 1}. ${opt.label}: ${opt.description}`);
 *     });
 *     const answer = await getUserInput(); // Your UI logic
 *     return options[answer - 1].value;
 *   }
 * );
 *
 * const agent = createAgent({
 *   model,
 *   tools: { askUserQuestion },
 * });
 * ```
 *
 * @example
 * Multi-select question
 * ```typescript
 * const askUserQuestion = createAskUserQuestionTool(
 *   async (question, options, multiSelect) => {
 *     if (multiSelect) {
 *       // Show checkboxes, allow multiple selections
 *       const selected = await getUserMultipleChoices();
 *       return selected.map(i => options[i].value);
 *     }
 *     // Single select logic
 *   }
 * );
 * ```
 *
 * @example
 * Integration with UI framework
 * ```typescript
 * // React example
 * const askUserQuestion = createAskUserQuestionTool(
 *   async (question, options, multiSelect) => {
 *     return new Promise((resolve) => {
 *       setQuestion({ question, options, multiSelect, resolve });
 *     });
 *   }
 * );
 *
 * // In your React component:
 * function QuestionDialog({ question, options, multiSelect, resolve }) {
 *   const [selected, setSelected] = useState([]);
 *
 *   const handleSubmit = () => {
 *     if (multiSelect) {
 *       resolve(selected);
 *     } else {
 *       resolve(selected[0]);
 *     }
 *   };
 *
 *   // Render question UI...
 * }
 * ```
 *
 * @category Tools
 */
export function createAskUserQuestionTool(onAskUser: AskUserCallback) {
  return tool({
    description:
      "Ask the user a clarifying question with multiple choice options. Use this when you need additional information from the user to proceed.",
    inputSchema: z.object({
      question: z.string().describe("The question to ask the user. Should be clear and specific."),
      options: z
        .array(
          z.object({
            label: z.string().describe("Display text for this option (concise, 1-5 words)"),
            description: z
              .string()
              .optional()
              .describe("Explanation of what this option means or what will happen"),
            value: z.string().describe("Value to return if selected (can be same as label)"),
          }),
        )
        .min(2)
        .max(10)
        .describe("Available answer options (2-10 options)"),
      multiSelect: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the user can select multiple options (default: false)"),
    }),
    execute: async ({
      question,
      options,
      multiSelect = false,
    }: {
      question: string;
      options: QuestionOption[];
      multiSelect?: boolean;
    }) => {
      // Validate options
      if (options.length < 2) {
        return "Error: At least 2 options are required for a question.";
      }

      if (options.length > 10) {
        return "Error: Maximum 10 options allowed per question.";
      }

      // Call the user-provided callback to handle the interaction
      const result = await onAskUser(question, options, multiSelect);

      // Format the response
      if (multiSelect && Array.isArray(result)) {
        const selectedLabels = result
          .map((value) => {
            const option = options.find((opt) => opt.value === value);
            return option?.label || value;
          })
          .join(", ");

        return `User selected: ${selectedLabels}`;
      }

      if (typeof result === "string") {
        const option = options.find((opt) => opt.value === result);
        return `User selected: ${option?.label || result}`;
      }

      return `User selected: ${String(result)}`;
    },
  });
}
