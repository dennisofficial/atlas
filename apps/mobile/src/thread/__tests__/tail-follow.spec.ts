import { describe, expect, it } from 'bun:test'

import { distanceFromBottom, followsTailAfterUserScroll, NEAR_BOTTOM_PX } from '../tail-follow'

const metrics = ({
  offset,
  content,
  viewport,
}: {
  offset: number
  content: number
  viewport: number
}) => ({
  contentOffset: { y: offset },
  contentSize: { height: content },
  layoutMeasurement: { height: viewport },
})

describe('distanceFromBottom', () => {
  it('is zero when the viewport ends at the content end', () => {
    expect(distanceFromBottom(metrics({ offset: 1200, content: 2000, viewport: 800 }))).toBe(0)
  })
})

describe('followsTailAfterUserScroll', () => {
  it('keeps following when the user lets go near the bottom', () => {
    expect(
      followsTailAfterUserScroll(
        metrics({ offset: 1200 - NEAR_BOTTOM_PX + 1, content: 2000, viewport: 800 }),
      ),
    ).toBe(true)
  })

  it('stops following when the user lets go further up', () => {
    expect(followsTailAfterUserScroll(metrics({ offset: 400, content: 2000, viewport: 800 }))).toBe(
      false,
    )
  })
})
