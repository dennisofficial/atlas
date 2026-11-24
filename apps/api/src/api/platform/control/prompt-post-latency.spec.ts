import { describe, expect, it } from 'bun:test'

import { clientToApiMsOf } from './prompt-post-latency'

const SENT_AT = '2026-11-20T10:00:00.000Z'

describe('clientToApiMsOf', () => {
  it('measures a send that reached the API after it left the client', () => {
    expect(
      clientToApiMsOf({ sentAt: SENT_AT, serverNow: Date.parse('2026-11-20T10:00:00.250Z') }),
    ).toBe(250)
  })

  it('is zero when both clocks agree', () => {
    expect(clientToApiMsOf({ sentAt: SENT_AT, serverNow: Date.parse(SENT_AT) })).toBe(0)
  })

  it('drops a client whose clock runs ahead of the server', () => {
    expect(
      clientToApiMsOf({ sentAt: SENT_AT, serverNow: Date.parse('2026-11-20T09:59:59.000Z') }),
    ).toBeUndefined()
  })

  it('drops a delay too long to be a send', () => {
    expect(
      clientToApiMsOf({ sentAt: SENT_AT, serverNow: Date.parse('2026-11-20T10:01:00.001Z') }),
    ).toBeUndefined()
  })

  it('drops a stamp that does not parse and a client that sends none', () => {
    expect(clientToApiMsOf({ sentAt: 'not-a-time', serverNow: 0 })).toBeUndefined()
    expect(clientToApiMsOf({ sentAt: undefined, serverNow: 0 })).toBeUndefined()
  })
})
