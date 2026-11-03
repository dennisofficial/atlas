import { defineConfig } from '@trigger.dev/sdk'
import { dotenvxTierExtension } from './trigger-tier-extension'

export default defineConfig({
  project: 'proj_muqwamionbikynuchupc',
  // trigger.dev's bun runtime is experimental and pinned to an older bun than the repo's.
  runtime: 'node-24',
  dirs: ['./src/tasks'],
  maxDuration: 60,
  build: {
    // @dltech/atlas-* packages ship raw TS under their `bun` export condition; `default` points at unbuilt dist.
    conditions: ['bun'],
    extensions: [dotenvxTierExtension()],
  },
})
