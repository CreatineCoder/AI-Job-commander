import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// The Lemma pod serves a single static file at apps/board/index.html.
// We build the whole React app (JS + CSS) inlined into one HTML file and emit
// it straight into that location so `lemma pods import` ships the built app.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  build: {
    outDir: resolve(__dirname, "../apps/board"),
    emptyOutDir: false, // apps/board is a pod resource dir — only overwrite index.html
    target: "es2018",
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
