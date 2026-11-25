import { describe, expect, it } from 'bun:test'

import { agentIdOfSpawnCall, agentIdOfToolOutput, agentLinksOf } from '../agent-links'
import { eventSchema } from '../registered-plugins'

const envelope = (seq: number) => ({
  id: `evt_${seq}`,
  seq,
  threadId: 'thr_parent',
  runId: 'run_1',
  depth: 0,
  at: `2026-11-22T10:00:0${seq}.000Z`,
  epoch: 0,
  prevHash: '0'.repeat(64),
})

const eventsOf = (raw: readonly unknown[]) => raw.map((event) => eventSchema.parse(event))

const spawned = {
  ...envelope(1),
  type: 'agent-spawned',
  agentId: 'thr_child',
  agentType: 'builder',
  intent: 'Fix the failing test',
  mode: 'fresh',
}

const spawnResult = {
  ...envelope(2),
  type: 'tool-result',
  callId: 'call_spawn',
  name: 'agent_spawn',
  output: { agentId: 'thr_child', agentType: 'builder', intent: 'Fix the failing test' },
  modelText: 'Started a sub-agent.',
}

const ended = {
  ...envelope(3),
  type: 'agent-ended',
  agentId: 'thr_child',
  agentType: 'builder',
  intent: 'Fix the failing test',
  status: 'finished',
  prose: 'Done.',
  turns: 2,
  toolCalls: 3,
}

describe('agentIdOfToolOutput', () => {
  it('reads the agent id a spawn call returned', () => {
    expect(agentIdOfToolOutput({ agentId: 'thr_child', agentType: 'builder' })).toBe('thr_child')
  })

  it('ignores an output that carries no agent id', () => {
    expect(agentIdOfToolOutput(undefined)).toBeUndefined()
    expect(agentIdOfToolOutput('ok')).toBeUndefined()
    expect(agentIdOfToolOutput({ agentId: '' })).toBeUndefined()
    expect(agentIdOfToolOutput({ reason: 'no worktree' })).toBeUndefined()
  })
})

describe('agentIdOfSpawnCall', () => {
  it('reads the agent id only from a spawn call', () => {
    expect(agentIdOfSpawnCall({ name: 'agent_spawn', output: { agentId: 'thr_child' } })).toBe(
      'thr_child',
    )
    expect(
      agentIdOfSpawnCall({ name: 'report_to_main', output: { agentId: 'thr_child' } }),
    ).toBeUndefined()
    expect(agentIdOfSpawnCall({ name: 'bash', output: { agentId: 'thr_child' } })).toBeUndefined()
  })
})

describe('agentLinksOf', () => {
  it('links the notice event to its agent', () => {
    const links = agentLinksOf({ events: eventsOf([spawned, ended]) })
    expect(links.byEventId.get('evt_3')).toBe('thr_child')
  })

  it('links a reported notice to its agent', () => {
    const reported = {
      ...envelope(4),
      type: 'agent-reported',
      agentId: 'thr_child',
      agentType: 'builder',
      intent: 'Fix the failing test',
      prose: 'Halfway.',
    }
    expect(agentLinksOf({ events: eventsOf([reported]) }).byEventId.get('evt_4')).toBe('thr_child')
  })

  it('links the spawn tool call to its agent', () => {
    const links = agentLinksOf({ events: eventsOf([spawnResult]) })
    expect(links.byCallId.get('call_spawn')).toBe('thr_child')
  })

  it('leaves a report to main unlinked, though it names the reporter', () => {
    const report = {
      ...envelope(5),
      type: 'tool-result',
      callId: 'call_report',
      name: 'report_to_main',
      output: { agentId: 'thr_child', kind: 'progress' },
      modelText: 'Your report is on its way to the parent agent.',
    }
    expect(agentLinksOf({ events: eventsOf([report]) }).byCallId.size).toBe(0)
  })

  it('leaves other tool results unlinked', () => {
    const bash = {
      ...envelope(6),
      type: 'tool-result',
      callId: 'call_bash',
      name: 'bash',
      output: 'ok',
    }
    const withAgentId = {
      ...envelope(7),
      type: 'tool-result',
      callId: 'call_other',
      name: 'agent_say',
      output: { agentId: 'thr_child', queued: true },
    }
    const links = agentLinksOf({ events: eventsOf([bash, withAgentId]) })
    expect(links.byCallId.size).toBe(0)
    expect(links.byEventId.size).toBe(0)
  })
})
