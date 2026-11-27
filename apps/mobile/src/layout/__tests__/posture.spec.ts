import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout, postureOf, sideColumnInsetOf } from '../posture'

const insets = (edges: Partial<{ top: number; right: number; bottom: number; left: number }>) => ({
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  ...edges,
})

describe('postureOf', () => {
  it('stacks the sessions list on a compact window', () => {
    expect(postureOf({ width: 470, height: 690, insets: insets({ right: 80 }) })).toEqual({
      sessionsList: ESessionsListLayout.Stacked,
    })
    expect(postureOf({ width: 440, height: 956, insets: insets({ top: 62, bottom: 34 }) })).toEqual(
      { sessionsList: ESessionsListLayout.Stacked },
    )
  })

  it('shows the sessions list as a fixed panel on a wide landscape window', () => {
    expect(postureOf({ width: 1000, height: 703, insets: insets({ right: 80 }) })).toEqual({
      sessionsList: ESessionsListLayout.Panel,
    })
  })

  it('shows the sessions list as an overlay on a wide portrait window', () => {
    expect(
      postureOf({ width: 703, height: 1000, insets: insets({ top: 54, bottom: 20 }) }),
    ).toEqual({ sessionsList: ESessionsListLayout.Overlay })
  })

  it('measures the width without the side insets', () => {
    expect(postureOf({ width: 660, height: 900, insets: insets({ right: 80 }) }).sessionsList).toBe(
      ESessionsListLayout.Stacked,
    )
  })
})

describe('sideColumnInsetOf', () => {
  it('claims the right inset when the system column stands on the right', () => {
    expect(sideColumnInsetOf(insets({ right: 62 }))).toBe(62)
    expect(sideColumnInsetOf(insets({ right: 80 }))).toBe(80)
    expect(sideColumnInsetOf(insets({ top: 54, right: 80, bottom: 20 }))).toBe(80)
  })

  it('claims nothing on an iPhone in portrait', () => {
    expect(sideColumnInsetOf(insets({ top: 62, bottom: 34 }))).toBe(0)
  })

  it('claims nothing when both landscape edges carry the same inset', () => {
    expect(sideColumnInsetOf(insets({ right: 44, left: 44 }))).toBe(0)
  })

  it('ignores an inset too small to be the system column', () => {
    expect(sideColumnInsetOf(insets({ right: 34 }))).toBe(0)
  })
})
