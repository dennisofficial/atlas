import { EReturnResult } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { browserReturns, createReturnStore } from '../store'

const connected = { result: EReturnResult.Connected }
const failed = { result: EReturnResult.Failed, reason: 'denied' }

describe('the browser-return store', () => {
  it('reads back the outcome it remembered for a state', () => {
    const store = createReturnStore()
    store.remember({ state: 'state-a', outcome: connected })

    expect(store.read('state-a')).toEqual(connected)
  })

  it('reads nothing for a state it never saw or for no state at all', () => {
    const store = createReturnStore()

    expect(store.read('state-b')).toBeUndefined()
    expect(store.read(undefined)).toBeUndefined()
  })

  it('keeps the last outcome of a state', () => {
    const store = createReturnStore()
    store.remember({ state: 'state-c', outcome: connected })
    store.remember({ state: 'state-c', outcome: failed })

    expect(store.read('state-c')).toEqual(failed)
  })

  it('tells a subscriber about each remembered outcome until it unsubscribes', () => {
    const store = createReturnStore()
    let changes = 0
    const stop = store.subscribe(() => {
      changes += 1
    })

    store.remember({ state: 'state-d', outcome: connected })
    store.remember({ state: 'state-e', outcome: failed })
    stop()
    store.remember({ state: 'state-f', outcome: connected })

    expect(changes).toBe(2)
    expect(store.read('state-f')).toEqual(connected)
  })

  it('keeps one store for every surface of a tab', () => {
    browserReturns.remember({ state: 'state-shared', outcome: connected })

    expect(browserReturns.read('state-shared')).toEqual(connected)
  })
})
