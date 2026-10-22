import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/{core,wire,ui,harness,db}/vitest.config.ts',
      'apps/{tui,serve,webterm,storybook,web}/vitest.config.ts',
      'evals/vitest.config.ts',
    ],
  },
})
