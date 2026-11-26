import { describe, expect, it } from 'bun:test'

import type { ThreadId } from '@dltech/atlas-core'

import { spawnAgentIdOf } from '../spawn-key'
import {
  AT,
  BRIEF,
  CALL,
  OTHER_BRIEF,
  PARENT,
  briefsOf,
  flush,
  ofType,
  rigOf,
  roomOf,
  spawnInStep,
} from './spawn-step-rig'

describe('a spawn inside a tool call', () => {
  it('opens one child when the same step runs twice in one scope replay', async () => {
    const { room, created, parent, plane } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    const replay = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(replay.agentId).toBe(first.agentId)
    expect(created).toEqual([first.agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(ofType(parent.events, 'agent-spawned')[0]).toMatchObject({
      agentId: first.agentId,
      callId: CALL,
    })
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
  })

  it('names the child after the parent thread and the step', async () => {
    const { room } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )

    expect(first.agentId).toBe(spawnAgentIdOf({ parentThreadId: PARENT, stepKey: `${CALL}.0` }))
  })

  it('opens a second child when the replayed input diverged', async () => {
    const { room, parent } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    const diverged = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: OTHER_BRIEF }),
    )

    expect(diverged.agentId).not.toBe(first.agentId)
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(2)
  })

  it('returns the snapshot of a child the takeover already adopted', async () => {
    const { room, created, parent, plane, epoch } = await rigOf()

    const first = await spawnInStep(() =>
      room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()
    const takeover = roomOf({ plane, parent, epoch })
    await takeover.adoptAll([
      {
        agentId: first.agentId as ThreadId,
        agentType: 'general-purpose',
        intent: 'probe',
        group: undefined,
        spawnedAt: AT,
        worktree: undefined,
      },
    ])
    await flush()

    const replay = await spawnInStep(() =>
      takeover.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF }),
    )
    await flush()

    expect(replay.agentId).toBe(first.agentId)
    expect(created).toEqual([first.agentId])
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(1)
    expect(await briefsOf({ plane, agentId: first.agentId })).toEqual([BRIEF])
  })

  it('keeps a random child id when no tool call is in scope', async () => {
    const { room, parent } = await rigOf()

    const first = await room.spawn({ agentType: 'general-purpose', intent: 'probe', prompt: BRIEF })
    const second = await room.spawn({
      agentType: 'general-purpose',
      intent: 'probe',
      prompt: BRIEF,
    })

    expect(first.agentId).not.toBe(second.agentId)
    expect(ofType(parent.events, 'agent-spawned')).toHaveLength(2)
    expect(ofType(parent.events, 'agent-spawned').map((event) => event.callId)).toEqual([
      undefined,
      undefined,
    ])
    expect(
      parent.events.filter(
        (event) => event.type === 'fact-recorded' && event.kind === 'effect-started',
      ),
    ).toEqual([])
  })
})
