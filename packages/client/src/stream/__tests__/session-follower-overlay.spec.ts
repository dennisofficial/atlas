import { describe, expect, it } from 'bun:test'
import { ESessionStatus, type V2Body } from '@dltech/atlas-core'
import {
  EStreamBlockKind,
  EStreamResetReason,
  type StreamServerMessage,
} from '@dltech/atlas-protocol'

import { memorySessionCache } from '../session-cache'
import { createSessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintEvents, userSaid } from './support'

const statusView = (params: { at: number; state: ESessionStatus }): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'status',
  at: params.at,
  value: { state: params.state, lease: { epoch: 1, holderHostId: 7, live: true } },
})

const reply = (step?: number): V2Body => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'x' }],
  ...(step === undefined ? {} : { step }),
})

const nudge: V2Body = { type: 'nudge', text: 'n', lifetimeSteps: 1 }

const stepKey = (step: number) => ({ runId: 'run-1', step, attempt: 0 })

const overlayFor = (step: number): StreamServerMessage => ({
  type: 'overlay',
  id: 's1',
  key: stepKey(step),
  blocks: [{ block: 'b0', kind: EStreamBlockKind.Text, text: 'Hel' }],
})

const setup = () => {
  const follower = createSessionFollower({
    sessionId: 'session-1',
    cache: memorySessionCache(),
    scheduler: createFakeScheduler().scheduler,
    onResnap: () => undefined,
  })
  return { follower }
}

describe('the session follower overlay', () => {
  it('ignores a stale view read at the position the overlay opened at', () => {
    const { follower } = setup()
    const step0 = mintEvents({ bodies: [userSaid('go'), reply(0)] })
    follower.handleMessage(eventsMessage({ id: 's1', events: step0, live: true }))
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 2, state: ESessionStatus.RunningTool }))
    expect(follower.getSnapshot().overlay?.ended).toBe(false)
    follower.handleMessage({
      type: 'delta',
      id: 's1',
      key: stepKey(1),
      block: 'b0',
      kind: EStreamBlockKind.Text,
      from: 3,
      text: 'lo',
    })
    expect(follower.getSnapshot().overlay?.blocks[0]?.text).toBe('Hello')
  })

  it('ends the overlay on a view read after the position it opened at', () => {
    const { follower } = setup()
    const step0 = mintEvents({ bodies: [userSaid('go'), reply(0)] })
    follower.handleMessage(eventsMessage({ id: 's1', events: step0, live: true }))
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 3, state: ESessionStatus.Idle }))
    expect(follower.getSnapshot().overlay?.ended).toBe(true)
    expect(follower.getSnapshot().overlay?.blocks[0]?.text).toBe('Hel')
  })

  it('keeps the opening position when the same step is re-sent', () => {
    const { follower } = setup()
    const step0 = mintEvents({ bodies: [userSaid('go'), reply(0)] })
    follower.handleMessage(eventsMessage({ id: 's1', events: step0, live: true }))
    follower.handleMessage(overlayFor(1))
    const later = mintEvents({ bodies: [nudge, nudge], from: headOf(step0) })
    follower.handleMessage(eventsMessage({ id: 's1', events: later, live: true }))
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 4, state: ESessionStatus.Idle }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('keeps the text of a step whose status moved on until the cursor reaches the view', () => {
    const { follower } = setup()
    const first = mintEvents({ bodies: [userSaid('hi'), userSaid('again')] })
    follower.handleMessage(eventsMessage({ id: 's1', events: first, live: true }))
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 4, state: ESessionStatus.Idle }))
    expect(follower.getSnapshot().overlay?.ended).toBe(true)
    expect(follower.getSnapshot().overlay?.blocks[0]?.text).toBe('Hel')
    const next = mintEvents({ bodies: [nudge, nudge], from: headOf(first) })
    follower.handleMessage(eventsMessage({ id: 's1', events: next, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('swaps an ended overlay for its durable reply without a gap', () => {
    const { follower } = setup()
    const first = mintEvents({ bodies: [userSaid('hi')] })
    follower.handleMessage(eventsMessage({ id: 's1', events: first, live: true }))
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 9, state: ESessionStatus.Idle }))
    const next = mintEvents({ bodies: [reply(1)], from: headOf(first) })
    follower.handleMessage(eventsMessage({ id: 's1', events: next, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('keeps step 1 live when an events page holds only a nudge after step 0 replied', () => {
    const { follower } = setup()
    const first = mintEvents({ bodies: [userSaid('hi'), reply(0)] })
    follower.handleMessage(eventsMessage({ id: 's1', events: first, live: true }))
    follower.handleMessage(overlayFor(1))
    const next = mintEvents({ bodies: [nudge], from: headOf(first) })
    follower.handleMessage(eventsMessage({ id: 's1', events: next, live: true }))
    expect(follower.getSnapshot().overlay?.key).toEqual(stepKey(1))
    follower.handleMessage({
      type: 'delta',
      id: 's1',
      key: stepKey(1),
      block: 'b0',
      kind: EStreamBlockKind.Text,
      from: 3,
      text: 'lo',
    })
    expect(follower.getSnapshot().overlay?.blocks[0]?.text).toBe('Hello')
  })

  it('closes step 1 when a reply stamped step 1 arrives', () => {
    const { follower } = setup()
    const first = mintEvents({ bodies: [userSaid('hi'), reply(0)] })
    follower.handleMessage(eventsMessage({ id: 's1', events: first, live: true }))
    follower.handleMessage(overlayFor(1))
    const next = mintEvents({ bodies: [reply(1)], from: headOf(first) })
    follower.handleMessage(eventsMessage({ id: 's1', events: next, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('closes on a legacy reply without a step only when that reply is fresh', () => {
    const { follower } = setup()
    const first = mintEvents({ bodies: [userSaid('hi'), reply()] })
    follower.handleMessage(eventsMessage({ id: 's1', events: first, live: true }))
    follower.handleMessage(overlayFor(1))
    const quiet = mintEvents({ bodies: [nudge], from: headOf(first) })
    follower.handleMessage(eventsMessage({ id: 's1', events: quiet, live: true }))
    expect(follower.getSnapshot().overlay).toBeDefined()
    const fresh = mintEvents({ bodies: [reply()], from: headOf(quiet) })
    follower.handleMessage(eventsMessage({ id: 's1', events: fresh, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('drops an ended overlay when the stream resets', () => {
    const { follower } = setup()
    follower.handleMessage(overlayFor(1))
    follower.handleMessage(statusView({ at: 9, state: ESessionStatus.Idle }))
    expect(follower.getSnapshot().overlay?.ended).toBe(true)
    follower.handleMessage({
      type: 'reset',
      id: 's1',
      reason: EStreamResetReason.Fork,
      tailFrom: 0,
    })
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })
})
