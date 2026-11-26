import { describe, expect, it } from 'bun:test'

import {
  BOTTOM_BAR_CLEARANCE,
  contentInsetsOf,
  modalInsetsOf,
  EControlsPlacement,
  ESessionsListLayout,
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
      sessionsList: ESessionsListLayout.Stacked,
      railWidth: 80,
      railBottom: RAIL_BOTTOM_GAP,
      clearance: { bottom: 0 },
    })
  })

  it('uses a bottom bar when the status bar is on top', () => {
    expect(
      postureOf({ width: 703, height: 1000, insets: insets({ top: 54, bottom: 20 }) }),
    ).toEqual({
      controls: EControlsPlacement.BottomBar,
      sessionsList: ESessionsListLayout.Overlay,
      railWidth: 0,
      railBottom: 20 + RAIL_BOTTOM_GAP,
      clearance: { bottom: 20 + BOTTOM_BAR_CLEARANCE },
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

  it('shows the sessions list as a fixed panel on a wide landscape window', () => {
    expect(postureOf({ width: 1000, height: 703, insets: insets({ right: 80 }) })).toEqual({
      controls: EControlsPlacement.Rail,
      sessionsList: ESessionsListLayout.Panel,
      railWidth: 80,
      railBottom: RAIL_BOTTOM_GAP,
      clearance: { bottom: 0 },
    })
  })

  it('anchors the rail above the bottom inset so a taller system column never covers it', () => {
    expect(
      postureOf({ width: 470, height: 690, insets: insets({ top: 240, right: 80, bottom: 21 }) })
        .railBottom,
    ).toBe(21 + RAIL_BOTTOM_GAP)
  })

  it('measures wideness without the side insets', () => {
    expect(postureOf({ width: 660, height: 900, insets: insets({ right: 80 }) }).sessionsList).toBe(
      ESessionsListLayout.Stacked,
    )
  })
})

describe('contentInsetsOf', () => {
  it('gives the rail column to the rail so screens inside the frame see no right inset', () => {
    const window = insets({ top: 0, right: 80, bottom: 21 })
    const posture = postureOf({ width: 470, height: 690, insets: window })
    expect(contentInsetsOf({ insets: window, posture })).toEqual(insets({ bottom: 21 }))
  })

  it('keeps every inset when the controls are a bottom bar', () => {
    const window = insets({ top: 54, left: 59, right: 59, bottom: 20 })
    const posture = postureOf({ width: 932, height: 430, insets: window })
    expect(contentInsetsOf({ insets: window, posture })).toEqual(window)
  })
})

describe('modalInsetsOf', () => {
  it('keeps the rail column clear when the screen sees the frame insets', () => {
    const window = insets({ top: 78, right: 80, bottom: 34 })
    const posture = postureOf({ width: 626, height: 890, insets: window })
    const frame = contentInsetsOf({ insets: window, posture })
    expect(modalInsetsOf({ insets: frame, posture })).toEqual(window)
  })

  it('keeps the window insets when the screen sees them directly', () => {
    const window = insets({ top: 78, right: 80, bottom: 34 })
    const posture = postureOf({ width: 626, height: 890, insets: window })
    expect(modalInsetsOf({ insets: window, posture })).toEqual(window)
  })

  it('keeps every inset when there is no rail', () => {
    const window = insets({ top: 62, bottom: 34 })
    const posture = postureOf({ width: 466, height: 678, insets: window })
    expect(modalInsetsOf({ insets: window, posture })).toEqual(window)
  })
})
