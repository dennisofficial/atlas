import { defineConfig } from '@trigger.dev/sdk'
import { dotenvxTierExtension } from './trigger-tier-extension'

export default defineConfig({
  project: 'proj_yvwotwceptrneuuasamk',
  // trigger.dev's bun runtime is experimental and pinned to an older bun than the repo's.
  runtime: 'node-24',
  dirs: ['./src/trigger'],
  maxDuration: 300,
  build: {
    // @dltech/atlas-wire ships raw TS under its `bun` export condition; its `default` points at an unbuilt dist.
    conditions: ['bun'],
    extensions: [dotenvxTierExtension()],
  },
})
