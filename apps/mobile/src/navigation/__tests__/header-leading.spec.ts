import { describe, expect, it } from 'bun:test'

import { ESessionsListLayout, type TPosture } from '../../layout/posture'
import {
  EHeaderLeadingItem,
  HEADER_BUTTON_SLOT,
  HEADER_EDGE_SLACK,
  HEADER_TITLE_MIN_WIDTH,
  leadingTitleWidthOf,
  sessionHeaderLeadingOf,
} from '../header-leading'

const postureWith = ({ sessionsList }: { sessionsList: ESessionsListLayout }): TPosture => ({
  sessionsList,
})

describe('sessionHeaderLeadingOf', () => {
  it('offers the sessions drawer whenever the list is not a fixed panel', () => {
    expect(
      sessionHeaderLeadingOf({
        drawerOpen: true,
        posture: postureWith({ sessionsList: ESessionsListLayout.Stacked }),
      }),
    ).toEqual([EHeaderLeadingItem.Sessions])
    expect(
      sessionHeaderLeadingOf({
        drawerOpen: true,
        posture: postureWith({ sessionsList: ESessionsListLayout.Overlay }),
      }),
    ).toEqual([EHeaderLeadingItem.Sessions])
  })

  it('offers the sessions button to bring back a hidden fixed panel', () => {
    expect(
      sessionHeaderLeadingOf({
        drawerOpen: false,
        posture: postureWith({ sessionsList: ESessionsListLayout.Panel }),
      }),
    ).toEqual([EHeaderLeadingItem.Sessions])
  })

  it('offers no drawer button while the fixed panel already shows the list', () => {
    expect(
      sessionHeaderLeadingOf({
        drawerOpen: true,
        posture: postureWith({ sessionsList: ESessionsListLayout.Panel }),
      }),
    ).toEqual([])
  })
})

describe('leadingTitleWidthOf', () => {
  it('gives the title the bar width left after the buttons', () => {
    expect(leadingTitleWidthOf({ barWidth: 470, buttons: 2 })).toBe(
      470 - HEADER_BUTTON_SLOT * 2 - HEADER_EDGE_SLACK,
    )
  })

  it('fits a lone glass title inside the bar of a closed Duo', () => {
    const barWidth = 466
    const barMargins = 2 * 16
    const glassInset = 8
    const pill = leadingTitleWidthOf({ barWidth, buttons: 0 }) + glassInset
    expect(pill).toBeLessThanOrEqual(barWidth - barMargins)
    expect(barWidth - barMargins - pill).toBeLessThanOrEqual(16)
  })

  it('never shrinks the title below its minimum on a very narrow window', () => {
    expect(leadingTitleWidthOf({ barWidth: 200, buttons: 2 })).toBe(HEADER_TITLE_MIN_WIDTH)
  })
})
