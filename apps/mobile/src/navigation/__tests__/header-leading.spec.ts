import { describe, expect, it } from 'bun:test'

import { EControlsPlacement, ESessionsListLayout, type TPosture } from '../../layout/posture'
import {
  EHeaderLeadingItem,
  HEADER_BUTTON_SLOT,
  HEADER_EDGE_SLACK,
  HEADER_TITLE_MIN_WIDTH,
  leadingTitleWidthOf,
  sessionHeaderLeadingOf,
  tabHeaderLeadingOf,
} from '../header-leading'

const postureWith = ({
  controls,
  sessionsList,
}: {
  controls: EControlsPlacement
  sessionsList: ESessionsListLayout
}): TPosture => ({
  controls,
  sessionsList,
  railWidth: controls === EControlsPlacement.Rail ? 80 : 0,
  railBottom: 0,
  clearance: { bottom: 0 },
})

describe('tabHeaderLeadingOf', () => {
  it('puts the account button before the title only while the controls sit in a bottom bar', () => {
    expect(
      tabHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          sessionsList: ESessionsListLayout.Stacked,
        }),
      }),
    ).toEqual([EHeaderLeadingItem.Account])
  })

  it('leaves the title alone when the rail already holds the account button', () => {
    expect(
      tabHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.Rail,
          sessionsList: ESessionsListLayout.Panel,
        }),
      }),
    ).toEqual([])
  })
})

describe('sessionHeaderLeadingOf', () => {
  it('offers the sessions drawer whenever the list is not a fixed panel', () => {
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          sessionsList: ESessionsListLayout.Stacked,
        }),
      }),
    ).toEqual([EHeaderLeadingItem.Sessions])
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          sessionsList: ESessionsListLayout.Overlay,
        }),
      }),
    ).toEqual([EHeaderLeadingItem.Sessions])
  })

  it('offers no drawer button while the fixed panel already shows the list', () => {
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.Rail,
          sessionsList: ESessionsListLayout.Panel,
        }),
      }),
    ).toEqual([])
  })
})

describe('leadingTitleWidthOf', () => {
  it('gives the title the bar width left after the buttons and the rail column', () => {
    const posture = postureWith({
      controls: EControlsPlacement.Rail,
      sessionsList: ESessionsListLayout.Overlay,
    })
    expect(leadingTitleWidthOf({ windowWidth: 470, posture, buttons: 2 })).toBe(
      470 - 80 - HEADER_BUTTON_SLOT * 2 - HEADER_EDGE_SLACK,
    )
  })

  it('never shrinks the title below its minimum on a very narrow window', () => {
    expect(
      leadingTitleWidthOf({
        windowWidth: 200,
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          sessionsList: ESessionsListLayout.Stacked,
        }),
        buttons: 2,
      }),
    ).toBe(HEADER_TITLE_MIN_WIDTH)
  })
})
