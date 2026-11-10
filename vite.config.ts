// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  publicDir: 'public',
  worker: {
    format: 'es',
  },
  server: {
    host: '127.0.0.1',
    port: 8177,
  },
  preview: {
    host: '127.0.0.1',
    port: 8177,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Copy public/ (including public/models, ~248 MB) into dist/ so the build
    // output is self-contained: dist/models/*.mnn are served from /models/*.
    copyPublicDir: true,
  },
})
