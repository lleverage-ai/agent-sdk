# Contributing to @lleverage-ai/agent-sdk

Thank you for your interest in contributing! This document explains how to get started.

## Development Setup

```bash
# Clone the repo
git clone https://github.com/lleverage-ai/agent-sdk.git
cd agent-sdk

# Install dependencies
bun install

# Build all packages (in dependency order)
bun run build

# Run all tests
bun run test

# Lint and format
bun run check
bun run format
```

## Project Structure

This is a monorepo with three packages:

- `packages/agent-sdk` — Core agent framework
- `packages/agent-stream` — Event transport and replay
- `packages/agent-ledger` — Durable transcript layer

## Making Changes

1. Create a branch from `main`
2. Make your changes
3. Run the full check suite: `bun run check && bun run type-check && bun run test`
4. Commit with a clear message describing the change
5. Open a pull request against `main`

## Code Style

- TypeScript with strict mode
- Formatting and linting enforced by [Biome](https://biomejs.dev/)
- Run `bun run format` to auto-fix formatting
- Run `bun run check` to verify lint rules
- Use `npx biome check --write --unsafe` to auto-fix unused imports

## Testing

- Tests use [Vitest](https://vitest.dev/)
- Place tests in `tests/` mirroring the `src/` structure
- Use `createMockModel()` from `tests/setup.ts` for agent tests
- Run a single package's tests: `cd packages/agent-sdk && bun run test`

## Reporting Issues

Open an issue at [github.com/lleverage-ai/agent-sdk/issues](https://github.com/lleverage-ai/agent-sdk/issues).

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
