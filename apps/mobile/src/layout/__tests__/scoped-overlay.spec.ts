import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout } from '../posture'
import { defaultOverlayOf, scopedOverlayOf, type TScopedOverlay } from '../scoped-overlay'

const overlayOn = ({
  open,
  layout,
  screen,
}: {
  open: boolean
  layout: ESessionsListLayout
  screen: string | null
}): TScopedOverlay => ({ open, scope: { layout, screen } })

describe('scopedOverlayOf', () => {
  it('keeps the state while the layout and the screen stay the same', () => {
    const overlay = overlayOn({ open: true, layout: ESessionsListLayout.Overlay, screen: 'ses_a' })
    expect(
      scopedOverlayOf({
        overlay,
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_a' },
        openByDefault: false,
      }),
    ).toBe(overlay)
  })

  it('goes back to closed when a Duo turns from landscape back to portrait', () => {
    const scope = { layout: ESessionsListLayout.Overlay, screen: 'ses_a' }
    expect(
      scopedOverlayOf({
        overlay: overlayOn({ open: true, layout: ESessionsListLayout.Panel, screen: null }),
        scope,
        openByDefault: false,
      }),
    ).toEqual(defaultOverlayOf({ scope, openByDefault: false }))
  })

  it('goes back to open when a Duo turns to landscape with the panel hidden earlier', () => {
    expect(
      scopedOverlayOf({
        overlay: overlayOn({ open: false, layout: ESessionsListLayout.Overlay, screen: 'ses_a' }),
        scope: { layout: ESessionsListLayout.Panel, screen: null },
        openByDefault: true,
      }).open,
    ).toBe(true)
  })

  it('goes back to closed when the phone unfolds or folds', () => {
    expect(
      scopedOverlayOf({
        overlay: overlayOn({ open: true, layout: ESessionsListLayout.Stacked, screen: 'ses_a' }),
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_a' },
        openByDefault: false,
      }).open,
    ).toBe(false)
  })

  it('goes back to closed when another session opens, such as a new one after send', () => {
    expect(
      scopedOverlayOf({
        overlay: overlayOn({ open: true, layout: ESessionsListLayout.Overlay, screen: 'ses_a' }),
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_new' },
        openByDefault: false,
      }).open,
    ).toBe(false)
  })
})
