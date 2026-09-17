import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // Logic tests run in node; component tests opt into a DOM with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
