import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    // The rules tests share one emulator instance, so they must not race.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
