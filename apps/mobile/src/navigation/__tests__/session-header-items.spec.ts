import { describe, expect, it } from 'bun:test'

import { EControlsPlacement, EThreadsLayout, type TPosture } from '../../layout/posture'
import { ESessionHeaderItem, sessionHeaderItemsOf } from '../session-header-items'

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
