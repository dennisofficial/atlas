import { describe, expect, it } from 'bun:test'

import { AuthApiError, UNREACHABLE } from '@/lib/auth-api'

import { SIGNED_OUT_CODE } from '../stream-token'
import { tokenSourceOf } from '../session-stream'

describe('tokenSourceOf', () => {
  it('passes the token through', async () => {
    let signedOut = 0
    const getToken = tokenSourceOf({
      fetchToken: async () => 'tok',
      onSignedOut: () => {
        signedOut += 1
      },
    })

    expect(await getToken()).toBe('tok')
    expect(signedOut).toBe(0)
  })

  it('reports a signed-out user and still fails the token', async () => {
    let signedOut = 0
    const getToken = tokenSourceOf({
      fetchToken: async () => {
        throw new AuthApiError('Sign in', { code: SIGNED_OUT_CODE })
      },
      onSignedOut: () => {
        signedOut += 1
      },
    })

    await expect(getToken()).rejects.toBeInstanceOf(AuthApiError)
    expect(signedOut).toBe(1)
  })

  it('treats an unreachable cloud as transient', async () => {
    let signedOut = 0
    const getToken = tokenSourceOf({
      fetchToken: async () => {
        throw new AuthApiError(UNREACHABLE)
      },
      onSignedOut: () => {
        signedOut += 1
      },
    })

    await expect(getToken()).rejects.toBeInstanceOf(AuthApiError)
    expect(signedOut).toBe(0)
  })
})
