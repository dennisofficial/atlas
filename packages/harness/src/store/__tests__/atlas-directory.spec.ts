import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'vitest'

import { ATLAS_HOME_ENV } from '@dltech/atlas-core'

import { atlasDirectory } from '../paths'

const made: string[] = []
afterEach(async () => {
  for (const directory of made.splice(0)) await rm(directory, { recursive: true, force: true })
})

describe('atlasDirectory under a test runner', () => {
  test('accepts a temp home spelled through its resolved path on this host', async () => {
    const resolved = await realpath(await mkdtemp(join(tmpdir(), 'atlas-resolved-home-')))
    made.push(resolved)
    const home = join(resolved, 'atlas')
    process.env[ATLAS_HOME_ENV] = home

    expect(atlasDirectory()).toBe(home)
  })

  test('accepts a temp home spelled through tmpdir as the platform reports it', async () => {
    const spelled = await mkdtemp(join(tmpdir(), 'atlas-spelled-home-'))
    made.push(spelled)
    process.env[ATLAS_HOME_ENV] = spelled

    expect(atlasDirectory()).toBe(spelled)
  })
})
