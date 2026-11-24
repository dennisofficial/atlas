import { defineConfig } from '@trigger.dev/sdk'
import { dotenvxTierExtension } from './trigger-tier-extension'

export default defineConfig({
  project: 'proj_wcjbubibkotgsclldnyz',
  runtime: 'node-24',
  dirs: ['./src'],
  ignorePatterns: ['**/__tests__/**', '**/*.spec.ts'],
  maxDuration: 300,
  build: {
    conditions: ['bun'],
    extensions: [dotenvxTierExtension()],
  },
})
