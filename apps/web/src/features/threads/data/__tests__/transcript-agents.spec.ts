import { describe, expect, it } from 'bun:test'

import { EAgentStatus } from '@dltech/atlas-core'
import { EToolKind } from '@dltech/atlas-ui/ai/tool'
import type { RosterWire, WireEvent } from '@dltech/atlas-wire/web'

import { eventsFromWire } from '../events-from-wire'
import { reportItemsOf, rosterModelsOf, spawnDomId, spawnItemsOf } from '../transcript-agents'
import {
  durableTranscriptOf,
  ETranscriptKind,
  transcriptViewOf,
  type TranscriptRow,
} from '../transcript-items'
import { ETurnKind, turnsOf } from '../transcript-turns'

const AGENT = 'thr_child'

const wire = (seq: number, body: Record<string, unknown>): WireEvent => ({
  id: `evt_${seq}`,
  threadId: 'thr_1',
  seq,
  runId: 'run_1',
  depth: 0,
  at: `2026-10-22T10:00:${String(seq).padStart(2, '0')}.000Z`,
  type: String(body.type),
  body: JSON.stringify(body),
})

const said = (seq: number) => wire(seq, { type: 'user-said', text: 'go' })
const spawnCall = (seq: number) =>
  wire(seq, {
    type: 'tool-called',
    callId: 'call_s',
    name: 'agent_spawn',
    input: { agentType: 'explore', intent: 'vault audit', brief: 'Audit the vault' },
    ordinal: 0,
  })
const spawnResult = (seq: number) =>
  wire(seq, {
    type: 'tool-result',
    callId: 'call_s',
    name: 'agent_spawn',
    output: { agentId: AGENT, agentType: 'explore', intent: 'vault audit' },
    modelText: 'Started a sub-agent.',
  })
const spawned = (seq: number, agentId = AGENT) =>
  wire(seq, {
    type: 'agent-spawned',
    agentId,
    agentType: 'explore',
    intent: 'vault audit',
    mode: 'fresh',
  })
const ended = (seq: number, extra: Record<string, unknown> = {}) =>
  wire(seq, {
    type: 'agent-ended',
    agentId: AGENT,
    agentType: 'explore',
    intent: 'vault audit',
    status: EAgentStatus.Finished,
    prose: 'Found 3 issues',
    turns: 2,
    toolCalls: 5,
    ...extra,
  })
const reported = (seq: number, prose = 'Halfway there') =>
  wire(seq, {
    type: 'agent-reported',
    agentId: AGENT,
    agentType: 'explore',
    intent: 'vault audit',
    prose,
    kind: 'progress',
  })

const rowsOf = (events: WireEvent[]): TranscriptRow[] =>
  transcriptViewOf({
    durable: durableTranscriptOf({ events: eventsFromWire(events) }),
    live: [],
  }).items

const kindsOf = (rows: TranscriptRow[]) => rows.map((row) => row.kind)

describe('agent spawn items', () => {
  it('replaces the agent_spawn tool row with a spawn card carrying the brief', () => {
    const rows = rowsOf([said(1), spawnCall(2), spawned(3), spawnResult(4)])
    expect(kindsOf(rows)).toEqual([ETranscriptKind.User, ETranscriptKind.Spawn])
    expect(rows[1]).toMatchObject({
      agentId: AGENT,
      agentType: 'explore',
      intent: 'vault audit',
      brief: 'Audit the vault',
      status: EAgentStatus.Running,
      at: '2026-10-22T10:00:03.000Z',
    })
  })

  it('claims a dispatched spawn by agent type and intent before its result lands', () => {
    const rows = rowsOf([said(1), spawnCall(2), spawned(3)])
    expect(rows[1]).toMatchObject({ kind: ETranscriptKind.Spawn, brief: 'Audit the vault' })
  })

  it('keeps sibling tool calls in their own rows around the spawn', () => {
    const rows = rowsOf([
      said(1),
      wire(2, {
        type: 'tool-called',
        callId: 'c1',
        name: 'bash',
        input: { command: 'ls' },
        ordinal: 0,
      }),
      wire(3, { type: 'tool-result', callId: 'c1', name: 'bash', output: {}, modelText: 'a' }),
      wire(4, {
        type: 'tool-called',
        callId: 'call_s',
        name: 'agent_spawn',
        input: { agentType: 'explore', intent: 'vault audit', brief: 'Audit the vault' },
        ordinal: 1,
      }),
      spawned(5),
      spawnResult(6),
      wire(7, {
        type: 'tool-called',
        callId: 'c2',
        name: 'bash',
        input: { command: 'pwd' },
        ordinal: 2,
      }),
      wire(8, { type: 'tool-result', callId: 'c2', name: 'bash', output: {}, modelText: 'b' }),
    ])
    expect(kindsOf(rows)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Tools,
      ETranscriptKind.Spawn,
      ETranscriptKind.Tools,
    ])
    const ids = rows.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('takes status and result from agent-ended', () => {
    const rows = rowsOf([said(1), spawnCall(2), spawned(3), spawnResult(4), ended(9)])
    expect(rows[1]).toMatchObject({
      status: EAgentStatus.Finished,
      result: 'Found 3 issues',
      endedAt: '2026-10-22T10:00:09.000Z',
    })
  })

  it('carries the failure cause as error text and no result', () => {
    const rows = rowsOf([
      said(1),
      spawnCall(2),
      spawned(3),
      spawnResult(4),
      ended(5, { status: EAgentStatus.Failed, failureCause: 'sandbox lost', prose: '' }),
    ])
    const spawn = rows[1]
    expect(spawn).toMatchObject({ status: EAgentStatus.Failed, errorText: 'sandbox lost' })
    expect(spawn).not.toHaveProperty('result')
  })

  it('shows a progress report as the result while the agent still runs', () => {
    const rows = rowsOf([said(1), spawnCall(2), spawned(3), spawnResult(4), reported(5)])
    expect(rows.find((row) => row.kind === ETranscriptKind.Spawn)).toMatchObject({
      status: EAgentStatus.Running,
      result: 'Halfway there',
    })
  })

  it('shows a restarted agent as running again', () => {
    const rows = rowsOf([
      said(1),
      spawnCall(2),
      spawned(3),
      spawnResult(4),
      ended(5),
      wire(6, {
        type: 'agent-restarted',
        agentId: AGENT,
        agentType: 'explore',
        intent: 'vault audit',
        via: 'message',
      }),
    ])
    expect(rows[1]).toMatchObject({ status: EAgentStatus.Running })
  })

  it('places a spawn with no tool call by its event time', () => {
    const rows = rowsOf([
      said(1),
      wire(2, { type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] }),
      spawned(3),
      wire(4, { type: 'assistant-said', parts: [{ type: 'text', text: 'later' }] }),
    ])
    expect(kindsOf(rows)).toEqual([
      ETranscriptKind.User,
      ETranscriptKind.Agent,
      ETranscriptKind.Spawn,
      ETranscriptKind.Agent,
    ])
  })

  it('builds the DOM id the Agents tab scrolls to', () => {
    expect(spawnDomId(AGENT)).toBe('agent-spawn-thr_child')
  })
})

describe('agent report items', () => {
  it('turns agent-reported into a report notice with the time since spawn', () => {
    const rows = rowsOf([said(1), spawnCall(2), spawned(3), spawnResult(4), reported(8)])
    const report = rows.find((row) => row.kind === ETranscriptKind.Report)
    expect(report).toMatchObject({
      agentId: AGENT,
      report: 'Halfway there',
      failed: false,
      elapsed: '5s',
    })
  })

  it('turns a relayed ending into a report and a failed one into an error', () => {
    const done = rowsOf([said(1), spawned(2), ended(5)]).find(
      (row) => row.kind === ETranscriptKind.Report,
    )
    expect(done).toMatchObject({ report: 'Found 3 issues', failed: false })
    const failed = rowsOf([
      said(1),
      spawned(2),
      ended(5, { status: EAgentStatus.Failed, failureCause: 'boom' }),
    ]).find((row) => row.kind === ETranscriptKind.Report)
    expect(failed).toMatchObject({ failed: true, errorText: 'boom' })
  })

  it('stays quiet for an unrelayed ending and an empty prose', () => {
    const quiet = rowsOf([said(1), spawned(2), ended(5, { relayed: false, waitingOn: 'CI' })])
    expect(quiet.some((row) => row.kind === ETranscriptKind.Report)).toBe(false)
    const empty = rowsOf([said(1), spawned(2), ended(5, { prose: '  ' })])
    expect(empty.some((row) => row.kind === ETranscriptKind.Report)).toBe(false)
  })

  it('splits the transcript into a report turn between agent turns', () => {
    const rows = rowsOf([
      said(1),
      spawnCall(2),
      spawned(3),
      spawnResult(4),
      reported(5),
      wire(6, {
        type: 'tool-called',
        callId: 'c9',
        name: 'bash',
        input: { command: 'ls' },
        ordinal: 1,
      }),
    ])
    const turns = turnsOf({ items: rows, working: false })
    expect(turns.map((turn) => turn.kind)).toEqual([
      ETurnKind.User,
      ETurnKind.Agent,
      ETurnKind.Report,
      ETurnKind.Agent,
    ])
    const first = turns[1]
    if (first?.kind !== ETurnKind.Agent) throw new Error('expected an agent turn')
    expect(first.spawns).toHaveLength(1)
    expect(first.stepCount).toBe(0)
  })
})

describe('agent notices stamped at arrival and delivery', () => {
  const stamp = (id: string, stage: 'arrived' | 'delivered') => ({ notice: { id, stage } })

  it('renders one report at the delivered position', () => {
    const events = [
      said(1),
      spawned(2),
      ended(5, stamp('n1', 'arrived')),
      wire(6, { type: 'user-said', text: 'meanwhile' }),
      ended(7, stamp('n1', 'delivered')),
    ]
    const reports = [...reportItemsOf(eventsFromWire(events)).values()]
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ id: 'evt_7', report: 'Found 3 issues' })
    const rows = rowsOf(events)
    expect(rows.filter((row) => row.kind === ETranscriptKind.Report)).toHaveLength(1)
  })

  it('counts the pair as one ending for the spawn card', () => {
    const events = [
      said(1),
      spawned(2),
      ended(5, stamp('n1', 'arrived')),
      ended(9, stamp('n1', 'delivered')),
    ]
    const [spawn] = spawnItemsOf(eventsFromWire(events))
    expect(spawn).toMatchObject({
      status: EAgentStatus.Finished,
      endedAt: '2026-10-22T10:00:05.000Z',
    })
  })

  it('shows nothing for an arrival that is still owed', () => {
    const events = [said(1), spawned(2), ended(5, stamp('n1', 'arrived'))]
    expect(reportItemsOf(eventsFromWire(events)).size).toBe(0)
  })

  it('keeps a legacy ending rendering as before', () => {
    const events = [said(1), spawned(2), ended(5)]
    expect([...reportItemsOf(eventsFromWire(events)).values()]).toMatchObject([{ id: 'evt_5' }])
  })
})

describe('edit tool paths', () => {
  const editRows = (name: string, input: Record<string, unknown>) => {
    const rows = rowsOf([
      said(1),
      wire(2, { type: 'tool-called', callId: 'e1', name, input, ordinal: 0 }),
      wire(3, { type: 'tool-result', callId: 'e1', name, output: {}, modelText: 'ok' }),
    ])
    const tools = rows[1]
    if (tools?.kind !== ETranscriptKind.Tools) throw new Error('expected a tools item')
    return tools.calls[0]
  }

  it('carries the path on edit, multi_edit and write calls', () => {
    for (const name of ['edit', 'multi_edit', 'write']) {
      expect(editRows(name, { path: 'src/a.ts' })).toMatchObject({
        kind: EToolKind.Edit,
        path: 'src/a.ts',
      })
    }
  })

  it('leaves an edit call without a path and other tools unpathed', () => {
    expect(editRows('edit', {})?.path).toBeUndefined()
    expect(editRows('read', { path: 'src/a.ts' })?.path).toBeUndefined()
  })
})

describe('rosterModelsOf', () => {
  it('maps agent ids to model ids and tolerates no roster', () => {
    expect(rosterModelsOf(null).size).toBe(0)
    const roster = {
      shells: [],
      services: [],
      agents: [{ agentId: 'a', model: { id: 'p', modelId: 'gpt-5' } }, { agentId: 'b' }],
    } as unknown as RosterWire
    expect([...rosterModelsOf(roster)]).toEqual([['a', 'gpt-5']])
  })
})
