import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { AccountStorePort } from '@dltech/atlas-core'

import { createHarnessContainer } from '../../container/create-harness-container'
import { disposeAll } from '../../container/disposal'
import { registeredPortToken } from '../../container/injection'
import { bindAccounts } from '../account-bindings'

let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-account-bindings-cloud-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(atlasHome, { recursive: true, force: true })
})

describe('bindAccounts with cloud-backed stores', () => {
  it('skips environment reconciliation so env keys never reach the cloud store', async () => {
    const container = createHarnessContainer()

    await bindAccounts({
      container,
      env: { ANTHROPIC_API_KEY: 'sk-ant-env-key' },
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
      cloudBacked: true,
    })

    expect(await container.resolve(registeredPortToken(AccountStorePort)).list()).toEqual([])

    await disposeAll({ container })
  })

  it('still reconciles environment keys when cloudBacked is false', async () => {
    const container = createHarnessContainer()

    await bindAccounts({
      container,
      env: { ANTHROPIC_API_KEY: 'sk-ant-env-key' },
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
      cloudBacked: false,
    })

    expect(await container.resolve(registeredPortToken(AccountStorePort)).list()).toHaveLength(1)

    await disposeAll({ container })
  })
})
