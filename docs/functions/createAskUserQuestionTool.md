[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createAskUserQuestionTool

# Function: createAskUserQuestionTool()

> **createAskUserQuestionTool**(`onAskUser`: [`AskUserCallback`](../type-aliases/AskUserCallback.md)): [`Tool`](../type-aliases/Tool.md)&lt;\{ `multiSelect?`: `boolean`; `options`: [`QuestionOption`](../interfaces/QuestionOption.md)[]; `question`: `string`; \}, `string`&gt;

Defined in: [packages/agent-sdk/src/tools/user-interaction.ts:129](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/user-interaction.ts#L129)

Creates a tool for asking the user clarifying questions.

This tool allows agents to request additional information from users
during execution. It supports both single-select and multi-select
questions with multiple choice options.

The tool requires a callback function that handles the actual UI
interaction with the user. The callback receives the question and
options, prompts the user, and returns their selection.

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `onAskUser` | [`AskUserCallback`](../type-aliases/AskUserCallback.md) | Callback function to handle user prompts |

## Returns

[`Tool`](../type-aliases/Tool.md)&lt;\{ `multiSelect?`: `boolean`; `options`: [`QuestionOption`](../interfaces/QuestionOption.md)[]; `question`: `string`; \}, `string`&gt;

An AI SDK compatible tool for asking questions

## Examples

Single-select question
```typescript
import { createAskUserQuestionTool } from "@lleverage-ai/agent-sdk";

const askUserQuestion = createAskUserQuestionTool(
  async (question, options, multiSelect) => {
    console.log(question);
    options.forEach((opt, i) => {
      console.log(`${i + 1}. ${opt.label}: ${opt.description}`);
    });
    const answer = await getUserInput(); // Your UI logic
    return options[answer - 1].value;
  }
);

const agent = createAgent({
  model,
  tools: { askUserQuestion },
});
```

Multi-select question
```typescript
const askUserQuestion = createAskUserQuestionTool(
  async (question, options, multiSelect) => {
    if (multiSelect) {
      // Show checkboxes, allow multiple selections
      const selected = await getUserMultipleChoices();
      return selected.map(i => options[i].value);
    }
    // Single select logic
  }
);
```

Integration with UI framework
```typescript
// React example
const askUserQuestion = createAskUserQuestionTool(
  async (question, options, multiSelect) => {
    return new Promise((resolve) => {
      setQuestion({ question, options, multiSelect, resolve });
    });
  }
);

// In your React component:
function QuestionDialog({ question, options, multiSelect, resolve }) {
  const [selected, setSelected] = useState([]);

  const handleSubmit = () => {
    if (multiSelect) {
      resolve(selected);
    } else {
      resolve(selected[0]);
    }
  };

  // Render question UI...
}
```
