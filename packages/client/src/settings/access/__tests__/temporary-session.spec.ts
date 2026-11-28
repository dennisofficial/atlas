import { describe, expect, it } from 'bun:test'
import { revealWithTemporarySession } from '../temporary-session'
import {
  beginRevealRequest,
  cancelRevealRequest,
  ERevealRequestStatus,
  revealRequestPending,
} from '../reveal-request'

describe('temporary reveal sessions', () => {
  it('revokes a Google or password session after a successful reveal', async () => {
    const calls: string[] = []
    await revealWithTemporarySession({
      token: 'temporary',
      isPending: () => true,
      reveal: async (token) => {
        calls.push(`reveal:${token}`)
      },
      revoke: async (token) => {
        calls.push(`revoke:${token}`)
      },
    })
    expect(calls).toEqual(['reveal:temporary', 'revoke:temporary'])
  })

  it('revokes the session even when revealing fails', async () => {
    const revoked: string[] = []
    await expect(
      revealWithTemporarySession({
        token: 'temporary',
        isPending: () => true,
        reveal: async () => {
          throw new Error('reveal failed')
        },
        revoke: async (token) => {
          revoked.push(token)
        },
      }),
    ).rejects.toThrow('reveal failed')
    expect(revoked).toEqual(['temporary'])
  })

  it('revokes without revealing when Google returns after cancel or unmount', async () => {
    let request = beginRevealRequest({ id: 0, status: ERevealRequestStatus.Cancelled })
    const { id } = request
    request = cancelRevealRequest(request)
    const calls: string[] = []
    await revealWithTemporarySession({
      token: 'google-session',
      isPending: () => revealRequestPending({ request, id }),
      reveal: async () => {
        calls.push('reveal')
      },
      revoke: async (token) => {
        calls.push(token)
      },
    })
    expect(calls).toEqual(['google-session'])
  })
})
