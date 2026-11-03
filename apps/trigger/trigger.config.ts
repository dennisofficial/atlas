import { defineConfig } from '@trigger.dev/sdk'
import { dotenvxTierExtension } from './trigger-tier-extension'

const project = process.env.TRIGGER_V2_PROJECT_REF
if (project === undefined) {
  throw new Error(
    'TRIGGER_V2_PROJECT_REF is not set; the v2 trigger.dev project does not exist yet — create it and export its ref before deploying.',
  )
}

export default defineConfig({
  project,
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
