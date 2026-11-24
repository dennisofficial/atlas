import { describe, expect, it } from 'bun:test'

import { EKilledBy } from '../../shells/status'
import type { EventDraft } from '../../events/body'
import { toThreadId } from '../../events/ids'
import { endingHeld, heldDraftOf, type CrewRoomMember } from '../ending-hold'
import { isTurnTaking } from '../kind'
import { EAgentStatus } from '../status'

const GROUP = 'call-1'

type MemberOver = { agentId: string } & Omit<Partial<CrewRoomMember>, 'agentId'>

const member = (over: MemberOver): CrewRoomMember => ({
  agentId: toThreadId(over.agentId),
  agentType: over.agentType ?? 'explore',
  group: 'group' in over ? over.group : GROUP,
  running: over.running ?? false,
})

const crewOf = (running: readonly string[]): readonly CrewRoomMember[] =>
  ['a', 'b', 'c'].map((agentId) => member({ agentId, running: running.includes(agentId) }))

const ended = (
  agentId: string,
  over: Partial<Extract<EventDraft, { type: 'agent-ended' }>> = {},
): EventDraft => ({
  type: 'agent-ended',
  agentId: toThreadId(agentId),
  agentType: 'explore',
  intent: agentId,
  status: EAgentStatus.Finished,
  prose: 'done',
  turns: 1,
  toolCalls: 1,
  ...over,
})

const held = (args: { input: EventDraft; crew?: readonly CrewRoomMember[] }): boolean =>
  endingHeld({ input: args.input, crew: args.crew ?? crewOf(['b']) })

describe('a clean ending of a group member', () => {
  it('is held while a sibling from the same spawn step still runs', () => {
    expect(held({ input: ended('a') })).toBe(true)
  })

  it('is stamped held, and a held row takes no turn', () => {
    const draft = heldDraftOf({ input: ended('a'), crew: crewOf(['b']) })
    if (draft.type !== 'agent-ended') throw new Error('expected an ending draft')

    expect(draft.held).toBe(true)
    expect(isTurnTaking(draft)).toBe(false)
  })

  it('wakes the parent once the last sibling ends', () => {
    expect(held({ input: ended('a'), crew: crewOf(['b', 'c']) })).toBe(true)
    expect(held({ input: ended('b'), crew: crewOf(['c']) })).toBe(true)
    expect(held({ input: ended('c'), crew: crewOf([]) })).toBe(false)
  })

  it('wakes the parent when no sibling of a group of three still runs', () => {
    const crew = crewOf(['b'])
    expect(held({ input: ended('c'), crew })).toBe(true)
    expect(held({ input: ended('b'), crew })).toBe(false)
  })
})

describe('a member set running again by the parent', () => {
  it('makes the group wait for a sibling that restarted after its last ending', () => {
    expect(held({ input: ended('a'), crew: crewOf(['b']) })).toBe(true)
  })

  it('wakes a lone restart that ends with no running sibling', () => {
    const crew = [
      member({ agentId: 'a', running: false }),
      member({ agentId: 'b', running: false }),
    ]
    expect(held({ input: ended('a'), crew })).toBe(false)
  })
})

describe('which endings a group can hold', () => {
  it('holds an ending the parent stopped itself', () => {
    expect(
      held({ input: ended('a', { status: EAgentStatus.Stopped, killedBy: EKilledBy.Model }) }),
    ).toBe(true)
  })

  it('never holds a failure, so a broken member wakes the parent at once', () => {
    expect(held({ input: ended('a', { status: EAgentStatus.Failed }) })).toBe(false)
  })

  it('never holds a stop the operator asked for', () => {
    expect(
      held({ input: ended('a', { status: EAgentStatus.Stopped, killedBy: EKilledBy.User }) }),
    ).toBe(false)
  })

  it('never holds a pause or a bookkeeping ending', () => {
    expect(held({ input: ended('a', { status: EAgentStatus.Paused }) })).toBe(false)
    expect(held({ input: ended('a', { relayed: false }) })).toBe(false)
  })

  it('never holds a teammate, which is no member of the group', () => {
    expect(held({ input: ended('a', { agentType: 'teammate' }) })).toBe(false)
  })

  it('never holds an input that is not an ending', () => {
    expect(held({ input: { type: 'user-said', text: 'hello' } })).toBe(false)
  })
})

describe('what makes a group', () => {
  it('never holds a member that the room records with no group', () => {
    const crew = [
      member({ agentId: 'a', group: undefined, running: false }),
      member({ agentId: 'b', group: undefined, running: true }),
    ]

    expect(held({ input: ended('a'), crew })).toBe(false)
  })

  it('never holds a member the room does not know', () => {
    expect(held({ input: ended('z'), crew: crewOf(['b']) })).toBe(false)
  })

  it('never holds an ending while no member of the room runs', () => {
    expect(held({ input: ended('a'), crew: crewOf([]) })).toBe(false)
  })

  it('holds only for a sibling of the same group', () => {
    const crew = [
      member({ agentId: 'a', running: false }),
      member({ agentId: 'b', group: 'call-2', running: true }),
    ]

    expect(held({ input: ended('a'), crew })).toBe(false)
  })

  it('never lets a running teammate keep the group open', () => {
    const crew = [
      member({ agentId: 'a', running: false }),
      member({ agentId: 'b', agentType: 'teammate', running: true }),
    ]

    expect(held({ input: ended('a'), crew })).toBe(false)
  })
})
