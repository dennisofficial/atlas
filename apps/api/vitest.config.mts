import { resolve } from 'node:path'
import swc from 'unplugin-swc'
import { defineConfig } from 'vitest/config'

const fromRoot = (path: string) => resolve(__dirname, path)

export default defineConfig({
  plugins: [
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
      '@api': fromRoot('src/api'),
      '@core': fromRoot('src/_core'),
      '@lib': fromRoot('src/_lib'),
      '@module': fromRoot('src/_module'),
      '@db': fromRoot('prisma'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'prisma/**/*.spec.ts', 'test/**/*.spec.ts'],
    setupFiles: ['vitest.setup.ts'],
    env: { NODE_ENV: 'test' },
  },
})
