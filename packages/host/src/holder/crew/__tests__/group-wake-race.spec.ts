import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  heldDraftOf,
  toThreadId,
  type CrewRoomMember,
  type EventDraft,
  type ThreadId,
} from '@dltech/atlas-core'

import { GroupRunState } from '../group-run-state'

const GROUP = 'call-1'
const A = toThreadId('thread-race-a')
const B = toThreadId('thread-race-b')

const ended = (agentId: ThreadId): EventDraft => ({
  type: 'agent-ended',
  agentId,
  agentType: 'explore',
  intent: 'race',
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 0,
})

const groupOf = () => {
  const states = new Map<ThreadId, GroupRunState>()
  const members = (): readonly CrewRoomMember[] =>
    [...states].map(([agentId, state]) => ({
      agentId,
      agentType: 'explore',
      group: GROUP,
      running: state.runningForGroup,
    }))
  const stateOf = (agentId: ThreadId): GroupRunState => {
    const state = new GroupRunState((draft) => heldDraftOf({ input: draft, crew: members() }))
    states.set(agentId, state)
    return state
  }
  return { a: stateOf(A), b: stateOf(B) }
}

describe('two endings rooted in one spawn step', () => {
  it('holds the first and leaves the second unheld while the first post is in flight', () => {
    const { a, b } = groupOf()
    a.started()
    b.started()

    expect(a.ended(ended(A))).toMatchObject({ held: true })
    expect(a.runningForGroup).toBe(false)
    expect(b.ended(ended(B))).not.toMatchObject({ held: true })
  })

  it('keeps a child that took another turn in the same pump as running for its group', () => {
    const { a, b } = groupOf()
    a.started()
    b.started()

    expect(a.ended(ended(A))).toMatchObject({ held: true })
    a.started()
    expect(b.ended(ended(B))).toMatchObject({ held: true })
  })

  it('wakes the parent for the last ending, once the group has nothing left running', () => {
    const { a, b } = groupOf()
    a.started()
    b.started()

    a.ended(ended(A))
    b.ended(ended(B))
    expect(a.ended(ended(A))).not.toMatchObject({ held: true })
  })
})
