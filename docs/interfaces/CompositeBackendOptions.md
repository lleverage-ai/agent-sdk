[**@lleverage-ai/agent-sdk**](../index.md)

***

[@lleverage-ai/agent-sdk](../index.md) / CompositeBackendOptions

# Interface: CompositeBackendOptions

Defined in: [packages/agent-sdk/src/backends/composite.ts:71](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L71)

Options for creating a CompositeBackend.

## Properties

### defaultBackend

> **defaultBackend**: [`BackendProtocol`](BackendProtocol.md)

Defined in: [packages/agent-sdk/src/backends/composite.ts:75](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L75)

The default backend for paths that don't match any route.

***

### routes

> **routes**: [`RouteConfig`](../type-aliases/RouteConfig.md)

Defined in: [packages/agent-sdk/src/backends/composite.ts:80](https://github.com/lleverage-ai/agents/blob/9d15cf28d2e7b406d40c136299754149de055155/packages/agent-sdk/src/backends/composite.ts#L80)

Route configuration mapping path prefixes to backends.
