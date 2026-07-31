import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: "joessh-release-surface-profile",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: {
              content: mode,
              name: "joessh-release-surface-profile",
            },
            injectTo: "head",
          },
        ];
      },
    },
  ],
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    // @ts-expect-error -- sri is supported by Vite but missing from BuildOptions types
    sri: true,
    cssMinify: true,
    target: "es2020",
    minify: "esbuild",
    assetsInlineLimit: 65536,
    chunkSizeWarningLimit: 250,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react") && !id.includes("lucide")) {
              return "vendor";
            }
            if (id.includes("lucide")) {
              return "icons";
            }
            if (id.includes("@xterm")) {
              return "xterm";
            }
            if (id.includes("@atlasterm/i18n") || id.includes("intl-")) {
              return "i18n";
            }
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
}));
