import { afterEach, describe, expect, it, vi } from 'vitest'

import { WAKE_DEBOUNCE_MS, wakeDebounceProvider } from './github-sandbox-wake-debounce'

describe('wakeDebounceProvider', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('drops the debounce on Vercel, where the wakeClaim CAS is the dedupe', () => {
    vi.stubEnv('VERCEL', '1')

    expect(wakeDebounceProvider().useValue).toBe(0)
  })

  it('keeps the debounce elsewhere', () => {
    vi.stubEnv('VERCEL', '')

    expect(wakeDebounceProvider().useValue).toBe(WAKE_DEBOUNCE_MS)
  })
})
