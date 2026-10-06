import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

const previous = process.env[ATLAS_HOME_ENV]

let ownedHome: string | undefined

beforeEach(() => {
  ownedHome = mkdtempSync(join(tmpdir(), 'atlas-spec-home-'))
  process.env[ATLAS_HOME_ENV] = ownedHome
})

afterEach(() => {
  if (previous === undefined) delete process.env[ATLAS_HOME_ENV]
  else process.env[ATLAS_HOME_ENV] = previous

  if (ownedHome === undefined) return
  const home = ownedHome
  ownedHome = undefined
  rmSync(home, { recursive: true, force: true })
})
