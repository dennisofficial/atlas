import { describe, expect, it } from 'bun:test'

import { reattachNotice } from '../lift-notices'

describe('the reattach notice', () => {
  it('says the turn survived when serve greeted with one in flight', () => {
    expect(reattachNotice({ created: false, turnInFlight: true })).toBe(
      'reattached — the sandbox and its filesystem are as you left them; the turn kept running',
    )
  })

  it('says no turn was running when serve greeted idle', () => {
    expect(reattachNotice({ created: false, turnInFlight: false })).toBe(
      'reattached — the sandbox and its filesystem are as you left them; no turn was running',
    )
  })

  it('says the workspace was restored when the sandbox booted fresh', () => {
    const notice = reattachNotice({ created: true, turnInFlight: false })

    expect(notice).toContain('booted fresh')
    expect(notice).toContain('last context upload')
    expect(notice).not.toContain('as you left them')
  })
})
