import { describe, expect, it } from 'bun:test'
import {
  ERunFailureKind,
  ESessionStatus,
  EStepEndReason,
  toCallId,
  type V2Body,
} from '@dltech/atlas-core'
import { EStreamBlockKind, type StreamServerMessage } from '@dltech/atlas-protocol'

import { memorySessionCache } from '../session-cache'
import { createSessionFollower } from '../session-follower'
import { createFakeScheduler, eventsMessage, headOf, mintEvents, userSaid } from './support'

const stepKey = { runId: 'run-1', step: 1, attempt: 0 }

const reply: V2Body = { type: 'assistant-said', parts: [{ type: 'text', text: 'x' }] }

const nudge: V2Body = { type: 'nudge', text: 'n', lifetimeSteps: 1 }

const overlay = (afterSeq: number): StreamServerMessage => ({
  type: 'overlay',
  id: 's1',
  key: stepKey,
  afterSeq,
  blocks: [{ block: 'b0', kind: EStreamBlockKind.Text, text: 'Hel' }],
})

const delta: StreamServerMessage = {
  type: 'delta',
  id: 's1',
  key: stepKey,
  block: 'b0',
  kind: EStreamBlockKind.Text,
  from: 3,
  text: 'lo',
}

const view = (at: number): StreamServerMessage => ({
  type: 'view',
  id: 's1',
  name: 'status',
  at,
  value: { state: ESessionStatus.RunningTool, lease: { epoch: 1, holderHostId: 7, live: true } },
})

const setup = () => {
  const follower = createSessionFollower({
    sessionId: 'session-1',
    cache: memorySessionCache(),
    scheduler: createFakeScheduler().scheduler,
    onResnap: () => undefined,
  })
  const before = mintEvents({ bodies: [userSaid('go'), reply, nudge, nudge, nudge] })
  const textOf = () => follower.getSnapshot().overlay?.blocks[0]?.text
  return { follower, before, textOf }
}

describe('the session follower overlay', () => {
  it('ignores a stale status view even when the client is far behind the step', () => {
    const { follower, before, textOf } = setup()
    follower.handleMessage(eventsMessage({ id: 's1', events: before.slice(0, 2), live: false }))
    follower.handleMessage(overlay(5))
    follower.handleMessage(view(3))
    follower.handleMessage(delta)
    expect(textOf()).toBe('Hello')
  })

  it('keeps the step open when events from before it arrive late', () => {
    const { follower, before, textOf } = setup()
    follower.handleMessage(overlay(5))
    follower.handleMessage(eventsMessage({ id: 's1', events: before, live: true }))
    follower.handleMessage(delta)
    expect(textOf()).toBe('Hello')
  })

  it('closes the step on its own reply and drops its later deltas', () => {
    const { follower, before } = setup()
    follower.handleMessage(eventsMessage({ id: 's1', events: before, live: true }))
    follower.handleMessage(overlay(5))
    const own = mintEvents({ bodies: [reply], from: headOf(before) })
    follower.handleMessage(eventsMessage({ id: 's1', events: own, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
    follower.handleMessage(delta)
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('closes a tool-only step on its tool call and a failed step on run-failed', () => {
    const results: V2Body[] = [
      { type: 'tool-called', callId: toCallId('c1'), name: 'bash', input: {}, ordinal: 0 },
      { type: 'run-failed', failure: { kind: ERunFailureKind.Other, message: 'boom' } },
    ]
    for (const result of results) {
      const { follower, before } = setup()
      follower.handleMessage(eventsMessage({ id: 's1', events: before, live: true }))
      follower.handleMessage(overlay(5))
      const own = mintEvents({ bodies: [result], from: headOf(before) })
      follower.handleMessage(eventsMessage({ id: 's1', events: own, live: true }))
      expect(follower.getSnapshot().overlay).toBeUndefined()
    }
  })

  it('never opens a step whose reply is already in the window', () => {
    const { follower, before } = setup()
    const own = mintEvents({ bodies: [reply], from: headOf(before) })
    follower.handleMessage(eventsMessage({ id: 's1', events: [...before, ...own], live: true }))
    follower.handleMessage(overlay(5))
    expect(follower.getSnapshot().overlay).toBeUndefined()
    follower.handleMessage(delta)
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })

  it('keeps an ended step on screen until its reply lands', () => {
    const { follower, before, textOf } = setup()
    follower.handleMessage(eventsMessage({ id: 's1', events: before, live: true }))
    follower.handleMessage(overlay(5))
    follower.handleMessage({
      type: 'frame',
      id: 's1',
      frame: {
        type: 'step-end',
        key: stepKey,
        reason: EStepEndReason.Finished,
        at: { epoch: 1, n: 0 },
      },
    })
    expect(follower.getSnapshot().overlay?.ended).toBe(true)
    expect(textOf()).toBe('Hel')
    const own = mintEvents({ bodies: [reply], from: headOf(before) })
    follower.handleMessage(eventsMessage({ id: 's1', events: own, live: true }))
    expect(follower.getSnapshot().overlay).toBeUndefined()
  })
})
