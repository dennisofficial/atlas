import { describe, expect, it } from 'bun:test'

import { BANNER_EDGE_GAP, BANNER_TOP_GAP, bannerFrameOf } from '../banner-frame'

describe('bannerFrameOf', () => {
  it('keeps the banner clear of the right system column on iPhone Duo', () => {
    expect(bannerFrameOf({ top: 0, right: 80, bottom: 21, left: 0 })).toEqual({
      top: BANNER_TOP_GAP,
      left: BANNER_EDGE_GAP,
      right: 80 + BANNER_EDGE_GAP,
    })
  })

  it('sits below the status bar on a plain iPhone', () => {
    expect(bannerFrameOf({ top: 54, right: 0, bottom: 34, left: 0 })).toEqual({
      top: 54 + BANNER_TOP_GAP,
      left: BANNER_EDGE_GAP,
      right: BANNER_EDGE_GAP,
    })
  })
})
