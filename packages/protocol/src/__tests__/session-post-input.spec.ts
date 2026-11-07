import { describe, expect, it } from 'bun:test'

import { inboxMessageSchema, sessionPostInputSchema } from '../api'

const upload = (index: number) => ({
  uploadId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  pathname: `composer-uploads/user-a/00000000-0000-4000-8000-${String(index).padStart(12, '0')}/f.txt`,
  name: 'f.txt',
  size: 7,
  mediaType: 'text/plain',
})

const post = (extra: object) => sessionPostInputSchema.safeParse({ sessionId: 's-1', ...extra })

describe('session post with uploads', () => {
  it('accepts an upload-only message', () => {
    expect(post({ text: '', uploads: [upload(1)] }).success).toBe(true)
  })

  it('refuses a message with no text, media or uploads', () => {
    expect(post({ text: ' ', uploads: [] }).success).toBe(false)
  })

  it('refuses more than 20 attachments across media and uploads', () => {
    const hash = 'a'.repeat(64)
    const media = Array.from({ length: 10 }, () => ({ hash }))
    const uploads = (count: number) => Array.from({ length: count }, (_, i) => upload(i))
    expect(post({ text: 'hi', media, uploads: uploads(10) }).success).toBe(true)
    expect(post({ text: 'hi', media, uploads: uploads(11) }).success).toBe(false)
    expect(post({ text: 'hi', uploads: uploads(21) }).success).toBe(false)
  })

  it('carries uploads on the inbox message', () => {
    const message = { text: 'hi', uploads: [upload(1)] }
    expect(inboxMessageSchema.parse(message)).toEqual(message)
  })
})
