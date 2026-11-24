import { describe, expect, it } from 'bun:test'

import { EControlsPlacement, EThreadsLayout, type TPosture } from '../../layout/posture'
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
  threads,
}: {
  controls: EControlsPlacement
  threads: EThreadsLayout
}): TPosture => ({
  controls,
  threads,
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
          threads: EThreadsLayout.Stacked,
        }),
      }),
    ).toEqual([EHeaderLeadingItem.Account])
  })

  it('leaves the title alone when the rail already holds the account button', () => {
    expect(
      tabHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.Rail,
          threads: EThreadsLayout.Panel,
        }),
      }),
    ).toEqual([])
  })
})

describe('sessionHeaderLeadingOf', () => {
  it('offers the threads panel only when the panel opens over the transcript', () => {
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          threads: EThreadsLayout.Overlay,
        }),
      }),
    ).toEqual([EHeaderLeadingItem.Threads])
  })

  it('offers no leading button when the panel is stacked or beside the transcript', () => {
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.BottomBar,
          threads: EThreadsLayout.Stacked,
        }),
      }),
    ).toEqual([])
    expect(
      sessionHeaderLeadingOf({
        posture: postureWith({
          controls: EControlsPlacement.Rail,
          threads: EThreadsLayout.Panel,
        }),
      }),
    ).toEqual([])
  })
})

describe('leadingTitleWidthOf', () => {
  it('gives the title the bar width left after the buttons and the rail column', () => {
    const posture = postureWith({
      controls: EControlsPlacement.Rail,
      threads: EThreadsLayout.Overlay,
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
          threads: EThreadsLayout.Stacked,
        }),
        buttons: 2,
      }),
    ).toBe(HEADER_TITLE_MIN_WIDTH)
  })
})
