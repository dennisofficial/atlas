import { describe, expect, it } from 'bun:test'

import {
  createThreadInputSchema,
  clientFrameSchema,
  EClientFrame,
  MAX_MESSAGE_IMAGES,
  MAX_MESSAGE_UPLOADS,
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

describe('uploads on a thread message', () => {
  const upload = {
    uploadId: '8d3f0c1e-1111-4222-8333-444455556666',
    pathname: 'composer-uploads/u1/8d3f0c1e-1111-4222-8333-444455556666/a.txt',
    name: 'a.txt',
    size: 3,
    mediaType: 'text/plain',
  }

  it('rejects an uploadId that is not a uuid', () => {
    const bad = { ...upload, uploadId: '../../etc' }
    expect(
      threadMessageRequestSchema.safeParse({ sendId: 's', text: 'hi', uploads: [bad] }).success,
    ).toBe(false)
  })

  it('accepts uploads', () => {
    const parsed = threadMessageRequestSchema.parse({ sendId: 's', text: 'hi', uploads: [upload] })
    expect(parsed.uploads).toEqual([upload])
  })

  it('rejects more than the per-message limit', () => {
    const uploads = Array.from({ length: MAX_MESSAGE_UPLOADS + 1 }, () => upload)
    expect(threadMessageRequestSchema.safeParse({ sendId: 's', text: 'hi', uploads }).success).toBe(
      false,
    )
  })

  it('accepts uploads on a Send frame and rejects too many', () => {
    const frame = { kind: EClientFrame.Send, sendId: 's1', text: 'hi', uploads: [upload] }
    expect(clientFrameSchema.safeParse(frame).success).toBe(true)
    const many = Array.from({ length: MAX_MESSAGE_UPLOADS + 1 }, () => upload)
    expect(clientFrameSchema.safeParse({ ...frame, uploads: many }).success).toBe(false)
  })
})
