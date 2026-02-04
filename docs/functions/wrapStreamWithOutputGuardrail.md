[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / wrapStreamWithOutputGuardrail

# Function: wrapStreamWithOutputGuardrail()

> **wrapStreamWithOutputGuardrail**&lt;`T`&gt;(`stream`: `ReadableStream`&lt;`T`&gt;, `config`: [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md)): `ReadableStream`&lt;`T`&gt;

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:560](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L560)

Wraps a ReadableStream with buffered output guardrails.

## Type Parameters

| Type Parameter |
| :------ |
| `T` *extends* \{ `delta?`: `string`; `text?`: `string`; `type?`: `string`; \} |

## Parameters

| Parameter | Type |
| :------ | :------ |
| `stream` | `ReadableStream`&lt;`T`&gt; |
| `config` | [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md) |

## Returns

`ReadableStream`&lt;`T`&gt;

## Example

```typescript
const guardedStream = wrapStreamWithOutputGuardrail(sourceStream, {
  guardrails: noSecretsGuardrail,
});

for await (const chunk of guardedStream) {
  writer.write(chunk);
}
```
