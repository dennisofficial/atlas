import { describe, expect, it } from 'bun:test'

import { EControlsPlacement, EThreadsLayout, type TPosture } from '../../layout/posture'
import {
  ESessionHeaderItem,
  HEADER_BUTTON_SLOT,
  HEADER_EDGE_SLACK,
  HEADER_TITLE_MIN_WIDTH,
  leadingTitleWidthOf,
  sessionHeaderItemsOf,
} from '../session-header-items'

const postureWith = (threads: EThreadsLayout): TPosture => ({
  controls: EControlsPlacement.BottomBar,
  threads,
  railWidth: 0,
  railBottom: 0,
  clearance: { bottom: 0 },
})

describe('sessionHeaderItemsOf', () => {
  it('offers the threads panel only when the panel opens over the transcript', () => {
    expect(sessionHeaderItemsOf({ posture: postureWith(EThreadsLayout.Overlay) })).toEqual([
      ESessionHeaderItem.Threads,
    ])
  })

  it('offers no header item when the panel is stacked or beside the transcript', () => {
    expect(sessionHeaderItemsOf({ posture: postureWith(EThreadsLayout.Stacked) })).toEqual([])
    expect(sessionHeaderItemsOf({ posture: postureWith(EThreadsLayout.Panel) })).toEqual([])
  })
})

describe('leadingTitleWidthOf', () => {
  it('gives the title the bar width left after the buttons and the rail column', () => {
    const posture = { ...postureWith(EThreadsLayout.Overlay), railWidth: 80 }
    expect(leadingTitleWidthOf({ windowWidth: 470, posture, buttons: 2 })).toBe(
      470 - 80 - HEADER_BUTTON_SLOT * 2 - HEADER_EDGE_SLACK,
    )
  })

  it('never shrinks the title below its minimum on a very narrow window', () => {
    expect(
      leadingTitleWidthOf({
        windowWidth: 200,
        posture: postureWith(EThreadsLayout.Stacked),
        buttons: 2,
      }),
    ).toBe(HEADER_TITLE_MIN_WIDTH)
  })
})
