import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout } from '../posture'
import { closedOverlayOf, scopedOverlayOf, type TScopedOverlay } from '../scoped-overlay'

const openOn = (layout: ESessionsListLayout, screen: string | null): TScopedOverlay => ({
  open: true,
  scope: { layout, screen },
})

describe('scopedOverlayOf', () => {
  it('stays open while the layout and the screen stay the same', () => {
    const overlay = openOn(ESessionsListLayout.Overlay, 'ses_a')
    expect(
      scopedOverlayOf({ overlay, scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_a' } }),
    ).toBe(overlay)
  })

  it('closes when a Duo turns from landscape back to portrait', () => {
    expect(
      scopedOverlayOf({
        overlay: openOn(ESessionsListLayout.Panel, 'ses_a'),
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_a' },
      }),
    ).toEqual(closedOverlayOf({ layout: ESessionsListLayout.Overlay, screen: 'ses_a' }))
  })

  it('closes when the phone unfolds or folds', () => {
    expect(
      scopedOverlayOf({
        overlay: openOn(ESessionsListLayout.Stacked, 'ses_a'),
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_a' },
      }).open,
    ).toBe(false)
  })

  it('closes when another session opens, such as a new one after send', () => {
    expect(
      scopedOverlayOf({
        overlay: openOn(ESessionsListLayout.Overlay, 'ses_a'),
        scope: { layout: ESessionsListLayout.Overlay, screen: 'ses_new' },
      }),
    ).toEqual(closedOverlayOf({ layout: ESessionsListLayout.Overlay, screen: 'ses_new' }))
  })

  it('closes when the first session opens from the empty sessions screen', () => {
    expect(
      scopedOverlayOf({
        overlay: openOn(ESessionsListLayout.Stacked, null),
        scope: { layout: ESessionsListLayout.Stacked, screen: 'ses_a' },
      }).open,
    ).toBe(false)
  })
})
