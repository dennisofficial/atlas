import { describe, expect, it } from 'bun:test'

import { EAgentStatus, type V2Event } from '@dltech/atlas-core'

import { crewOfEvents, foldCrew, type CrewViewState } from '..'

const at = (n: number): string => `2026-11-09T10:00:0${n}.000Z`

const stamp = (body: Record<string, unknown>, n: number): V2Event =>
  ({ ...body, seq: n, at: at(n), threadId: 't1', id: `e${n}` }) as unknown as V2Event

const spawned = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'agent-spawned',
      agentId: 'a1',
      agentType: 'explore',
      intent: 'find the plugin seam',
      mode: 'spawn',
      ...extra,
    },
    n,
  )

const ended = (n: number, extra: Record<string, unknown> = {}): V2Event =>
  stamp(
    {
      type: 'agent-ended',
      agentId: 'a1',
      agentType: 'explore',
      intent: 'find the plugin seam',
      status: EAgentStatus.Finished,
      prose: 'The seam is in plugin-sdk.',
      turns: 3,
      toolCalls: 7,
      ...extra,
    },
    n,
  )

const reported = (n: number, prose: string): V2Event =>
  stamp(
    {
      type: 'agent-reported',
      agentId: 'a1',
      agentType: 'explore',
      intent: 'find the plugin seam',
      prose,
      kind: 'progress',
    },
    n,
  )

describe('the crew view', () => {
  it('starts a running row when an agent is spawned', () => {
    const rows = crewOfEvents([spawned(1)])
    expect(rows).toEqual([
      {
        agentId: 'a1',
        agentType: 'explore',
        intent: 'find the plugin seam',
        status: EAgentStatus.Running,
        turns: 0,
        toolCalls: 0,
        startedAt: at(1),
      },
    ])
  })

  it('fills the row in when the agent ends', () => {
    const [row] = crewOfEvents([spawned(1), ended(2)])
    expect(row?.status).toBe(EAgentStatus.Finished)
    expect(row?.prose).toBe('The seam is in plugin-sdk.')
    expect(row?.endedAt).toBe(at(2))
    expect(row?.turns).toBe(3)
    expect(row?.toolCalls).toBe(7)
  })

  it('records a report without touching the status', () => {
    const state = foldCrew(crewOfEvents([spawned(1)]), reported(2, 'halfway there'))
    expect(state[0]?.prose).toBe('halfway there')
    expect(state[0]?.status).toBe(EAgentStatus.Running)
  })

  it('keeps a restart running and drops the earlier ending', () => {
    const state = crewOfEvents([
      spawned(1),
      ended(2),
      stamp(
        {
          type: 'agent-restarted',
          agentId: 'a1',
          agentType: 'explore',
          intent: 'again',
          via: 'say',
        },
        3,
      ),
    ])
    expect(state[0]?.status).toBe(EAgentStatus.Running)
    expect(state[0]?.endedAt).toBeUndefined()
    expect(state[0]?.turns).toBe(3)
  })

  it('reduces a spawn, a report and an ending to one row', () => {
    const state: CrewViewState = crewOfEvents([
      spawned(1),
      reported(2, 'one lead so far'),
      ended(3),
    ])
    expect(state).toHaveLength(1)
    expect(state[0]).toEqual({
      agentId: 'a1',
      agentType: 'explore',
      intent: 'find the plugin seam',
      status: EAgentStatus.Finished,
      turns: 3,
      toolCalls: 7,
      startedAt: at(1),
      prose: 'The seam is in plugin-sdk.',
      endedAt: at(3),
    })
  })

  it('leaves other events alone', () => {
    const state = crewOfEvents([spawned(1)])
    expect(foldCrew(state, stamp({ type: 'assistant-said', text: 'hi' }, 2))).toBe(state)
  })

  it('carries the worktree a child was spawned into', () => {
    const state = crewOfEvents([
      spawned(1, {
        worktree: { path: '/work/.atlas/worktrees/dennis/wt', branch: 'dennis/wt' },
      }),
    ])
    expect(state[0]?.worktree).toEqual({
      path: '/work/.atlas/worktrees/dennis/wt',
      branch: 'dennis/wt',
    })
  })
})
