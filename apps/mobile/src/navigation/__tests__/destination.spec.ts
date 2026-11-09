import { describe, expect, it } from 'bun:test'

import { destinationOfUrl } from '../destination'

describe('destinationOfUrl', () => {
  it('reads a session from a bare path', () => {
    expect(destinationOfUrl('/sessions/vis-check-session')).toEqual({
      pathname: '/sessions/[id]',
      params: { id: 'vis-check-session' },
    })
  })

  it('reads a session from an absolute url, ignoring query and hash', () => {
    expect(destinationOfUrl('http://localhost:23176/sessions/ses_1?title=Hi#top')).toEqual({
      pathname: '/sessions/[id]',
      params: { id: 'ses_1' },
    })
  })

  it('reads a thread from the app scheme', () => {
    expect(destinationOfUrl('atlas://thread/thr_1')).toEqual({
      pathname: '/thread/[id]',
      params: { id: 'thr_1' },
    })
  })

  it('accepts the app scheme with a leading triple slash', () => {
    expect(destinationOfUrl('atlas:///sessions/ses_2')).toEqual({
      pathname: '/sessions/[id]',
      params: { id: 'ses_2' },
    })
  })

  it('decodes an escaped id', () => {
    expect(destinationOfUrl('/sessions/ses%201')).toEqual({
      pathname: '/sessions/[id]',
      params: { id: 'ses 1' },
    })
  })

  it('ignores screens that are not a session', () => {
    expect(destinationOfUrl('/')).toBeUndefined()
    expect(destinationOfUrl('/sign-in')).toBeUndefined()
    expect(destinationOfUrl('/settings')).toBeUndefined()
    expect(destinationOfUrl('/auth/callback?code=1')).toBeUndefined()
    expect(destinationOfUrl('/sessions')).toBeUndefined()
    expect(destinationOfUrl('/sessions/a/b')).toBeUndefined()
  })

  it('ignores nothing at all', () => {
    expect(destinationOfUrl(undefined)).toBeUndefined()
    expect(destinationOfUrl(null)).toBeUndefined()
    expect(destinationOfUrl('')).toBeUndefined()
  })

  it('survives a malformed url', () => {
    expect(destinationOfUrl('http://[bad')).toBeUndefined()
    expect(destinationOfUrl('/sessions/%E0%A4%A')).toEqual({
      pathname: '/sessions/[id]',
      params: { id: '%E0%A4%A' },
    })
  })
})
