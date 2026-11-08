import { describe, expect, it } from 'bun:test'

import {
  attachmentWireSchema,
  clientFrameSchema,
  EClientFrame,
  MAX_ATTACHMENTS,
  MAX_IMAGE_DATA_CHARS,
  threadMessageRequestSchema,
} from '../index'

const UPLOAD_ID = '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01'
const base = { id: 'a', name: 'a.png', mediaType: 'image/png', size: 3 }

const inline = { ...base, content: { store: 'inline' as const, data: 'aGk=' } }
const upload = {
  ...base,
  id: UPLOAD_ID,
  content: {
    store: 'upload' as const,
    uploadId: UPLOAD_ID,
    pathname: 'u/a.png',
    inline: 'aGk=',
  },
}
const media = {
  ...base,
  content: { store: 'media' as const, hash: 'a'.repeat(64) },
  image: { width: 1, height: 2 },
}

describe('attachmentWireSchema', () => {
  it('round-trips each store', () => {
    for (const entry of [inline, upload, media]) {
      expect(attachmentWireSchema.parse(entry)).toEqual(entry)
    }
  })

  it('refuses inline data over the cap', () => {
    const big = {
      ...inline,
      content: { store: 'inline', data: 'a'.repeat(MAX_IMAGE_DATA_CHARS + 1) },
    }
    expect(attachmentWireSchema.safeParse(big).success).toBe(false)
  })
})

describe('a thread message with attachments', () => {
  it('carries attachments next to the legacy fields', () => {
    const parsed = threadMessageRequestSchema.parse({
      sendId: 's',
      text: 'hi',
      attachments: [inline, upload],
    })
    expect(parsed.attachments).toHaveLength(2)
  })

  it('still parses a legacy payload', () => {
    const legacy = {
      sendId: 's',
      text: 'hi',
      images: [{ path: 'a.png', mediaType: 'image/png', data: 'aGk=' }],
      uploads: [
        {
          uploadId: UPLOAD_ID,
          pathname: 'p',
          name: 'a.png',
          size: 1,
          mediaType: 'image/png',
        },
      ],
    }
    expect(threadMessageRequestSchema.safeParse(legacy).success).toBe(true)
  })

  it('caps the attachment count', () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => inline)
    expect(
      threadMessageRequestSchema.safeParse({
        sendId: 's',
        text: 'x',
        attachments: many,
      }).success,
    ).toBe(false)
  })

  it('rides the pod send frame', () => {
    const frame = clientFrameSchema.parse({
      kind: EClientFrame.Send,
      sendId: 's',
      text: 'hi',
      attachments: [upload],
    })
    expect(frame.kind === EClientFrame.Send ? frame.attachments : null).toHaveLength(1)
  })
})
