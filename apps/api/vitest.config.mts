import { incrementalTests } from '@dltech/vitest-incremental'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    incrementalTests({ globalInputs: ['packages/db/src/prisma/schema/**/*.prisma', 'packages/db/migrations/**/ops.json'] }),
    swc.vite({
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2023',
      },
    }),
  ],
  resolve: {
    alias: [
      {
        find: /^@dltech\/atlas-wire\/web$/,
        replacement: new URL('../../packages/wire/src/web/index.ts', import.meta.url).pathname,
      },
      {
        find: /^@dltech\/atlas-db\/testing$/,
        replacement: new URL('../../packages/db/src/testing/index.ts', import.meta.url).pathname,
      },
      {
        find: /^@dltech\/atlas-db$/,
        replacement: new URL('../../packages/db/src/index.ts', import.meta.url).pathname,
      },
      {
        find: /^@dltech\/atlas-wire$/,
        replacement: new URL('../../packages/wire/src/index.ts', import.meta.url).pathname,
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['vitest.setup.ts'],
    env: { NODE_ENV: 'test' },
  },
})
