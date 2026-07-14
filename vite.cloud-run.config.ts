import { resolve } from "node:path";
import { defineConfig } from "vite";

/**
 * Dedicated Node build for the fail-closed Google Cloud runtime foundation.
 * This config never loads the Sites plugin, Wrangler, the Worker entry, or the
 * existing Cloudflare-bound application bundle.
 */
export default defineConfig({
  build: {
    ssr: true,
    target: "node22",
    outDir: "work/cloud-run",
    emptyOutDir: true,
    copyPublicDir: false,
    minify: false,
    sourcemap: true,
    rolldownOptions: {
      input: {
        "cloud-run-server": resolve("production-runtime/src/cloud-run-server.ts"),
        "run-migrations": resolve("production-runtime/src/run-migrations.ts"),
        "run-core-rehearsal": resolve("production-runtime/src/run-core-rehearsal.ts"),
      },
      external: ["pg", "@google-cloud/cloud-sql-connector"],
      output: {
        format: "es",
        entryFileNames: "[name].mjs",
        chunkFileNames: "chunks/[name]-[hash].mjs",
      },
    },
  },
});
