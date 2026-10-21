import { afterEach, describe, expect, it } from 'vitest'

import {
  applyLogo,
  ELogo,
  logo,
  logoOf,
  logoVersion,
  SHIPPED_LOGO,
  subscribeLogo,
} from '../logo-store'

afterEach(() => {
  applyLogo(SHIPPED_LOGO)
})

describe('applyLogo', () => {
  it('ships the mark alone', () => {
    expect(SHIPPED_LOGO).toBe(ELogo.Mark)
    expect(logo()).toBe(ELogo.Mark)
  })

  it('bumps a numeric version, which is what useSyncExternalStore snapshots', () => {
    const before = logoVersion()
    applyLogo(ELogo.Wordmark)
    expect(logoVersion()).toBe(before + 1)
    expect(logo()).toBe(ELogo.Wordmark)
  })

  it('says nothing when the logo is already the one asked for', () => {
    applyLogo(ELogo.Mark)
    let calls = 0
    const unsubscribe = subscribeLogo(() => {
      calls += 1
    })

    applyLogo(ELogo.Mark)
    unsubscribe()

    expect(calls).toBe(0)
  })

  it('stops calling a listener that unsubscribed', () => {
    let calls = 0
    const unsubscribe = subscribeLogo(() => {
      calls += 1
    })
    unsubscribe()

    applyLogo(ELogo.Wordmark)
    expect(calls).toBe(0)
  })
})

describe('logoOf', () => {
  it('reads the two values the setting offers', () => {
    expect(logoOf('mark')).toBe(ELogo.Mark)
    expect(logoOf('wordmark')).toBe(ELogo.Wordmark)
  })

  it('falls back to the mark for anything a hand-edited settings file might hold', () => {
    expect(logoOf('lambda')).toBe(ELogo.Mark)
    expect(logoOf('')).toBe(ELogo.Mark)
  })
})
