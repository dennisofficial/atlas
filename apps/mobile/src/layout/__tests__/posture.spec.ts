import { describe, expect, it } from 'bun:test'

import {
  BOTTOM_BAR_CLEARANCE,
  EControlsPlacement,
  EThreadsLayout,
  postureOf,
  RAIL_BOTTOM_GAP,
  RAIL_MIN_INSET,
} from '../posture'

const insets = (edges: Partial<{ top: number; right: number; bottom: number; left: number }>) => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  ...edges,
})

describe('postureOf', () => {
  it('puts the controls in a right rail when the status bar is a right column', () => {
    expect(postureOf({ width: 470, height: 690, insets: insets({ right: 80 }) })).toEqual({
      controls: EControlsPlacement.Rail,
      threads: EThreadsLayout.Stacked,
      railWidth: 80,
      railBottom: RAIL_BOTTOM_GAP,
      clearance: { right: 80, bottom: 0 },
    })
  })

  it('uses a bottom bar when the status bar is on top', () => {
    expect(
      postureOf({ width: 703, height: 1000, insets: insets({ top: 54, bottom: 20 }) }),
    ).toEqual({
      controls: EControlsPlacement.BottomBar,
      threads: EThreadsLayout.Overlay,
      railWidth: 0,
      railBottom: 20 + RAIL_BOTTOM_GAP,
      clearance: { right: 0, bottom: 20 + BOTTOM_BAR_CLEARANCE },
    })
  })

  it('keeps a narrow right inset below the rail threshold as a bottom bar', () => {
    expect(
      postureOf({ width: 430, height: 932, insets: insets({ right: RAIL_MIN_INSET - 1 }) })
        .controls,
    ).toBe(EControlsPlacement.BottomBar)
  })

  it('keeps the symmetric landscape notch insets of a plain iPhone as a bottom bar', () => {
    expect(
      postureOf({ width: 932, height: 430, insets: insets({ left: 59, right: 59 }) }).controls,
    ).toBe(EControlsPlacement.BottomBar)
  })

  it('shows the threads as a fixed panel on a wide landscape window', () => {
    expect(postureOf({ width: 1000, height: 703, insets: insets({ right: 80 }) })).toEqual({
      controls: EControlsPlacement.Rail,
      threads: EThreadsLayout.Panel,
      railWidth: 80,
      railBottom: RAIL_BOTTOM_GAP,
      clearance: { right: 80, bottom: 0 },
    })
  })

  it('anchors the rail above the bottom inset so a taller system column never covers it', () => {
    expect(
      postureOf({ width: 470, height: 690, insets: insets({ top: 240, right: 80, bottom: 21 }) })
        .railBottom,
    ).toBe(21 + RAIL_BOTTOM_GAP)
  })

  it('measures wideness without the side insets', () => {
    expect(postureOf({ width: 660, height: 900, insets: insets({ right: 80 }) }).threads).toBe(
      EThreadsLayout.Stacked,
    )
  })
})
