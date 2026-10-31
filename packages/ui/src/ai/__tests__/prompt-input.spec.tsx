import { describe, expect, it } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { PromptInput, canSend } from '../prompt-input'

describe('PromptInput', () => {
  it('disables send when the field is empty', () => {
    const html = renderToStaticMarkup(<PromptInput />)

    expect(html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0]).toContain(' disabled=""')
  })

  it('enables send when there is text', () => {
    const html = renderToStaticMarkup(<PromptInput defaultValue="fix the build" />)
    const send = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''

    expect(send).not.toContain(' disabled=""')
  })

  it('swaps send for stop while busy', () => {
    const html = renderToStaticMarkup(<PromptInput defaultValue="x" busy />)

    expect(html).toContain('aria-label="Stop"')
    expect(html).not.toContain('aria-label="Send"')
  })

  it('defaults to autocorrect off during server rendering without disabling spellcheck', () => {
    const field = renderToStaticMarkup(<PromptInput />).match(/<textarea[^>]*>/)?.[0] ?? ''

    expect(field).not.toContain('spellCheck="false"')
    expect(field).toContain('autoCorrect="off"')
  })

  it('keeps the text in a read-only field with a spinner while sending', () => {
    const html = renderToStaticMarkup(<PromptInput defaultValue="fix the build" sending />)
    const send = html.match(/<button[^>]*aria-label="Sending"[^>]*>/)?.[0] ?? ''

    expect(html).toContain('fix the build')
    expect(html.match(/<textarea[^>]*>/)?.[0]).toContain('readOnly=""')
    expect(send).toContain(' disabled=""')
    expect(html).toContain('data-slot="spinner"')
  })

  it('renders attachment chips with a remove button', () => {
    const html = renderToStaticMarkup(
      <PromptInput attachments={[{ id: '1', name: 'trace.log' }]} />,
    )

    expect(html).toContain('trace.log')
    expect(html).toContain('aria-label="Remove trace.log"')
  })

  it('canSend rejects whitespace and busy states', () => {
    expect(canSend({ text: '   ', busy: false })).toBe(false)
    expect(canSend({ text: 'go', busy: true })).toBe(false)
    expect(canSend({ text: 'go', busy: false })).toBe(true)
  })

  it('canSend allows a busy submit only when queueing is on', () => {
    expect(canSend({ text: 'go', busy: true, queueWhileBusy: true })).toBe(true)
    expect(canSend({ text: '  ', busy: true, queueWhileBusy: true })).toBe(false)
    expect(canSend({ text: 'go', busy: true, queueWhileBusy: false })).toBe(false)
  })

  it('canSend never allows a send while sending', () => {
    expect(canSend({ text: 'go', busy: false, sending: true, queueWhileBusy: true })).toBe(false)
  })

  it('keeps send beside stop when queueing while busy', () => {
    const html = renderToStaticMarkup(<PromptInput defaultValue="x" busy queueWhileBusy />)
    const send = html.match(/<button[^>]*aria-label="Send"[^>]*>/)?.[0] ?? ''

    expect(html).toContain('aria-label="Stop"')
    expect(send).not.toContain(' disabled=""')
  })
})
