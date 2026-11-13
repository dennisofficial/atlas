import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { ETranscriptKind, type RequestItem } from '../data/transcript-items'
import { TranscriptRequest } from '../transcript/transcript-request'

const PROMPT = 'Paste the login code from your email'

const itemOf = (extra: Partial<RequestItem> = {}): RequestItem => ({
  kind: ETranscriptKind.Request,
  id: 'evt_1',
  text: PROMPT,
  requestId: 'req_1',
  prompt: PROMPT,
  secret: true,
  state: 'pending',
  expiresAt: '2026-11-12T10:15:00.000Z',
  ...extra,
})

const render = (extra: Partial<RequestItem> = {}) =>
  renderToStaticMarkup(<TranscriptRequest item={itemOf(extra)} />)

describe('the operator request row in the transcript', () => {
  it('draws nothing while the card above the composer holds the question', () => {
    expect(render()).toBe('')
  })

  it('reads the operator answered, without the value', () => {
    const html = render({ state: 'delivered', path: '/tmp/requests/req_1', bytes: 7 })

    expect(html).toContain('The operator answered')
    expect(html).toContain(PROMPT)
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<textarea')
  })

  it('reads the expiry of an unanswered request', () => {
    const html = render({ state: 'expired' })

    expect(html).toContain('The request expired')
    expect(html).not.toContain('<input')
  })

  it('reads why the request was cancelled', () => {
    const html = render({ state: 'cancelled', reason: 'the turn was interrupted' })

    expect(html).toContain('The operator cancelled the request')
    expect(html).toContain('the turn was interrupted')
  })

  it('reads an abandoned request as the session giving up, not the operator cancelling', () => {
    const html = render({ state: 'abandoned', reason: 'abandoned' })

    expect(html).toContain('The session stopped waiting for your answer')
    expect(html).not.toContain('The operator cancelled the request')
  })

  it('reads a failed delivery as an error', () => {
    const html = render({ state: 'failed', reason: 'the sandbox refused the write' })

    expect(html).toContain('Could not deliver the operator&#x27;s value')
    expect(html).toContain('the sandbox refused the write')
    expect(html).toContain('data-status="error"')
  })
})
