import type { TInsets } from '../layout/posture'

export const BANNER_EDGE_GAP = 12
export const BANNER_TOP_GAP = 8

export type TBannerFrame = { top: number; left: number; right: number }

export const bannerFrameOf = (insets: TInsets): TBannerFrame => ({
  top: insets.top + BANNER_TOP_GAP,
  left: insets.left + BANNER_EDGE_GAP,
  right: insets.right + BANNER_EDGE_GAP,
})
