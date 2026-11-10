import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig, type Connect, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const root = fileURLToPath(new URL('.', import.meta.url))
const publicDir = resolve(root, 'public')
const modelsDir = resolve(publicDir, 'models')

// Serve the large MNN models from public/models in `vite preview` without
// copying them into dist. Dev already serves public/ directly.
function serveModels(): Connect.NextHandleFunction {
  return (req, res, next) => {
    const pathname = decodeURIComponent((req.url || '').split('?')[0] || '')
    if (!pathname.startsWith('/models/')) return next()
    const file = resolve(modelsDir, pathname.slice('/models/'.length))
    if (!file.startsWith(modelsDir + sep)) return next()
    if (!existsSync(file) || !statSync(file).isFile()) return next()
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    createReadStream(file).pipe(res)
  }
}

// Vite would copy all of public/ (including ~248 MB of MNN models) into dist.
// Disable that copy and write everything except models/ explicitly.
function publicAssets(): Plugin {
  return {
    name: 'photoai-public-assets',
    configurePreviewServer(server) {
      server.middlewares.use(serveModels())
    },
    closeBundle() {
      const out = resolve(root, 'dist')
      mkdirSync(out, { recursive: true })
      for (const entry of readdirSync(publicDir)) {
        if (entry === 'models') continue
        cpSync(join(publicDir, entry), join(out, entry), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), publicAssets()],
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
    // Models are served from public/models at deploy time, not bundled.
    copyPublicDir: false,
  },
})
