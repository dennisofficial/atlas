import { describe, expect, it } from 'bun:test'

import {
  acceptRevealRequest,
  beginRevealRequest,
  cancelRevealRequest,
  ERevealRequestStatus,
  revealRequestPending,
  type RevealRequest,
} from '../reveal-request'

const initial: RevealRequest = { id: 0, status: ERevealRequestStatus.Cancelled }

describe('reveal request', () => {
  it('accepts a pending result once', () => {
    const request = beginRevealRequest(initial)
    expect(revealRequestPending({ request, id: request.id })).toBe(true)
    const accepted = acceptRevealRequest({ request, id: request.id })
    expect(accepted.status).toBe(ERevealRequestStatus.Accepted)
    expect(revealRequestPending({ request: accepted, id: request.id })).toBe(false)
    expect(acceptRevealRequest({ request: accepted, id: request.id })).toBe(accepted)
  })

  it('ignores a result arriving after cancel or unmount', async () => {
    let request = beginRevealRequest(initial)
    const id = request.id
    const completion = Promise.resolve('plaintext').then(() => {
      request = acceptRevealRequest({ request, id })
    })
    request = cancelRevealRequest(request)
    await completion
    expect(request.status).toBe(ERevealRequestStatus.Cancelled)
    expect(revealRequestPending({ request, id })).toBe(false)
  })

  it('ignores a previous result when a new request has started', () => {
    const first = beginRevealRequest(initial)
    const next = beginRevealRequest(cancelRevealRequest(first))
    expect(acceptRevealRequest({ request: next, id: first.id })).toBe(next)
    expect(revealRequestPending({ request: next, id: first.id })).toBe(false)
    expect(acceptRevealRequest({ request: next, id: next.id }).status).toBe(
      ERevealRequestStatus.Accepted,
    )
  })
})
