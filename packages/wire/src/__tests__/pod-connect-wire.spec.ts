import { describe, expect, it } from 'bun:test'

import { podConnectReplySchema } from '../web'

describe('pod connect wire', () => {
  it('parses a url, a non-empty token and an ISO expiry', () => {
    const reply = {
      url: 'https://serve.example.test',
      token: 'ct1.a.b',
      expiresAt: '2026-10-22T12:01:00.000Z',
      threadId: 'thr-1',
    }

    expect(podConnectReplySchema.safeParse(reply).success).toBe(true)
    expect(podConnectReplySchema.safeParse({ ...reply, threadId: '' }).success).toBe(false)
    expect(podConnectReplySchema.safeParse({ ...reply, token: '' }).success).toBe(false)
    expect(podConnectReplySchema.safeParse({ ...reply, url: 'nope' }).success).toBe(false)
    expect(podConnectReplySchema.safeParse({ ...reply, expiresAt: 'tomorrow' }).success).toBe(false)
  })
})
