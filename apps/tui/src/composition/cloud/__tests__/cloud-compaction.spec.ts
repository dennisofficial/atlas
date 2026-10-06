import { describe, expect, it } from 'bun:test'

import { ECompactionAnchor, EExecutionLocation } from '@dltech/atlas-core'
import { ECompaction, ECompactScope, EClientRequest, RemoteCompaction } from '@dltech/atlas-harness'

import { cloudApp, cloudRuntimeParts } from '../cloud-app'
import { fakeApp, scriptedModelPort } from '../../__tests__/fake-app'
import { appOf, localBindingOf } from '../../session-binding'
import { fakeBridge, CLOUD_THREAD, type FakeCloudChannel } from './fixture'

const attached = () => {
  const bridge = fakeBridge()
  const app = fakeApp({ model: scriptedModelPort({ script: { thinking: '', reply: 'ok' } }) })
  const { stores } = bridge.attach({ threadId: CLOUD_THREAD, url: 'https://sandbox.example', token: 'tok' })
  const channel: FakeCloudChannel = bridge.channel
  const answers = new Map<EClientRequest, unknown>()
  const delegate = channel.request.bind(channel)
  channel.request = async (given) => {
    const recorded = await delegate(given)
    return answers.has(given.op) ? answers.get(given.op) : recorded
  }
  return { app, channel, stores, answers }
}

describe('the compaction a cloud thread carries', () => {
  it('is a RemoteCompaction bound to the sandbox channel', () => {
    const { app, channel, stores } = attached()

    const parts = cloudRuntimeParts({ channel, stores, runner: app.runner })

    expect(parts.compaction).toBeInstanceOf(RemoteCompaction)
  })

  it('reaches the derived cloud app, replacing the host compaction', () => {
    const { app, channel, stores } = attached()

    const derived = cloudApp({ app, channel, stores, runner: app.runner })

    expect(derived.compaction).toBeInstanceOf(RemoteCompaction)
  })

  it('sends a compact request to the sandbox and returns its answer', async () => {
    const { app, channel, stores, answers } = attached()
    answers.set(EClientRequest.CompactHistory, { type: 'compacted', replaced: 4, fromSeq: 1, throughSeq: 4 })
    const port = cloudRuntimeParts({ channel, stores, runner: app.runner }).compaction

    const compaction = await port?.compact({ threadId: CLOUD_THREAD, scope: ECompactScope.Everything })

    expect(compaction).toEqual({ type: ECompaction.Compacted, replaced: 4, fromSeq: 1, throughSeq: 4 })
    expect(channel.requests.filter((sent) => sent.op === EClientRequest.CompactHistory)).toMatchObject([
      { params: { threadId: CLOUD_THREAD, scope: 'everything' } },
    ])
  })

  it('sends a summarise request with the anchor and seq', async () => {
    const { app, channel, stores, answers } = attached()
    answers.set(EClientRequest.SummariseHistory, { type: 'nothing' })
    const port = cloudRuntimeParts({ channel, stores, runner: app.runner }).compaction

    const compaction = await port?.summarise({
      threadId: CLOUD_THREAD,
      anchor: ECompactionAnchor.Suffix,
      seq: 7,
    })

    expect(compaction).toEqual({ type: ECompaction.Nothing })
    expect(channel.requests.filter((sent) => sent.op === EClientRequest.SummariseHistory)).toMatchObject([
      { params: { threadId: CLOUD_THREAD, anchor: 'suffix', seq: 7 } },
    ])
  })
})

describe('which compaction the surface selects', () => {
  it('selects the remote one through appOf for a cloud binding and the host one for a local binding', () => {
    const { app, channel, stores } = attached()
    const parts = cloudRuntimeParts({ channel, stores, runner: app.runner })

    const local = localBindingOf({
      local: app,
      workspace: { workspace: '/work', repo: null },
      opened: {
        threadId: CLOUD_THREAD,
        events: [],
        turns: [],
        name: null,
        started: false,
        executionLocation: EExecutionLocation.Host,
      },
    })

    expect(local.adapters.compaction).toBe(app.compaction)
    expect(appOf({ local: app, binding: local }).compaction).toBe(app.compaction)
    expect(parts.compaction).toBeInstanceOf(RemoteCompaction)
  })
})
