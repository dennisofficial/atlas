import { describe, expect, it } from 'bun:test'

import { EReturnResult } from '@dltech/atlas-core'

import { loopbackPageOf, type LoopbackCopy } from '../loopback-page'

const COPY: LoopbackCopy = {
  connected: 'Signed in to linear',
  failed: (reason) => (reason === undefined ? 'Could not sign in' : `Could not sign in: ${reason}`),
}

describe('the page a loopback return answers with', () => {
  it('says the sign-in worked and the tab can close', () => {
    const page = loopbackPageOf({ copy: COPY, outcome: { result: EReturnResult.Connected } })

    expect(page).toContain('Signed in to linear')
    expect(page).toContain('You can close this tab.')
  })

  it('uses the failing copy and the reason the return carried', () => {
    const page = loopbackPageOf({
      copy: COPY,
      outcome: { result: EReturnResult.Failed, reason: 'the provider refused' },
    })

    expect(page).toContain('Could not sign in: the provider refused')
    expect(page).not.toContain('Signed in to linear')
  })

  it('uses the failing copy when the return carries no reason', () => {
    const page = loopbackPageOf({ copy: COPY, outcome: { result: EReturnResult.Failed } })

    expect(page).toContain('Could not sign in')
  })

  it('escapes the copy rather than pasting markup into the page', () => {
    const page = loopbackPageOf({
      copy: { ...COPY, connected: '<b>linear</b> & "friends"' },
      outcome: { result: EReturnResult.Connected },
    })

    expect(page).toContain('&lt;b&gt;linear&lt;/b&gt; &amp; &quot;friends&quot;')
    expect(page).not.toContain('<b>linear</b>')
  })
})
