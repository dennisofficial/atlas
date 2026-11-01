import { describe, expect, it } from 'bun:test'

import { EAgentStatus, toThreadId, type OrphanedInput } from '@dltech/atlas-core'

import type { ServeApp } from '../serve-app'
import { RedeliveryDeferred } from '../serve-fork-resolution'
import { createRedeliveryHolder, redeliverThrough } from '../serve-redelivery'
import { fakeServeApp } from './fakes'
import { scratchTranscriptStore } from './transcript-store-fixture'

const root = toThreadId('thread-root')
const child = toThreadId('thread-child')
const input: OrphanedInput = { text: 'hmr?', requestId: 'Y' }

type FakeAgent = { status: EAgentStatus; steppingSince?: string }

const rosterOf = (agent: FakeAgent): NonNullable<ServeApp['roster']> => ({
  snapshot: () => ({
    agents: [
      {
        agentId: child,
        spawnedBy: root,
        agentType: 'agent',
        intent: 'work',
        turns: 0,
        toolCalls: 0,
        lastTool: undefined,
        startedAt: '2026-11-01T00:00:00.000Z',
        endedAt: undefined,
        ...agent,
      },
    ],
    shells: [],
    services: [],
  }),
  subscribe: () => () => undefined,
})

const build = (args: { busy: boolean; agent?: FakeAgent }) => {
  const said: OrphanedInput[] = []
  const store = scratchTranscriptStore({ prefix: 'redelivery' })
  const fake = fakeServeApp({ threadId: root, root: '/workspace', intake: true, log: store.log })
  const port = redeliverThrough({
    root,
    driver: {
      busy: () => args.busy,
      say: async (given) => {
        said.push(given)
      },
    },
    app: {
      agents: undefined,
      runner: fake.runner,
      log: store.log,
      ids: fake.ids,
      roster: args.agent === undefined ? undefined : rosterOf(args.agent),
    },
  })
  return { port, said }
}

describe('redeliverThrough', () => {
  it('lets the root redeliver only while the driver is idle', async () => {
    const idle = build({ busy: false })
    expect(idle.port.canRedeliverNow(root)).toBe(true)
    await idle.port.redeliver({ threadId: root, input })
    expect(idle.said).toEqual([input])
  })

  it('refuses a root redelivery when a turn started after the check, instead of enqueueing', async () => {
    const busy = build({ busy: true })
    expect(busy.port.canRedeliverNow(root)).toBe(false)
    await expect(busy.port.redeliver({ threadId: root, input })).rejects.toBeInstanceOf(
      RedeliveryDeferred,
    )
    expect(busy.said).toEqual([])
  })

  it('holds back a child that is stepping and one it cannot see', async () => {
    const stepping = build({
      busy: false,
      agent: { status: EAgentStatus.Running, steppingSince: '2026-11-01T00:00:00.000Z' },
    })
    expect(stepping.port.canRedeliverNow(child)).toBe(false)
    await expect(stepping.port.redeliver({ threadId: child, input })).rejects.toBeInstanceOf(
      RedeliveryDeferred,
    )
    expect(build({ busy: false }).port.canRedeliverNow(child)).toBe(false)
  })

  it('allows a settled child', () => {
    const settled = build({ busy: false, agent: { status: EAgentStatus.Finished } })
    expect(settled.port.canRedeliverNow(child)).toBe(true)
  })
})

describe('createRedeliveryHolder', () => {
  it('defers instead of blocking until a target is bound', async () => {
    const holder = createRedeliveryHolder()
    expect(holder.canRedeliverNow(root)).toBe(false)
    await expect(holder.redeliver({ threadId: root, input })).rejects.toBeInstanceOf(
      RedeliveryDeferred,
    )
    const said: OrphanedInput[] = []
    holder.bind({
      canRedeliverNow: () => true,
      redeliver: async (given) => {
        said.push(given.input)
      },
    })
    expect(holder.canRedeliverNow(root)).toBe(true)
    await holder.redeliver({ threadId: root, input })
    expect(said).toEqual([input])
  })
})
