import { describe, expect, it } from 'bun:test'

import { EAgentStatus, toThreadId, type ThreadId } from '@dltech/atlas-core'
import type { RecoveredAgents } from '@dltech/atlas-harness'

import { settleLostShellsInBackground } from '../serve-background'
import { EServeEvent, type ServeLogLine } from '../serve-log'

const noop = (): void => undefined

const parent = toThreadId('brn_parent000-0000-0000-0000-000000000001')
const lostTeammate = toThreadId('brn_11999363-f6af-4af3-9482-b201999c2c74')

const recoveredWith = (settled: readonly ThreadId[]): RecoveredAgents => ({
  settled: settled.map((agentId) => ({
    agentId,
    spawnedBy: parent,
    agentType: 'teammate',
    intent: 'Remove legacy harness.db importer',
    status: EAgentStatus.Stopped,
    turns: 0,
    toolCalls: 0,
    lastTool: undefined,
    startedAt: '2026-10-04T00:27:53.245Z',
    endedAt: '2026-10-04T00:43:21.277Z',
  })),
  unlogged: [],
})

describe('settling lost agents at serve boot', () => {
  it('settles lost agents and logs them, so a transferred teammate stops reading as a ghost', async () => {
    const events: ServeLogLine[] = []
    const asked: ThreadId[] = []
    const settling = { count: 0 }

    await settleLostShellsInBackground({
      app: {
        recordLostAgents: async ({ threadId }) => {
          asked.push(threadId)
          return recoveredWith([lostTeammate])
        },
      },
      threadId: parent,
      log: (line) => events.push(line),
      settling,
      note: noop,
    })

    expect(asked).toEqual([parent])
    expect(events.map((line) => line.event)).toEqual([EServeEvent.LostAgentsSettled])
    expect(events[0]?.['agentIds']).toEqual([lostTeammate])
    expect(settling.count).toBe(0)
  })

  it('logs nothing when there are no lost agents to settle', async () => {
    const events: ServeLogLine[] = []

    await settleLostShellsInBackground({
      app: { recordLostAgents: async () => recoveredWith([]) },
      threadId: parent,
      log: (line) => events.push(line),
      settling: { count: 0 },
      note: noop,
    })

    expect(events).toEqual([])
  })

  it('runs without a recordLostAgents port, as a fake serves it', async () => {
    const events: ServeLogLine[] = []

    await settleLostShellsInBackground({
      app: {},
      threadId: parent,
      log: (line) => events.push(line),
      settling: { count: 0 },
      note: noop,
    })

    expect(events).toEqual([])
  })

  it('reports a settlement failure on its own event without swallowing it', async () => {
    const events: ServeLogLine[] = []

    const failure = settleLostShellsInBackground({
      app: {
        recordLostAgents: async () => {
          throw new Error('the roster store is unreadable')
        },
      },
      threadId: parent,
      log: (line) => events.push(line),
      settling: { count: 0 },
      note: noop,
    })

    await expect(failure).rejects.toThrow('the roster store is unreadable')
    expect(events.map((line) => line.event)).toEqual([EServeEvent.LostAgentSettlementFailed])
  })
})
