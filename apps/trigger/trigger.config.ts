import { defineConfig } from '@trigger.dev/sdk'
import { dotenvxTierExtension } from './trigger-tier-extension'

export default defineConfig({
  project: 'proj_muqwamionbikynuchupc',
  runtime: 'node-24',
  dirs: ['./src/trigger'],
  maxDuration: 300,
  build: {
    conditions: ['bun'],
    extensions: [dotenvxTierExtension()],
  },
})
