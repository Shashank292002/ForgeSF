import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Mirrors the `paths` entry in tsconfig.app.json. Without it the deep
      // relative chains (`../../../../store/…`) broke on any file move.
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    watch: {
      ignored: ["**/src-tauri/target/**"],
    },
  },
});
