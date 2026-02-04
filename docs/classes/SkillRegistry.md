[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SkillRegistry

# Class: SkillRegistry

Defined in: [packages/agent-sdk/src/tools/skills.ts:168](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L168)

Registry for managing loadable skills.

The registry tracks available skills and which ones have been loaded.
Skills are loaded on-demand by the agent using the skill tool.

## Example

```typescript
const registry = new SkillRegistry({
  skills: [gitSkill, dockerSkill],
});

// Register more skills later
registry.register(kubernetesSkill);

// Check available skills
const available = registry.listAvailable();

// Load a skill
const result = registry.load("git");
```

## Constructors

### Constructor

> **new SkillRegistry**(`options`: [`SkillRegistryOptions`](../interfaces/SkillRegistryOptions.md)): `SkillRegistry`

Defined in: [packages/agent-sdk/src/tools/skills.ts:186](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L186)

Creates a new skill registry.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `options` | [`SkillRegistryOptions`](../interfaces/SkillRegistryOptions.md) | Configuration options |

#### Returns

`SkillRegistry`

## Accessors

### loadedCount

#### Get Signature

> **get** **loadedCount**(): `number`

Defined in: [packages/agent-sdk/src/tools/skills.ts:452](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L452)

Get the number of loaded skills.

##### Returns

`number`

***

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [packages/agent-sdk/src/tools/skills.ts:445](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L445)

Get the number of registered skills.

##### Returns

`number`

## Methods

### get()

> **get**(`name`: `string`): [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md) \| `undefined`

Defined in: [packages/agent-sdk/src/tools/skills.ts:257](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L257)

Get a registered skill definition.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the skill |

#### Returns

[`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md) \| `undefined`

The skill definition or undefined if not found

***

### has()

> **has**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/skills.ts:237](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L237)

Check if a skill is registered.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the skill to check |

#### Returns

`boolean`

True if the skill is registered

***

### isLoaded()

> **isLoaded**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/skills.ts:247](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L247)

Check if a skill is currently loaded.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the skill to check |

#### Returns

`boolean`

True if the skill is loaded

***

### listAll()

> **listAll**(): \{ `description`: `string`; `loaded`: `boolean`; `name`: `string`; \}[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:418](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L418)

List all registered skills (loaded and available).

#### Returns

\{ `description`: `string`; `loaded`: `boolean`; `name`: `string`; \}[]

Array of all skill summaries

***

### listAvailable()

> **listAvailable**(): \{ `description`: `string`; `name`: `string`; \}[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:389](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L389)

List skills that are available but not yet loaded.

#### Returns

\{ `description`: `string`; `name`: `string`; \}[]

Array of skill summaries (name and description)

***

### listLoaded()

> **listLoaded**(): `string`[]

Defined in: [packages/agent-sdk/src/tools/skills.ts:409](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L409)

List all loaded skills.

#### Returns

`string`[]

Array of loaded skill names

***

### load()

> **load**(`name`: `string`, `args?`: `string`): [`SkillLoadResult`](../interfaces/SkillLoadResult.md)

Defined in: [packages/agent-sdk/src/tools/skills.ts:280](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L280)

Load a skill, making its tools and prompt available.

This method handles dependencies, loading them first if specified.
Already-loaded skills are skipped (no duplicate loading).

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the skill to load |
| `args?` | `string` | Optional arguments to pass to the skill's prompt function |

#### Returns

[`SkillLoadResult`](../interfaces/SkillLoadResult.md)

The load result with tools, prompt, and status

#### Example

```typescript
const result = registry.load("git");
if (result.success) {
  // Inject result.tools into agent
  // Inject result.prompt into context
}
```

***

### register()

> **register**(`skill`: [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md)): `void`

Defined in: [packages/agent-sdk/src/tools/skills.ts:213](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L213)

Register a skill with the registry.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `skill` | [`LoadableSkillDefinition`](../interfaces/LoadableSkillDefinition.md) | The skill definition to register |

#### Returns

`void`

#### Throws

Error if a skill with the same name is already registered

#### Example

```typescript
registry.register({
  name: "aws",
  description: "AWS cloud operations",
  tools: { ... },
  prompt: "You now have access to AWS tools.",
});
```

***

### reset()

> **reset**(): `void`

Defined in: [packages/agent-sdk/src/tools/skills.ts:438](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L438)

Reset the registry, marking all skills as unloaded.

This does not unregister skills, only resets the loaded state.

#### Returns

`void`

***

### unregister()

> **unregister**(`name`: `string`): `boolean`

Defined in: [packages/agent-sdk/src/tools/skills.ts:226](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/tools/skills.ts#L226)

Unregister a skill from the registry.

#### Parameters

| Parameter | Type | Description |
| :------ | :------ | :------ |
| `name` | `string` | The name of the skill to unregister |

#### Returns

`boolean`

True if the skill was found and removed
