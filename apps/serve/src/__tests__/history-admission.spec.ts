import { describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import { MessageIntake } from '@dltech/atlas-harness'

import { createHistoryAdmission } from '../history-admission'

const threadId = toThreadId('history-admission')

describe('history admission', () => {
  it('marks compaction busy and releases the reservation', () => {
    const history = createHistoryAdmission({
      threadId,
      intake: null,
      unavailable: () => false,
    })
    const release = history.hold()
    expect(history.held()).toBe(true)
    expect(() => history.assertAvailable()).toThrow('history is being summarised')
    expect(() => history.hold()).toThrow('history is being summarised')
    release()
    expect(history.held()).toBe(false)
    expect(() => history.assertAvailable()).not.toThrow()
  })

  it('never enters while a turn or workspace handoff owns the session', () => {
    const history = createHistoryAdmission({
      threadId,
      intake: null,
      unavailable: () => true,
    })
    expect(() => history.hold()).toThrow('a turn or workspace handoff is running')
    expect(history.held()).toBe(false)
  })

  it('honours the dormant and parking refusals before any mutation', () => {
    const history = createHistoryAdmission({
      threadId,
      intake: null,
      unavailable: () => false,
      refusal: () => 'the destination is dormant',
    })
    expect(() => history.hold()).toThrow('destination is dormant')
    expect(history.held()).toBe(false)
  })

  it('holds autonomous intake wakes until compaction settles', async () => {
    let pending = false
    let wakes = 0
    const intake = new MessageIntake({
      sources: [
        {
          prepare: async () => ({
            drafts: [],
            acknowledge: () => undefined,
            wakesTurn: false,
          }),
          threadsAwaitingInput: () => (pending ? [threadId] : []),
          subscribe: () => () => undefined,
        },
      ],
    })
    const unregister = intake.register({
      threadId,
      driver: {
        blocked: () => false,
        wake: () => {
          wakes += 1
          pending = false
        },
      },
    })
    const history = createHistoryAdmission({
      threadId,
      intake,
      unavailable: () => false,
    })
    const release = history.hold()
    pending = true
    intake.changed()
    await Bun.sleep(0)
    expect(wakes).toBe(0)
    release()
    await Bun.sleep(0)
    expect(wakes).toBe(1)
    unregister()
    intake.dispose()
  })
})
