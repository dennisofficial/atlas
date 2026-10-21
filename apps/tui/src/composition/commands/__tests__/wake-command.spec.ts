import { describe, expect, it } from 'vitest'

import { EConnectionView } from '@dltech/atlas-harness'

import { dispatchSubmission, EDispatch } from '../dispatch'
import { ECommandEffect, ECommandTiming, RAN } from '../local-command'
import { localCommands } from '../registry'
import { ALREADY_UP, NOT_IN_THE_CLOUD, RECONNECTING, wakeEffect } from '../wake'
import { handlers } from './local-handlers'

const counted = (): { wake: () => void; count: () => number } => {
  let wakes = 0
  return {
    wake: () => {
      wakes += 1
    },
    count: () => wakes,
  }
}

describe('the wake command', () => {
  it('runs immediately, even mid-turn, and keeps whatever is queued', () => {
    const wake = localCommands(handlers()).find((one) => one.name === 'wake')

    expect(wake?.timing).toBe(ECommandTiming.Immediate)
    expect(wake?.dropsQueue).toBeUndefined()
    expect(wake?.losesWaiting).toBeUndefined()
  })

  it('hands off to the wake the workspace wired in', async () => {
    const wakes = counted()

    const dispatched = await dispatchSubmission({
      text: '/wake',
      commands: localCommands(
        handlers({ onWake: () => wakeEffect({ view: EConnectionView.Parked, wake: wakes.wake }) }),
      ),
      skills: [],
      working: true,
    })

    expect(dispatched.type).toBe(EDispatch.Ran)
    expect(wakes.count()).toBe(1)
  })
})

describe('what waking does in each connection state', () => {
  it('wakes a parked or disconnected sandbox', () => {
    for (const view of [EConnectionView.Parked, EConnectionView.Disconnected]) {
      const wakes = counted()

      expect(wakeEffect({ view, wake: wakes.wake })).toEqual(RAN)
      expect(wakes.count()).toBe(1)
    }
  })

  it('hands a waking or updating sandbox to the session wake, which joins a dial already in flight', () => {
    for (const view of [EConnectionView.Waking, EConnectionView.Updating]) {
      const wakes = counted()

      expect(wakeEffect({ view, wake: wakes.wake })).toEqual(RAN)
      expect(wakes.count()).toBe(1)
    }
  })

  it('refuses when the sandbox is already up or reconnecting', () => {
    const wakes = counted()

    expect(wakeEffect({ view: EConnectionView.Connected, wake: wakes.wake })).toEqual({
      type: ECommandEffect.Refused,
      reason: ALREADY_UP,
    })
    expect(wakeEffect({ view: EConnectionView.Reconnecting, wake: wakes.wake })).toEqual({
      type: ECommandEffect.Refused,
      reason: RECONNECTING,
    })
    expect(wakes.count()).toBe(0)
  })

  it('refuses outside a cloud conversation', () => {
    expect(wakeEffect({ view: null, wake: null })).toEqual({
      type: ECommandEffect.Refused,
      reason: NOT_IN_THE_CLOUD,
    })
  })
})
