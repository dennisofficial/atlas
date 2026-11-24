import { describe, expect, it } from 'bun:test'

import { reconnectDelayMs } from '../reconnect'

describe('reconnectDelayMs', () => {
  it('doubles from one second up to a thirty second ceiling', () => {
    expect([1, 2, 3, 6, 7, 20].map(reconnectDelayMs)).toEqual([
      1000, 2000, 4000, 30000, 30000, 30000,
    ])
  })
})
