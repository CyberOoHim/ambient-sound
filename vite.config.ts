/// <reference types="vitest/config" />
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as {
  version: string
}

/**
 * Stamp service-worker CACHE_VERSION so deploys bust the app shell cache (FIX-02).
 */
function swCacheVersionPlugin() {
  return {
    name: 'sw-cache-version',
    closeBundle() {
      const outDir = join(__dirname, 'dist')
      const swPath = join(outDir, 'sw.js')
      if (!existsSync(swPath)) return
      const stamp = `v${pkg.version}-${Date.now().toString(36)}`
      let sw = readFileSync(swPath, 'utf8')
      sw = sw.replace(
        /const CACHE_VERSION\s*=\s*['"][^'"]*['"]/,
        `const CACHE_VERSION = '${stamp}'`,
      )
      writeFileSync(swPath, sw)
      console.log(`[sw-cache-version] CACHE_VERSION = ${stamp}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || './',
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
  },
  plugins: [svelte(), swCacheVersionPlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
