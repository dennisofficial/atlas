import { describe, expect, it } from 'bun:test'

import {
  EExecutionLocation,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type ThreadId,
} from '@dltech/atlas-core'
import { EClientRequest, RemoteEventLog, RemoteThreadStore, type CloudChannel } from '@dltech/atlas-harness'

import { openCloudConversation } from '../cloud-app'
import type { AtlasApp } from '../../compose'
import { fakeBridge } from './fixture'
import { SPEC_SHARD } from '../../__tests__/fake-backend'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'

const UNWRITTEN = toThreadId(`never-written-${SPEC_SHARD}`)
const LIFTED = toThreadId(`lifted-${SPEC_SHARD}`)

const saidOn = (args: { threadId: ThreadId; text: string; seq: number }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`e-${args.seq}`),
  seq: args.seq,
  threadId: args.threadId,
  runId: toRunId('r1'),
  depth: 0,
  at: '2026-08-24T00:00:00.000Z',
})

const wireEventOf = (event: Event): Record<string, unknown> => {
  const { id, threadId, seq, runId, depth, at, ...body } = event
  return { id, threadId, seq, runId, depth, at, type: event.type, body: JSON.stringify(body) }
}

const wireThreadOf = (args: {
  threadId: ThreadId
  title?: string | undefined
}): Record<string, unknown> => ({
  id: args.threadId,
  head: 2,
  createdAt: '2026-08-24T00:00:00.000Z',
  updatedAt: '2026-08-24T00:00:00.000Z',
  workspace: '/repo',
  repo: null,
  ...(args.title === undefined ? {} : { title: args.title }),
})

const cloudAppOn = (args: { threadId: ThreadId }) => {
  const bridge = fakeBridge()
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  const { channel, stores } = bridge.attach({
    threadId: args.threadId,
    url: 'https://sandbox.example',
    token: 'tok',
  })
  const attached: AtlasApp = { ...app, threads: stores.threads, log: stores.log, ledger: stores.ledger }
  return { channel, app: attached }
}

const withRemoteReads = (args: { app: AtlasApp; channel: CloudChannel }): AtlasApp => ({
  ...args.app,
  threads: new RemoteThreadStore({ channel: args.channel }),
  log: new RemoteEventLog({ channel: args.channel }),
})

describe('openCloudConversation on a blank remote thread', () => {
  it('still answers a cloud conversation — a first lift has nothing in the sandbox store yet', async () => {
    const { app } = cloudAppOn({ threadId: UNWRITTEN })

    const opened = await openCloudConversation({ app, threadId: UNWRITTEN })

    expect(opened.threadId).toBe(UNWRITTEN)
    expect(opened.started).toBe(false)
    expect(opened.executionLocation).toBe(EExecutionLocation.Cloud)
  })
})

describe('openCloudConversation on a remote read failure', () => {
  it('propagates a dropped thread read to the caller instead of blanking the transcript', async () => {
    const { app, channel } = cloudAppOn({ threadId: LIFTED })
    const transport = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.ReadThread) throw new Error('socket dropped mid-read')
      return transport(given)
    }

    await expect(
      openCloudConversation({ app: withRemoteReads({ app, channel }), threadId: LIFTED }),
    ).rejects.toThrow('socket dropped mid-read')
  })

  it('propagates a dropped event read once the thread exists remotely', async () => {
    const { app, channel } = cloudAppOn({ threadId: LIFTED })
    const transport = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.ReadThread) {
        return { thread: wireThreadOf({ threadId: LIFTED }) }
      }
      if (given.op === EClientRequest.ReadEvents) throw new Error('socket dropped mid-read')
      return transport(given)
    }

    await expect(
      openCloudConversation({ app: withRemoteReads({ app, channel }), threadId: LIFTED }),
    ).rejects.toThrow('socket dropped mid-read')
  })

  it('still answers the existing transcript when every read succeeds', async () => {
    const { app, channel } = cloudAppOn({ threadId: LIFTED })
    const events = [
      saidOn({ threadId: LIFTED, text: 'work done before the failure', seq: 1 }),
      saidOn({ threadId: LIFTED, text: 'and the follow-up', seq: 2 }),
    ]
    const transport = channel.request.bind(channel)
    channel.request = async (given) => {
      if (given.op === EClientRequest.ReadThread) {
        return { thread: wireThreadOf({ threadId: LIFTED, title: 'kept conversation' }) }
      }
      if (given.op === EClientRequest.ReadEvents) return { events: events.map(wireEventOf) }
      return transport(given)
    }

    const opened = await openCloudConversation({
      app: withRemoteReads({ app, channel }),
      threadId: LIFTED,
    })

    expect(opened.started).toBe(true)
    expect(opened.name).toBe('kept conversation')
    expect(opened.executionLocation).toBe(EExecutionLocation.Cloud)
    expect(opened.events).toHaveLength(2)
  })
})
