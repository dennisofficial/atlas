import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll } from 'bun:test'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

import { LocalFileSystemPort } from './support-filesystem'
import { LocalProcessPort } from './support-process'

export const files = new LocalFileSystemPort()
export const processes = new LocalProcessPort()

export const useTempAtlasHome = (): void => {
  const previous = process.env[ATLAS_HOME_ENV]
  let home = ''
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'atlas-spec-home-'))
    process.env[ATLAS_HOME_ENV] = home
  })
  afterAll(() => {
    if (previous === undefined) delete process.env[ATLAS_HOME_ENV]
    else process.env[ATLAS_HOME_ENV] = previous
    rmSync(home, { recursive: true, force: true })
  })
}
