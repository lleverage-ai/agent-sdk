import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
    },
    server: {
      deps: {
        // Inline zod to avoid vitest SSR transform issues with zod v4
        inline: ["zod"],
      },
    },
  },
});
