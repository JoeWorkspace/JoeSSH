import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

import { applyWebContentSecurityPolicy, applyPermissionsPolicy } from './src/csp';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'atlasterm-web-csp',
      transformIndexHtml(html) {
        return applyPermissionsPolicy(applyWebContentSecurityPolicy(html, process.env.VITE_ATLASTERM_ADMIN_SNAPSHOT_URL));
      },
    },
  ],
  resolve: {
    alias: {
      '@atlasterm/i18n': fileURLToPath(new URL('../../packages/i18n/src/index.ts', import.meta.url).toString()),
    },
  },
  build: {
    sourcemap: false,
    cssCodeSplit: true,
    // @ts-expect-error -- sri is supported by Vite but missing from BuildOptions types
    sri: true,
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
            if (id.includes("@atlasterm/i18n") || id.includes("intl-")) {
              return "i18n";
            }
          }
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 4200,
    proxy: {
      '/api/admin/snapshot': {
        target: process.env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET ?? 'http://127.0.0.1:4110',
        changeOrigin: true,
        rewrite: () => '/v1/admin/snapshot',
        configure(proxy) {
          proxy.on('proxyReq', (proxyRequest) => {
            const token = process.env.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN?.trim();

            if (token) {
              proxyRequest.setHeader('Authorization', `Bearer ${token}`);
            }
          });
        },
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4200,
  },
});
