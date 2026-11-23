import { describe, expect, it } from 'bun:test'

import { composerSendStateOf } from '../composer-send-state'
import { contextPercentOf } from '../context-usage'

describe('composer send state', () => {
  it('sends a draft while the agent works', () => {
    expect(
      composerSendStateOf({
        text: 'also fix the footer',
        attached: false,
        working: true,
        sending: false,
      }),
    ).toEqual({ canSend: true, showsStop: false })
  })

  it('shows stop while the agent works and the draft is empty', () => {
    expect(
      composerSendStateOf({ text: '   ', attached: false, working: true, sending: false }),
    ).toEqual({ canSend: false, showsStop: true })
  })

  it('sends a held attachment with no text', () => {
    expect(
      composerSendStateOf({ text: '', attached: true, working: false, sending: false }),
    ).toEqual({ canSend: true, showsStop: false })
  })

  it('keeps stop when the agent works and only an attachment is held', () => {
    expect(
      composerSendStateOf({ text: '', attached: true, working: true, sending: false }).showsStop,
    ).toBe(false)
  })

  it('sends nothing while a post is in flight', () => {
    expect(
      composerSendStateOf({ text: 'go', attached: false, working: false, sending: true }),
    ).toEqual({ canSend: false, showsStop: false })
  })

  it('sends nothing from an empty idle composer', () => {
    expect(
      composerSendStateOf({ text: '', attached: false, working: false, sending: false }),
    ).toEqual({ canSend: false, showsStop: false })
  })
})

describe('context percent', () => {
  it('rounds the share of the window in use', () => {
    expect(contextPercentOf({ used: 12_000, window: 200_000 })).toBe(6)
  })

  it('caps the reading at a hundred', () => {
    expect(contextPercentOf({ used: 250_000, window: 200_000 })).toBe(100)
  })

  it('reads nothing without a measurement or a window', () => {
    expect(contextPercentOf({ used: null, window: 200_000 })).toBeNull()
    expect(contextPercentOf({ used: 1_000, window: null })).toBeNull()
    expect(contextPercentOf({ used: 1_000, window: 0 })).toBeNull()
  })
})
