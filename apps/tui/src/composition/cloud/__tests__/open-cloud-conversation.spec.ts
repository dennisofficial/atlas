import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toThreadId } from '@dltech/atlas-core'

import { openCloudConversation } from '../cloud-app'
import { fakeBridge } from './fixture'
import { SPEC_SHARD } from '../../__tests__/fake-backend'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'

const UNWRITTEN = toThreadId(`never-written-${SPEC_SHARD}`)

describe('openCloudConversation on a blank remote thread', () => {
  it('still answers a cloud conversation — a first lift has nothing in the sandbox store yet', async () => {
    const bridge = fakeBridge()
    const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
    const { stores } = bridge.attach({ threadId: UNWRITTEN, url: 'https://sandbox.example', token: 'tok' })
    const attached = { ...app, threads: stores.threads, log: stores.log, ledger: stores.ledger }

    const opened = await openCloudConversation({ app: attached, threadId: UNWRITTEN })

    expect(opened.threadId).toBe(UNWRITTEN)
    expect(opened.started).toBe(false)
    expect(opened.executionLocation).toBe(EExecutionLocation.Cloud)
  })
})
