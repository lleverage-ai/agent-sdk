[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / createBufferedOutputGuardrail

# Function: createBufferedOutputGuardrail()

> **createBufferedOutputGuardrail**(`config`: [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md)): [`BufferedOutputGuardrail`](../classes/BufferedOutputGuardrail.md)

Defined in: [packages/agent-sdk/src/hooks/parallel-guardrails.ts:540](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/hooks/parallel-guardrails.ts#L540)

Creates a buffered output guardrail.

## Parameters

| Parameter | Type |
| :------ | :------ |
| `config` | [`OutputGuardrailConfig`](../interfaces/OutputGuardrailConfig.md) |

## Returns

[`BufferedOutputGuardrail`](../classes/BufferedOutputGuardrail.md)

## Example

```typescript
const guardrail = createBufferedOutputGuardrail({
  guardrails: [noSecretsGuardrail, noPIIGuardrail],
  minBufferSize: 100,
});

for await (const chunk of stream) {
  if (chunk.type === 'text-delta') {
    if (!guardrail.addContent(chunk.delta)) break;
  }
  guardrail.addChunk(chunk);
}

await guardrail.finalize();
for (const chunk of guardrail.getChunks()) {
  writer.write(chunk);
}
```
