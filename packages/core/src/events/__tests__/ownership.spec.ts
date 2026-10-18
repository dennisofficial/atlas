import { describe, expect, it } from 'bun:test'

import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import { toEventId, toRunId, toThreadId } from '../ids'
import { EOwnedUnitKind, liveOwnedUnits, rowsOwnedBy } from '../ownership'
import type { Event } from '../envelope'

const PARENT = toThreadId('parent-thread')
const CHILD = toThreadId('child-thread')

const said = (args: { threadId: string; seq: number; text: string }): Event => ({
  type: 'user-said',
  text: args.text,
  id: toEventId(`event-${args.seq}`),
  seq: args.seq,
  threadId: toThreadId(args.threadId),
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-01-01T00:00:00.000Z',
})

describe('rowsOwnedBy', () => {
  it('keeps every row of a thread that inherited nothing', () => {
    const events = [
      said({ threadId: CHILD, seq: 1, text: 'one' }),
      said({ threadId: CHILD, seq: 2, text: 'two' }),
    ]

    expect(rowsOwnedBy({ events, threadId: CHILD })).toEqual(events)
  })

  it('drops the rows a child only reads through its parent', () => {
    const events = [
      said({ threadId: PARENT, seq: 1, text: 'the parent said this' }),
      said({ threadId: CHILD, seq: 2, text: 'the brief' }),
    ]

    expect(rowsOwnedBy({ events, threadId: CHILD }).map((event) => event.seq)).toEqual([2])
  })

  it('keeps the order the composed read handed over', () => {
    const events = [
      said({ threadId: CHILD, seq: 1, text: 'one' }),
      said({ threadId: PARENT, seq: 2, text: 'inherited' }),
      said({ threadId: CHILD, seq: 3, text: 'three' }),
    ]

    expect(rowsOwnedBy({ events, threadId: CHILD }).map((event) => event.seq)).toEqual([1, 3])
  })

  it('answers with nothing when the thread owns nothing yet', () => {
    expect(
      rowsOwnedBy({ events: [said({ threadId: PARENT, seq: 1, text: 'one' })], threadId: CHILD }),
    ).toEqual([])
  })
})

const draftsAsEvents = (drafts: readonly EventDraft[]): Event[] =>
  drafts.map((draft, index) => ({
    ...draft,
    id: toEventId(`owned-${index + 1}`),
    seq: index + 1,
    threadId: toThreadId('thread-1'),
    runId: toRunId('run-1'),
    depth: 0,
    at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
  }))

const shellStarted = (shellId: string): EventDraft => ({
  type: 'background-shell-started',
  shellId,
  command: 'sleep 60',
})

const shellEnded = (shellId: string): EventDraft => ({
  type: 'background-shell-ended',
  shellId,
  command: 'sleep 60',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const serviceStarted = (serviceId: string): EventDraft => ({
  type: 'service-started',
  serviceId,
  command: 'bun run dev',
})

const serviceEnded = (serviceId: string): EventDraft => ({
  type: 'service-ended',
  serviceId,
  command: 'bun run dev',
  status: EServiceStatus.Exited,
  tail: '',
})

const agentSpawned = (args: { agentId: string; agentType?: string }): EventDraft => ({
  type: 'agent-spawned',
  agentId: toThreadId(args.agentId),
  agentType: args.agentType ?? 'builder',
  intent: 'do the thing',
  mode: EAgentStart.Fresh,
})

const agentEnded = (agentId: string): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId(agentId),
  agentType: 'builder',
  intent: 'do the thing',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 0,
})

describe('liveOwnedUnits', () => {
  it('answers with nothing for a log that starts no units', () => {
    expect(liveOwnedUnits([said({ threadId: 'thread-1', seq: 1, text: 'hi' })])).toEqual({
      shells: [],
      services: [],
      agents: [],
    })
  })

  it('keeps a started unit live until its matching ending', () => {
    const events = draftsAsEvents([
      shellStarted('bash_1'),
      serviceStarted('svc-1'),
      agentSpawned({ agentId: 'child-1' }),
      shellEnded('bash_1'),
    ])

    const units = liveOwnedUnits(events)
    expect(units.shells).toEqual([])
    expect(units.services.map((unit) => unit.serviceId)).toEqual(['svc-1'])
    expect(units.agents.map((unit) => unit.agentId)).toEqual([toThreadId('child-1')])
  })

  it('carries the seq of the start that still stands, per unit', () => {
    const events = draftsAsEvents([
      shellStarted('bash_1'),
      serviceStarted('svc-1'),
      agentSpawned({ agentId: 'child-1' }),
    ])

    const units = liveOwnedUnits(events)
    expect(units.shells.map((unit) => unit.startedSeq)).toEqual([1])
    expect(units.services.map((unit) => unit.startedSeq)).toEqual([2])
    expect(units.agents.map((unit) => unit.startedSeq)).toEqual([3])
  })

  it('treats a unit restarted under the same id as live with the latest start', () => {
    const events = draftsAsEvents([
      shellStarted('bash_1'),
      shellEnded('bash_1'),
      shellStarted('bash_1'),
    ])

    expect(liveOwnedUnits(events).shells).toEqual([
      { kind: EOwnedUnitKind.Shell, shellId: 'bash_1', startedSeq: 3 },
    ])
  })

  it('ignores an ending for a unit the log never started', () => {
    const events = draftsAsEvents([shellEnded('bash_ghost'), serviceEnded('svc-ghost'), agentEnded('ghost')])

    expect(liveOwnedUnits(events)).toEqual({ shells: [], services: [], agents: [] })
  })

  it('marks a teammate agent without mixing it up with a sub-agent', () => {
    const events = draftsAsEvents([
      agentSpawned({ agentId: 'child-1', agentType: 'teammate' }),
      agentSpawned({ agentId: 'child-2', agentType: 'builder' }),
    ])

    expect(liveOwnedUnits(events).agents.map((unit) => unit.isTeammate)).toEqual([true, false])
  })

  it('sees only what survives the prefix a rewind dropped', () => {
    const all = draftsAsEvents([
      shellStarted('bash_1'),
      shellStarted('bash_2'),
      shellEnded('bash_1'),
      shellEnded('bash_2'),
    ])
    const rewound = all.slice(2)

    expect(liveOwnedUnits(rewound).shells).toEqual([])
    expect(liveOwnedUnits(all.slice(0, 2)).shells.map((unit) => unit.shellId)).toEqual(['bash_1', 'bash_2'])
  })
})
