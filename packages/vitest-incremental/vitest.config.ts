import { defineProject } from 'vitest/config'

export default defineProject({
  test: {
    name: 'vitest-incremental',
    include: ['test/**/*.test.ts'],
    exclude: ['**/node_modules/**', '.fixture/**'],
    testTimeout: 180_000,
  },
})
