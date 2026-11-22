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
    // Bundled, @nestjs/common's decorators can run before its own reflect-metadata import (deploy of 8880fc110 failed with "Reflect.getOwnMetadata is not a function"); loaded as a package, Node evaluates the polyfill first.
    external: ['@nestjs/common'],
    extensions: [dotenvxTierExtension()],
  },
})
