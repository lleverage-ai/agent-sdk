# Draft PR: OSS readiness pass and inline plugin tool naming cleanup

## Summary

- fix deferred and proxy-loaded function-based plugin tools so they register for discovery and receive the live streaming context in `call_tool`
- rename inline plugin tools from `mcp__<plugin>__<tool>` to `<plugin>__<tool>`
- reserve the `mcp__` namespace for real external MCP servers
- refresh README, MCP/tool-loading docs, contributing guidance, and public examples to match shipped behavior
- remove the failing Bun hook install dependency, align Biome/tooling, and add missing contributor-facing repo docs
- add a package README for `@lleverage-ai/agent-sdk` so the published package is documented on npm

## Why

This pass is about making the repository safer to point people at publicly:

- inline plugin tools no longer look like fake MCP servers
- proxy/deferred tool flows now behave consistently in streaming paths
- a clean install on Bun works
- contributor and package docs are closer to the actual runtime behavior

## Breaking Changes

- **BREAKING**: inline plugin tool names now use `<plugin>__<tool>` instead of `mcp__<plugin>__<tool>`
- external MCP tools remain `mcp__<server>__<tool>`
- anything matching or allowlisting inline plugin tool names directly must use the new namespace

## Verification

- `bun install`
- `bun run build`
- `bun run check`
- `bun run type-check`
- `bun run test`

## Second-Pass Review

No additional code or packaging blockers turned up in the final OSS-readiness pass after these fixes. The remaining nice-to-haves are:

- add issue templates for bug reports and feature requests
- add `CODEOWNERS` if you want explicit review ownership before wider contributor traffic
- do one final wording pass on the root README once you decide how loudly to position MCP vs plugins in the marketing copy
