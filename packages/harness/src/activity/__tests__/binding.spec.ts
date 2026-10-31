import { describe, expect, it } from 'bun:test'

import { EDecision, toCallId, toEventId, toRunId, toThreadId, type Event } from '@dltech/atlas-core'
import { EAgentStatus, EStepEnd, EShellStatus, type RosterWire } from '@dltech/atlas-wire'

import { createDeltaChannel } from '../../channel/delta-channel'
import { bindThreadActivity, type ActivityReport } from '../index'

const threadId = toThreadId('root')
const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve()
}

const arrange = (initial: RosterWire = { agents: [], shells: [], services: [] }) => {
  const reports: ActivityReport[] = []
  const order: string[] = []
  const listeners = new Set<() => void>()
  let current = initial
  const channel = createDeltaChannel()
  const binding = bindThreadActivity({
    threadId,
    log: {
      head: async () => {
        order.push('head')
        return 0
      },
      readOwn: async () => [],
    },
    channel: {
      subscribe: (args) => {
        order.push('channel')
        const unsubscribe = channel.subscribe(args)
        return () => {
          order.push('detach-channel')
          unsubscribe()
        }
      },
    },
    roster: {
      snapshot: () => {
        order.push('snapshot')
        return current
      },
      subscribe: (listener) => {
        order.push('roster')
        listeners.add(listener)
        return () => {
          order.push('detach-roster')
          listeners.delete(listener)
        }
      },
    },
    report: (state) => reports.push(state),
  })
  return {
    binding,
    reports,
    order,
    channel,
    listeners,
    change: (next: RosterWire) => {
      current = next
      for (const listener of listeners) listener()
    },
  }
}

describe('thread activity binding', () => {
  it('combines refreshed own-log approval with live input precedence', async () => {
    const stored: Event[] = [
      {
        id: toEventId('request'),
        seq: 2,
        threadId,
        runId: toRunId('run'),
        depth: 0,
        at: '2026-10-31T00:00:00Z',
        type: 'approval-requested',
        callId: toCallId('call'),
        reason: 'permission',
      },
    ]
    const reports: ActivityReport[] = []
    const channel = createDeltaChannel()
    const binding = bindThreadActivity({
      threadId,
      channel,
      log: {
        head: async () => stored.at(-1)?.seq ?? 0,
        readOwn: async ({ fromSeq }) => stored.filter((event) => event.seq > (fromSeq ?? 0)),
      },
      report: (state) => reports.push(state),
    })
    binding.tracker.turnStarted()
    await flush()
    const publisher = channel.publisherFor({ threadId })
    publisher.operatorInput({ open: { requestId: 'input', description: 'Code', path: '/code' } })
    stored.push({
      id: toEventId('answer'),
      seq: 4,
      threadId,
      runId: toRunId('run'),
      depth: 0,
      at: '2026-10-31T00:00:01Z',
      type: 'approval-answered',
      callId: toCallId('call'),
      decision: EDecision.Allow,
    })
    publisher.eventsAppended()
    await flush()
    publisher.operatorInput({ open: null })
    expect(reports).toEqual([
      { working: true, awaiting: null },
      { working: true, awaiting: 'approval' },
      { working: true, awaiting: 'input' },
      { working: true, awaiting: 'input' },
      { working: true, awaiting: null },
    ])
    binding.detach()
  })

  it('holds working between turns until the running agent settles', () => {
    const h = arrange()
    h.binding.tracker.turnStarted()
    h.change({
      agents: [{ status: EAgentStatus.Running } as RosterWire['agents'][number]],
      shells: [],
      services: [],
    })
    h.binding.tracker.turnEnded()
    expect(h.reports.at(-1)).toEqual({ working: true, awaiting: null })
    h.change({
      agents: [{ status: EAgentStatus.Finished } as RosterWire['agents'][number]],
      shells: [],
      services: [],
    })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null })
  })

  it('ignores services, settled shells and non-running agents', () => {
    const h = arrange({
      agents: [{ status: EAgentStatus.Paused } as RosterWire['agents'][number]],
      shells: [{ status: EShellStatus.Exited } as RosterWire['shells'][number]],
      services: [{ status: 'running' } as RosterWire['services'][number]],
    })
    expect(h.reports).toEqual([])
  })

  it('leaves root lifecycle to the driver and filters input by thread', () => {
    const h = arrange()
    const publisher = h.channel.publisherFor({ threadId })
    publisher.turnWorking({ working: true })
    expect(h.reports).toEqual([])
    h.channel.publisherFor({ threadId: toThreadId('child') }).operatorInput({
      open: { requestId: 'input', description: 'Code', path: '/code' },
    })
    expect(h.reports).toEqual([])
    publisher.operatorInput({ open: { requestId: 'input', description: 'Code', path: '/code' } })
    expect(h.reports).toEqual([{ working: false, awaiting: 'input' }])
    publisher.operatorInput({ open: null })
    expect(h.reports.at(-1)).toEqual({ working: false, awaiting: null })
    h.binding.detach()
    publisher.operatorInput({ open: { requestId: 'later', description: 'Code', path: '/code' } })
    expect(h.reports).toHaveLength(2)
    expect(h.listeners.size).toBe(0)
    expect(h.order.slice(-2)).toEqual(['detach-channel', 'detach-roster'])
  })

  it('refreshes approval on appended events and step ends without a roster', async () => {
    let reads = 0
    const channel = createDeltaChannel()
    const reports: ActivityReport[] = []
    const binding = bindThreadActivity({
      threadId,
      channel,
      log: {
        head: async () => {
          reads += 1
          return 0
        },
        readOwn: async () => [],
      },
      report: (state) => reports.push(state),
    })
    await flush()
    channel.publisherFor({ threadId }).eventsAppended()
    await flush()
    channel.publisherFor({ threadId }).close({ end: EStepEnd.Failed })
    await flush()
    expect(reads).toBe(3)
    expect(reports).toEqual([])
    binding.detach()
  })

  it('subscribes and reads background before the queued initial approval refresh', async () => {
    const h = arrange({
      agents: [],
      shells: [{ status: EShellStatus.Running } as RosterWire['shells'][number]],
      services: [],
    })
    expect(h.order).toEqual(['channel', 'roster', 'snapshot'])
    expect(h.reports).toEqual([{ working: true, awaiting: null }])
    await flush()
    expect(h.order).toEqual(['channel', 'roster', 'snapshot', 'head'])
  })
})
