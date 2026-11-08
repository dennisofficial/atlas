import { EAttachmentStore, type Attachment } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { saidImageText } from '../said-images'

const said = (over: Partial<Attachment> = {}): Attachment => ({
  id: 'image:0',
  name: 'paste-1.png',
  mediaType: 'image/png',
  size: 3072,
  content: { store: EAttachmentStore.Inline, data: 'A'.repeat(4096) },
  image: { width: 560, height: 280 },
  ...over,
})

describe('what a picture that rode along reads as in the transcript', () => {
  it('names the file, its size in pixels, and what it cost', () => {
    expect(saidImageText(said())).toBe('paste-1.png · 560×280 · ~200 tokens')
  })

  it('leaves out the size and the cost when the dimensions were never read', () => {
    expect(saidImageText(said({ image: {} }))).toBe('paste-1.png')
  })
})
