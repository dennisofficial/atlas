import { describe, expect, it } from 'bun:test'

import { flushUntil } from '../../__tests__/holder-rig'
import {
  ANSWER,
  ASK,
  ASK_PROBE,
  ANSWER_PROBE,
  A_BRIEF,
  arrivesOn,
  B_BRIEF,
  ECHO,
  ECHO_PROBE,
  eventsIn,
  idle,
  PARENT_SAY,
  PARENT_SAY_PROBE,
  reportedOn,
  SPAWN_A,
  SPAWN_B,
  siblingRig,
} from './sibling-rig'

const firstSteps = [
  { calls: [{ callId: 'a1', name: ASK_PROBE, input: {} }] },
  idle,
  { calls: [{ callId: 'a2', name: ECHO_PROBE, input: {} }] },
  idle,
  { calls: [{ callId: 'a3', name: ECHO_PROBE, input: {} }] },
  idle,
] as const

const secondSteps = [
  { calls: [{ callId: 'b1', name: ANSWER_PROBE, input: {} }] },
  idle,
  { calls: [{ callId: 'b2', name: ANSWER_PROBE, input: {} }] },
  idle,
  { calls: [{ callId: 'b3', name: ANSWER_PROBE, input: {} }] },
  idle,
] as const

describe('two sub-agents messaging each other', () => {
  it('labels every hop with the sub-agent that sent it, in both directions', async () => {
    const { rig, state } = await siblingRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_B, input: {} }] },
        { calls: [{ callId: 'c2', name: SPAWN_A, input: {} }] },
        { text: 'parent done' },
      ],
      first: firstSteps,
      second: secondSteps,
    })

    await rig.post('spawn the pair')
    await rig.wake()
    const asked = await flushUntil({
      check: () => state.asked !== undefined,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(asked).toBe(true)

    const aId = state.aId ?? ''
    const bId = state.bId ?? ''
    expect(state.asked).toMatchObject({ delivered: true, to: bId })

    const forB = await arrivesOn({ rig, threadId: () => bId, from: () => aId, prose: ASK })
    expect(reportedOn(forB, aId, ASK)).toMatchObject({
      type: 'agent-reported',
      agentId: aId,
      agentType: 'general-purpose',
      intent: 'ask the sibling',
      prose: ASK,
    })

    await flushUntil({
      check: () => state.answered !== undefined,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(state.answered).toMatchObject({ delivered: true, to: aId })

    const forA = await arrivesOn({ rig, threadId: () => aId, from: () => bId, prose: ANSWER })
    expect(reportedOn(forA, bId, ANSWER)).toMatchObject({
      type: 'agent-reported',
      agentId: bId,
      agentType: 'general-purpose',
      intent: 'answer the sibling',
      prose: ANSWER,
    })
    expect(
      forA.filter((event) => event.type === 'user-said' && JSON.stringify(event).includes(ANSWER)),
    ).toEqual([])

    await flushUntil({
      check: () => state.echoed !== undefined,
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 200,
    })
    expect(state.echoed).toMatchObject({ delivered: true, to: bId })
    const forBEcho = await arrivesOn({ rig, threadId: () => bId, from: () => aId, prose: ECHO })
    expect(reportedOn(forBEcho, aId, ECHO)).toMatchObject({
      type: 'agent-reported',
      agentId: aId,
      prose: ECHO,
    })
  })

  it('shows the answered sub-agent the sender as its reply address', async () => {
    const { rig, state, first } = await siblingRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_B, input: {} }] },
        { calls: [{ callId: 'c2', name: SPAWN_A, input: {} }] },
        { text: 'parent done' },
      ],
      first: firstSteps,
      second: secondSteps,
    })

    await rig.post('spawn the pair')
    await rig.wake()
    const answered = await flushUntil({
      check: async () =>
        state.aId !== undefined &&
        (await eventsIn(rig, state.aId)).some(
          (event) => event.type === 'agent-reported' && event.prose === ANSWER,
        ),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 300,
    })
    expect(answered).toBe(true)

    const assembled = JSON.stringify(first.requests.at(-1)?.assembled)
    expect(assembled).toContain(A_BRIEF)
    expect(assembled).toContain(ANSWER)
    expect(assembled).toContain(`Reply by sending a message to ${state.bId ?? ''}`)
    expect(assembled).not.toContain(B_BRIEF)
  })

  it('keeps a message from the main agent in the parent lane', async () => {
    const { rig, state } = await siblingRig({
      parent: [
        { calls: [{ callId: 'c1', name: SPAWN_B, input: {} }] },
        { calls: [{ callId: 'c2', name: SPAWN_A, input: {} }] },
        { calls: [{ callId: 'c3', name: PARENT_SAY_PROBE, input: {} }] },
        { text: 'parent done' },
      ],
      first: [idle, idle, idle],
      second: [idle, idle],
    })

    await rig.post('spawn the pair')
    await rig.wake()
    const told = await flushUntil({
      check: async () =>
        state.aId !== undefined &&
        (await eventsIn(rig, state.aId)).some(
          (event) => event.type === 'user-said' && event.text === PARENT_SAY,
        ),
      clock: rig.clock,
      advanceMs: 60_000,
      attempts: 300,
    })
    expect(told).toBe(true)
    expect(state.told).toMatchObject({ delivered: true, to: state.aId })

    const events = await eventsIn(rig, state.aId ?? '')
    const said = events.find((event) => event.type === 'user-said' && event.text === PARENT_SAY)
    expect(said).toMatchObject({ type: 'user-said', via: 'parent-agent' })
    expect(events.filter((event) => event.type === 'agent-reported')).toEqual([])
  })
})
