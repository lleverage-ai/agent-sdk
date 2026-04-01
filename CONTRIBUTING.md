# Contributing to @lleverage-ai/agent-sdk

This repository is a Bun workspace with two published packages:

- `packages/agent-sdk` — agent framework, tools, plugins, hooks, and sessions
- `packages/agent-threads` — event transport, replay, and durable transcripts

## Getting Started

```bash
git clone https://github.com/lleverage-ai/agent-sdk.git
cd agent-sdk
bun install
```

Useful workspace commands:

```bash
bun run build
bun run check
bun run type-check
bun run test

# Target a single package
bun run --filter '@lleverage-ai/agent-sdk' test
bun run --filter '@lleverage-ai/agent-threads' test
```

## Workflow

1. Branch from `main`.
2. Make the smallest coherent change you can.
3. Add or update tests when behavior changes.
4. Update docs and the changelog when public behavior changes.
5. Run `bun run check && bun run type-check && bun run test`.
6. Open a pull request against `main` with a clear summary and verification notes.

## Code Standards

- Use TypeScript strict mode and ESM imports with explicit `.js` extensions.
- Prefer `interface` over `type` for object shapes.
- Document all public exports with TSDoc.
- Keep functions focused and comments sparse but useful.
- Run `bun run format` or `bun run check:fix` before submitting if formatting changed.

## Tests

- Tests use [Vitest](https://vitest.dev/).
- Keep tests in `tests/` and mirror the source layout when practical.
- Prefer exported testing helpers from `@lleverage-ai/agent-sdk/testing` for public-API examples.
- Repository tests also use local helpers such as `packages/agent-sdk/tests/setup.ts` when exercising internals.

## Docs And Changelog

- Update `CHANGELOG.md` under `## [Unreleased]`.
- Use Keep a Changelog section headings: `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`.
- Keep README/docs examples aligned with the shipped API, especially around tool loading, streaming, and package exports.

## Issues And Pull Requests

- Report bugs and feature requests at [github.com/lleverage-ai/agent-sdk/issues](https://github.com/lleverage-ai/agent-sdk/issues).
- Include reproduction steps, expected behavior, and actual behavior for bug reports.
- Call out breaking changes explicitly in the PR description and changelog entry.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
