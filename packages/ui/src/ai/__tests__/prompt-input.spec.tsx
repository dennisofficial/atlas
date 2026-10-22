import { describe, expect, it } from 'vitest'
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
})
