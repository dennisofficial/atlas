import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { ENoticeTone } from '@dltech/atlas-core'

import { CloudError } from '../../cloud/cloud-transport'
import { createHarnessContainer } from '../../container/create-harness-container'
import { ClaudeCodeSourceToken } from '../../container/tokens'
import { ClaudeCodeSource } from '../../credentials/claude-code-source'
import { bindAccounts } from '../account-bindings'
import { recordingNotices, type RecordedNotices } from './fakes'

let atlasHome: string
let previousAtlasHome: string | undefined

beforeEach(async () => {
  atlasHome = await mkdtemp(join(tmpdir(), 'atlas-account-bindings-'))
  previousAtlasHome = process.env.ATLAS_HOME
  process.env.ATLAS_HOME = atlasHome
})

afterEach(async () => {
  if (previousAtlasHome === undefined) delete process.env.ATLAS_HOME
  else process.env.ATLAS_HOME = previousAtlasHome
  await rm(atlasHome, { recursive: true, force: true })
})

const failingClaudeCodeSource = (): ClaudeCodeSource =>
  new ClaudeCodeSource({
    read: async () => {
      throw new CloudError('Atlas Cloud is unreachable')
    },
    write: async () => {},
  })

describe('bindAccounts', () => {
  it('reports a cloud outage through the notice port instead of failing composition', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, { useValue: failingClaudeCodeSource() })
    const recorded: RecordedNotices = recordingNotices()

    await bindAccounts({
      container,
      env: {},
      notice: recorded.port,
      cloudRequired: false,
      cloudUrl: undefined,
      clientVersion: 'account-bindings-spec',
    })

    const posted = recorded.posts.find((post) => post.key === 'cloud:accounts')
    expect(posted?.tone).toBe(ENoticeTone.Warn)
    expect(posted?.text).toContain('Atlas Cloud accounts could not be reconciled')
  })

  it('rethrows a failure that is not a cloud outage', async () => {
    const container = createHarnessContainer()
    container.register(ClaudeCodeSourceToken, {
      useValue: new ClaudeCodeSource({
        read: async () => {
          throw new Error('the vault caught fire')
        },
        write: async () => {},
      }),
    })

    await expect(
      bindAccounts({
        container,
        env: {},
        notice: recordingNotices().port,
        cloudRequired: false,
        cloudUrl: undefined,
        clientVersion: 'account-bindings-spec',
      }),
    ).rejects.toThrow('the vault caught fire')
  })
})
