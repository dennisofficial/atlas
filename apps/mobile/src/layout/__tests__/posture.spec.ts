import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout, postureOf } from '../posture'

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
