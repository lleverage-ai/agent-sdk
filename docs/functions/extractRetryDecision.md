[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / extractRetryDecision

# Function: extractRetryDecision()

> **extractRetryDecision**(`hookOutputs`: [`HookOutput`](../interfaces/HookOutput.md)[]): \{ `retry`: `boolean`; `retryDelayMs`: `number`; \} \| `undefined`

Defined in: [packages/agent-sdk/src/hooks.ts:394](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks.ts#L394)

Extracts retry decision from PostGenerateFailure or PostToolUseFailure hook outputs.

Returns the first retry decision found in the hook outputs. If any hook requests a retry,
the operation will be retried after the specified delay (or 0ms if no delay specified).

## Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `hookOutputs` | [`HookOutput`](../interfaces/HookOutput.md)[] | Array of hook outputs to scan |

## Returns

\{ `retry`: `boolean`; `retryDelayMs`: `number`; \} \| `undefined`

Object with retry flag and delay, or undefined if no retry requested

## Example

```typescript
const outputs: HookOutput[] = [
  { hookSpecificOutput: { hookEventName: 'PostGenerateFailure' } },
  { hookSpecificOutput: {
      hookEventName: 'PostGenerateFailure',
      retry: true,
      retryDelayMs: 1000  // Wait 1s before retrying
    }
  },
];

const retryDecision = extractRetryDecision(outputs);
// Returns { retry: true, retryDelayMs: 1000 }
```
