import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '../channel-wire'
import { revokeGrant, type RequestChannel } from '../session-tools'

describe('revokeGrant', () => {
  it('sends revoke-grant and parses the reply', async () => {
    const requests: { op: EClientRequest; params: unknown }[] = []
    const channel: RequestChannel = {
      request: async ({ op, params }) => {
        requests.push({ op, params })
        return { revoked: true }
      },
    }
    const reply = await revokeGrant({
      channel,
      threadId: 't-1',
      grantId: 'g-1',
    })
    expect(reply).toEqual({ revoked: true })
    expect(requests).toEqual([
      {
        op: EClientRequest.RevokeGrant,
        params: { threadId: 't-1', grantId: 'g-1' },
      },
    ])
  })
})
