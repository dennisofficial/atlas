import { describe, expect, it } from 'bun:test'

import { bearerSubprotocolOf, tokenFromSubprotocols } from '../../cloud/channel-wire'
import { bearerToken, offeredSubprotocols, tokenMatches } from '../token-guard'

describe('tokenMatches', () => {
  it('accepts the token it was given', () => {
    expect(tokenMatches({ expected: 'secret', offered: 'secret' })).toBe(true)
  })

  it('refuses a different token, a prefix of it, and nothing at all', () => {
    expect(tokenMatches({ expected: 'secret', offered: 'secre' })).toBe(false)
    expect(tokenMatches({ expected: 'secret', offered: 'secretly' })).toBe(false)
    expect(tokenMatches({ expected: 'secret', offered: null })).toBe(false)
  })

  it('refuses everything when no token was configured', () => {
    expect(tokenMatches({ expected: '', offered: '' })).toBe(false)
  })
})

describe('bearerToken', () => {
  it('reads the token out of an authorization header', () => {
    expect(bearerToken('Bearer secret')).toBe('secret')
    expect(bearerToken('bearer secret')).toBe('secret')
  })

  it('refuses a header that is not a bearer, or is empty', () => {
    expect(bearerToken(null)).toBe(null)
    expect(bearerToken('Basic secret')).toBe(null)
    expect(bearerToken('Bearer   ')).toBe(null)
  })
})

describe('offeredSubprotocols', () => {
  it('splits the header the way the contract reads it back', () => {
    const header = `atlas.v1, ${bearerSubprotocolOf('secret')}`

    expect(tokenFromSubprotocols(offeredSubprotocols(header))).toBe('secret')
  })

  it('reads an absent header as nothing offered', () => {
    expect(offeredSubprotocols(null)).toEqual([])
  })
})
