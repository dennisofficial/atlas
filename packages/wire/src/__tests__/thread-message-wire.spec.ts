import { describe, expect, it } from 'bun:test'

import {
  createThreadInputSchema,
  MAX_MESSAGE_IMAGES,
  threadMessageRequestSchema,
  threadMessageSendInputSchema,
} from '../index'

const SHOT = {
  path: 'screenshot.png',
  mediaType: 'image/png',
  data: 'aGVsbG8=',
  width: 2,
  height: 1,
}

describe('the thread message request', () => {
  it('accepts a text-only message as before', () => {
    expect(threadMessageRequestSchema.parse({ sendId: 's1', text: 'hi' })).toEqual({
      sendId: 's1',
      text: 'hi',
    })
  })

  it('carries pasted images on a send', () => {
    const parsed = threadMessageSendInputSchema.parse({
      threadId: 'brn_1',
      sendId: 's1',
      text: 'what is wrong here',
      images: [SHOT],
    })

    expect(parsed.images).toEqual([SHOT])
  })

  it('carries images on a new thread first message', () => {
    const parsed = createThreadInputSchema.parse({
      firstMessage: { sendId: 's1', text: 'fix this', images: [SHOT] },
    })

    expect(parsed.firstMessage?.images).toEqual([SHOT])
  })

  it('refuses more images than one message may carry', () => {
    const images = Array.from({ length: MAX_MESSAGE_IMAGES + 1 }, () => SHOT)

    expect(threadMessageRequestSchema.safeParse({ sendId: 's1', text: 'x', images }).success).toBe(
      false,
    )
  })

  it('refuses an image without its data', () => {
    const images = [{ path: 'a.png', mediaType: 'image/png' }]

    expect(threadMessageRequestSchema.safeParse({ sendId: 's1', text: 'x', images }).success).toBe(
      false,
    )
  })
})
