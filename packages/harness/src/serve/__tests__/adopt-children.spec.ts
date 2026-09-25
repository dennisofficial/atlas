import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EKilledBy,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type Event,
  type EventDraft,
  type EventLogPort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { AgentOutcome } from '../../agents/registry/port'
import type { AgentSnapshot } from '../../agents/registry/snapshot'
import { adoptChildren } from '../adopt-children'

const eventsFrom = (args: {
  threadId: ThreadId
  drafts: readonly EventDraft[]
}): readonly Event[] =>
  stampDrafts({
    drafts: args.drafts,
    envelopes: args.drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: args.threadId,
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const snapshotOf = (args: { agentId: ThreadId; spawnedBy: ThreadId }): AgentSnapshot => ({
  agentId: args.agentId,
  spawnedBy: args.spawnedBy,
  agentType: 'explore',
  intent: 'look around',
  status: EAgentStatus.Stopped,
  turns: 1,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: '2026-01-01T00:00:00.000Z',
  endedAt: undefined,
})

type FakeAgents = {
  hydrated: ThreadId[]
  resumed: { agentId: ThreadId; threadId: ThreadId }[]
  agents: {
    hydrate: (args: { threadId: ThreadId }) => Promise<void>
    list: (args: { threadId: ThreadId }) => readonly AgentSnapshot[]
    resume: (args: { agentId: ThreadId; threadId: ThreadId }) => Promise<AgentOutcome>
  }
}

const fakeAgents = (args: {
  children: readonly AgentSnapshot[]
  outcome?: (agentId: ThreadId) => AgentOutcome
}): FakeAgents => {
  const hydrated: ThreadId[] = []
  const resumed: { agentId: ThreadId; threadId: ThreadId }[] = []

  return {
    hydrated,
    resumed,
    agents: {
      hydrate: async ({ threadId }) => {
        hydrated.push(threadId)
      },
      list: () => args.children,
      resume: async ({ agentId, threadId }) => {
        resumed.push({ agentId, threadId })
        return (
          args.outcome?.(agentId) ?? {
            ok: true,
            snapshot:
              args.children.find((child) => child.agentId === agentId) ??
              snapshotOf({ agentId, spawnedBy: threadId }),
          }
        )
      },
    },
  }
}

const fakeLog = (byChild: Record<string, readonly Event[]>): Pick<EventLogPort, 'readOwn'> => ({
  readOwn: async ({ threadId }) => [...(byChild[threadId] ?? [])],
})

describe('adopting a thread\'s children on session start', () => {
  it('hydrates the roster before reading anything', async () => {
    const parent = toThreadId('thread-parent')
    const fake = fakeAgents({ children: [] })

    await adoptChildren({ agents: fake.agents, log: fakeLog({}), threadId: parent })

    expect(fake.hydrated).toEqual([parent])
  })

  it('resumes a child whose durable log was cut short mid-turn, and reports its id', async () => {
    const parent = toThreadId('thread-parent')
    const childId = toThreadId('thread-child')
    const fake = fakeAgents({ children: [snapshotOf({ agentId: childId, spawnedBy: parent })] })
    const log = fakeLog({
      [childId]: eventsFrom({
        threadId: childId,
        drafts: [
          {
            type: 'assistant-said',
            parts: [{ type: 'text', text: 'cut off mid-' }],
            interrupted: true,
          },
        ],
      }),
    })

    const resumed = await adoptChildren({ agents: fake.agents, log, threadId: parent })

    expect(resumed).toEqual([childId])
    expect(fake.resumed).toEqual([{ agentId: childId, threadId: parent }])
  })

  it('leaves a child whose log carries no interruption alone', async () => {
    const parent = toThreadId('thread-parent')
    const childId = toThreadId('thread-child')
    const fake = fakeAgents({ children: [snapshotOf({ agentId: childId, spawnedBy: parent })] })
    const log = fakeLog({
      [childId]: eventsFrom({
        threadId: childId,
        drafts: [{ type: 'assistant-said', parts: [{ type: 'text', text: 'all done' }] }],
      }),
    })

    const resumed = await adoptChildren({ agents: fake.agents, log, threadId: parent })

    expect(resumed).toEqual([])
    expect(fake.resumed).toEqual([])
  })

  it('does not count a resumable child whose resume the registry refused', async () => {
    const parent = toThreadId('thread-parent')
    const childId = toThreadId('thread-child')
    const fake = fakeAgents({
      children: [snapshotOf({ agentId: childId, spawnedBy: parent })],
      outcome: () => ({ ok: false, reason: 'already stepping' }),
    })
    const log = fakeLog({
      [childId]: eventsFrom({
        threadId: childId,
        drafts: [
          {
            type: 'assistant-said',
            parts: [{ type: 'text', text: 'cut off mid-' }],
            interrupted: true,
          },
        ],
      }),
    })

    const resumed = await adoptChildren({ agents: fake.agents, log, threadId: parent })

    expect(resumed).toEqual([])
    expect(fake.resumed).toEqual([{ agentId: childId, threadId: parent }])
  })

  it('never resumes a child the roster carries as terminal, however resumable its own log reads', async () => {
    const parent = toThreadId('thread-parent')
    const stopped = toThreadId('thread-stopped')
    const finishedId = toThreadId('thread-finished')
    const fake = fakeAgents({
      children: [
        {
          ...snapshotOf({ agentId: stopped, spawnedBy: parent }),
          status: EAgentStatus.Stopped,
          killedBy: EKilledBy.User,
          endedAt: '2026-01-01T00:01:00.000Z',
        },
        {
          ...snapshotOf({ agentId: finishedId, spawnedBy: parent }),
          status: EAgentStatus.Finished,
          endedAt: '2026-01-01T00:02:00.000Z',
        },
      ],
    })
    const log = fakeLog({
      [stopped]: eventsFrom({
        threadId: stopped,
        drafts: [
          { type: 'assistant-said', parts: [{ type: 'text', text: 'cut' }], interrupted: true },
        ],
      }),
      [finishedId]: eventsFrom({
        threadId: finishedId,
        drafts: [{ type: 'tool-called', callId: toCallId('call-9'), name: 'bash', ordinal: 0 }],
      }),
    })

    const resumed = await adoptChildren({ agents: fake.agents, log, threadId: parent })

    expect(resumed).toEqual([])
    expect(fake.resumed).toEqual([])
  })

  it('resumes every resumable child of the thread, in listing order', async () => {
    const parent = toThreadId('thread-parent')
    const first = toThreadId('thread-child-1')
    const second = toThreadId('thread-child-2')
    const fake = fakeAgents({
      children: [
        snapshotOf({ agentId: first, spawnedBy: parent }),
        snapshotOf({ agentId: second, spawnedBy: parent }),
      ],
    })
    const log = fakeLog({
      [first]: eventsFrom({
        threadId: first,
        drafts: [
          { type: 'assistant-said', parts: [{ type: 'text', text: 'cut' }], interrupted: true },
        ],
      }),
      [second]: eventsFrom({
        threadId: second,
        drafts: [{ type: 'tool-called', callId: toCallId('call-1'), name: 'bash', ordinal: 0 }],
      }),
    })

    const resumed = await adoptChildren({ agents: fake.agents, log, threadId: parent })

    expect(resumed).toEqual([first, second])
  })
})
