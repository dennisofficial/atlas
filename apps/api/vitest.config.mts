import { incrementalTests } from '@dltech/vitest-incremental'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    incrementalTests({ globalInputs: ['apps/api/prisma/**/*.prisma'] }),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
    }),
  ],
  resolve: {
    alias: {
      '@dltech/atlas-wire': new URL('../../packages/wire/src/index.ts', import.meta.url).pathname,
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['vitest.setup.ts'],
    env: { NODE_ENV: 'test' },
  },
})
