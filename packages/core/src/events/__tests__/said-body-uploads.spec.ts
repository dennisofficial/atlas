import { describe, expect, it } from 'bun:test'

import { EAttachmentStore } from '../../attachments/attachment'
import { saidBody } from '../said-body'

const upload = {
  uploadId: '8d3f0c1e-1111-4222-8333-444455556666',
  pathname: 'p',
  name: 'a.txt',
  size: 1,
  mediaType: 'text/plain',
}

describe('saidBody attachments', () => {
  it('omits an empty attachments list', () => {
    expect('attachments' in saidBody({ text: 'x', attachments: [] })).toBe(false)
    expect('attachments' in saidBody({ text: 'x', uploads: [] })).toBe(false)
    expect('attachments' in saidBody({ text: 'x' })).toBe(false)
  })

  it('folds legacy uploads into attachments and writes no legacy field', () => {
    const body = saidBody({ text: 'x', uploads: [upload] })
    expect(body.attachments).toHaveLength(1)
    expect(body.attachments?.[0]?.content.store).toBe(EAttachmentStore.Upload)
    expect('uploads' in body).toBe(false)
    expect('images' in body).toBe(false)
  })

  it('writes a picture sent as image and upload once', () => {
    const body = saidBody({
      text: 'x',
      images: [{ path: 'a.txt', mediaType: 'image/png', data: 'aGk=' }],
      uploads: [upload],
    })
    expect(body.attachments).toHaveLength(1)
  })

  it('carries attachments as given', () => {
    const held = {
      id: 'a',
      name: 'a.txt',
      mediaType: 'text/plain',
      size: 1,
      content: { store: EAttachmentStore.Inline as const, data: 'eA==' },
    }
    expect(saidBody({ text: 'x', attachments: [held] }).attachments).toEqual([held])
  })
})
