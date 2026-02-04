[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / LanguageModelUsage

# Type Alias: LanguageModelUsage

> **LanguageModelUsage** = \{ `cachedInputTokens?`: `number`; `inputTokenDetails`: \{ `cacheReadTokens`: `number` \| `undefined`; `cacheWriteTokens`: `number` \| `undefined`; `noCacheTokens`: `number` \| `undefined`; \}; `inputTokens`: `number` \| `undefined`; `outputTokenDetails`: \{ `reasoningTokens`: `number` \| `undefined`; `textTokens`: `number` \| `undefined`; \}; `outputTokens`: `number` \| `undefined`; `raw?`: `JSONObject`; `reasoningTokens?`: `number`; `totalTokens`: `number` \| `undefined`; \}

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:267

Represents the number of tokens used in a prompt and completion.

## Properties

### ~~cachedInputTokens?~~

> `optional` **cachedInputTokens**: `number`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:317

#### Deprecated

Use inputTokenDetails.cacheReadTokens instead.

***

### inputTokenDetails

> **inputTokenDetails**: \{ `cacheReadTokens`: `number` \| `undefined`; `cacheWriteTokens`: `number` \| `undefined`; `noCacheTokens`: `number` \| `undefined`; \}

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:275

Detailed information about the input tokens.

#### cacheReadTokens

> **cacheReadTokens**: `number` \| `undefined`

The number of cached input (prompt) tokens read.

#### cacheWriteTokens

> **cacheWriteTokens**: `number` \| `undefined`

The number of cached input (prompt) tokens written.

#### noCacheTokens

> **noCacheTokens**: `number` \| `undefined`

The number of non-cached input (prompt) tokens used.

***

### inputTokens

> **inputTokens**: `number` \| `undefined`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:271

The total number of input (prompt) tokens used.

***

### outputTokenDetails

> **outputTokenDetails**: \{ `reasoningTokens`: `number` \| `undefined`; `textTokens`: `number` \| `undefined`; \}

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:296

Detailed information about the output tokens.

#### reasoningTokens

> **reasoningTokens**: `number` \| `undefined`

The number of reasoning tokens used.

#### textTokens

> **textTokens**: `number` \| `undefined`

The number of text tokens used.

***

### outputTokens

> **outputTokens**: `number` \| `undefined`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:292

The number of total output (completion) tokens used.

***

### raw?

> `optional` **raw**: `JSONObject`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:324

Raw usage information from the provider.

This is the usage information in the shape that the provider returns.
It can include additional information that is not part of the standard usage information.

***

### ~~reasoningTokens?~~

> `optional` **reasoningTokens**: `number`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:313

#### Deprecated

Use outputTokenDetails.reasoningTokens instead.

***

### totalTokens

> **totalTokens**: `number` \| `undefined`

Defined in: node\_modules/.bun/ai@6.0.62+3c5d820c62823f0b/node\_modules/ai/dist/index.d.ts:309

The total number of tokens used.
