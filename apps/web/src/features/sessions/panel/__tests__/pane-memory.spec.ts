import { describe, expect, it } from 'bun:test'

import { DETAILS_CARD_OPEN_BY_DEFAULT, detailsCardOpenOf } from '../pane-memory'

describe('details card memory', () => {
  it('opens the card when the session remembered nothing', () => {
    expect(DETAILS_CARD_OPEN_BY_DEFAULT).toBe(true)
    expect(detailsCardOpenOf(undefined)).toBe(true)
  })

  it('keeps a remembered close, and a remembered open', () => {
    expect(detailsCardOpenOf(false)).toBe(false)
    expect(detailsCardOpenOf(true)).toBe(true)
  })
})
