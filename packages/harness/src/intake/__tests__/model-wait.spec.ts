import { describe, expect, it } from 'bun:test'
import { toThreadId, type EventDraft } from '@dltech/atlas-core'

import { MessageIntake, type IntakeSource } from '../message-intake'

const MAIN = toThreadId('main')
const said: EventDraft = { type: 'user-said', text: 'hello' }
const flush = async (): Promise<void> => {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function arrange() {
  let wakes = 0
  let blocked = true
  let pendingInput = true
  const listeners = new Set<() => void>()
  const source: IntakeSource = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    threadsAwaitingInput: () => (pendingInput ? [MAIN] : []),
    prepare: () => ({
      drafts: [said],
      wakesTurn: true,
      acknowledge: () => undefined,
    }),
  }
  const intake = new MessageIntake({ sources: [source] })
  intake.register({
    threadId: MAIN,
    driver: {
      blocked: () => blocked,
      wake: () => {
        wakes += 1
        pendingInput = false
      },
    },
  })
  return {
    intake,
    wakes: () => wakes,
    changeInput: () => {
      for (const listener of listeners) listener()
    },
    unblock: () => {
      blocked = false
      intake.changed()
    },
  }
}

describe('availability blocks before the intake scheduler', () => {
  it('never wakes a blocked thread however often its input witness changes', async () => {
    const rig = arrange()
    for (let index = 0; index < 10; index += 1) {
      rig.changeInput()
      await flush()
    }
    expect(rig.wakes()).toBe(0)
  })

  it('wakes exactly once when the block lifts', async () => {
    const rig = arrange()
    rig.changeInput()
    await flush()
    rig.unblock()
    await flush()
    expect(rig.wakes()).toBe(1)
  })
})
