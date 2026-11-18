import { describe, expect, it } from 'bun:test'

import { WAKE_DEBOUNCE_MS, wakeDebounceProvider } from './github-sandbox-wake-debounce'

describe('wakeDebounceProvider', () => {
  it('debounces wake boots by five seconds', () => {
    expect(wakeDebounceProvider().useValue).toBe(WAKE_DEBOUNCE_MS)
  })
})
