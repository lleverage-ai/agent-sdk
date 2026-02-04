[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / SecurityPolicyPreset

# Type Alias: SecurityPolicyPreset

> **SecurityPolicyPreset** = `"development"` \| `"ci"` \| `"production"` \| `"readonly"`

Defined in: [packages/agent-sdk/src/security/index.ts:133](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/security/index.ts#L133)

Preset names for common security levels.

- `development`: Permissive settings for rapid iteration
- `ci`: Restrictive settings for CI/CD environments
- `production`: Balanced settings for production deployments
- `readonly`: Maximum restrictions - no writes, no commands
