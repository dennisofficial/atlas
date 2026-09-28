import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

// Loaded via `bun test --preload` so every spec in the process runs against a throwaway Atlas home
// instead of the operator's real one. The home lives under os.tmpdir(), which the atlas-home test
// guard accepts; a spec that needs the real home opts out with ATLAS_ALLOW_REAL_HOME=1.
const previous = process.env[ATLAS_HOME_ENV]

beforeEach(() => {
  process.env[ATLAS_HOME_ENV] = mkdtempSync(join(tmpdir(), 'atlas-spec-home-'))
})

afterEach(() => {
  if (previous === undefined) delete process.env[ATLAS_HOME_ENV]
  else process.env[ATLAS_HOME_ENV] = previous
})
