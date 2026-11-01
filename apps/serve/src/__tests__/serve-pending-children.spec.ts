import { describe, expect, it } from 'bun:test'
import { EAgentStatus, toThreadId, type Event } from '@dltech/atlas-core'
import type { AgentSnapshot } from '@dltech/atlas-harness'

import { wakeChildrenWithPendingInput } from '../serve-pending-children'
import { EServeEvent, type ServeLog } from '../serve-log'

const ROOT = toThreadId('thr-root')
const CHILD = toThreadId('thr-child')
const GRANDCHILD = toThreadId('thr-grandchild')

const agent = (args: {
  agentId: string
  spawnedBy: string
  status: EAgentStatus
  killedBy?: AgentSnapshot['killedBy']
}): AgentSnapshot => ({
  agentId: toThreadId(args.agentId),
  spawnedBy: toThreadId(args.spawnedBy),
  agentType: 'teammate',
  intent: 'help',
  status: args.status,
  ...(args.killedBy === undefined ? {} : { killedBy: args.killedBy }),
  turns: 1,
  toolCalls: 0,
  lastTool: undefined,
  startedAt: '2026-11-01T00:00:00.000Z',
  endedAt: args.status === EAgentStatus.Running ? undefined : '2026-11-01T00:01:00.000Z',
})

const said = (text: string): Event =>
  ({ seq: 1, type: 'user-said', text, depth: 0 }) as unknown as Event

const answered = (): Event =>
  ({ seq: 2, type: 'assistant-said', parts: [{ type: 'text', text: 'done' }] }) as unknown as Event

const fixture = (args: { agents: AgentSnapshot[]; logs: Map<string, Event[]> }) => {
  const woken: string[] = []
  const lines: Parameters<ServeLog>[0][] = []
  const app = {
    log: {
      readOwn: async (given: { threadId: string }) => args.logs.get(given.threadId) ?? [],
    },
    roster: {
      snapshot: () => ({ shells: [], agents: args.agents, services: [] }),
    },
    agents: {
      wake: async (given: { agentId: string }) => {
        woken.push(given.agentId)
        return { ok: true as const, snapshot: args.agents[0] as AgentSnapshot }
      },
    },
  }
  const log: ServeLog = (line) => void lines.push(line)
  return { app, woken, lines, log }
}

describe('wakeChildrenWithPendingInput', () => {
  it('wakes a settled child whose log ends on an unanswered message', async () => {
    const test = fixture({
      agents: [agent({ agentId: CHILD, spawnedBy: ROOT, status: EAgentStatus.Stopped })],
      logs: new Map([[CHILD, [answered(), said('while you were parked')]]]),
    })

    const woken = await wakeChildrenWithPendingInput({
      app: test.app as never,
      threadId: ROOT,
      log: test.log,
    })

    expect(woken).toEqual([CHILD])
    expect(test.woken).toEqual([CHILD])
    expect(test.lines.map((line) => line.event)).toEqual([EServeEvent.PendingChildInputWoken])
  })

  it('leaves a running child alone — it is mid-turn on exactly that input', async () => {
    const test = fixture({
      agents: [agent({ agentId: CHILD, spawnedBy: ROOT, status: EAgentStatus.Running })],
      logs: new Map([[CHILD, [said('already being run')]]]),
    })

    expect(
      await wakeChildrenWithPendingInput({ app: test.app as never, threadId: ROOT, log: test.log }),
    ).toEqual([])
    expect(test.woken).toEqual([])
  })

  it('leaves a settled child whose last message was answered alone', async () => {
    const test = fixture({
      agents: [agent({ agentId: CHILD, spawnedBy: ROOT, status: EAgentStatus.Stopped })],
      logs: new Map([[CHILD, [said('hi'), answered()]]]),
    })

    expect(
      await wakeChildrenWithPendingInput({ app: test.app as never, threadId: ROOT, log: test.log }),
    ).toEqual([])
  })

  it('wakes a settled grandchild of the family too', async () => {
    const test = fixture({
      agents: [
        agent({ agentId: CHILD, spawnedBy: ROOT, status: EAgentStatus.Stopped }),
        agent({ agentId: GRANDCHILD, spawnedBy: CHILD, status: EAgentStatus.Stopped }),
      ],
      logs: new Map([[GRANDCHILD, [said('queued for you')]]]),
    })

    const woken = await wakeChildrenWithPendingInput({
      app: test.app as never,
      threadId: ROOT,
      log: test.log,
    })

    expect(woken).toEqual([GRANDCHILD])
  })

  it('does nothing without a roster or steer port', async () => {
    const log: ServeLog = () => undefined
    const app = { log: { readOwn: async () => [] } }

    expect(await wakeChildrenWithPendingInput({ app: app as never, threadId: ROOT, log })).toEqual(
      [],
    )
  })
})
