import { describe, expect, it } from 'bun:test'

import { contextMirrorFileSchema } from '../context-mirror'

const reference = {
  path: 'media/walkthrough.mp4',
  mime: 'video/mp4',
  bytes: 7118,
  url: 'https://signed.test/play',
  downloadUrl: 'https://signed.test/download',
}

describe('contextMirrorFileSchema', () => {
  it('parses a video and an audio reference with their two urls', () => {
    expect(contextMirrorFileSchema.parse({ type: 'video', ...reference }).type).toBe('video')
    expect(
      contextMirrorFileSchema.parse({
        type: 'audio',
        ...reference,
        path: 'media/note.mp3',
        mime: 'audio/mpeg',
      }).type,
    ).toBe('audio')
  })

  it('parses an image and a binary reference with their two urls', () => {
    expect(contextMirrorFileSchema.parse({ type: 'image', ...reference }).type).toBe('image')
    expect(contextMirrorFileSchema.parse({ type: 'binary', ...reference }).type).toBe('binary')
  })

  it('rejects a reference without the download url', () => {
    const { downloadUrl: _downloadUrl, ...withoutDownload } = reference
    expect(() => contextMirrorFileSchema.parse({ type: 'video', ...withoutDownload })).toThrow()
  })

  it('rejects an unknown member on a media reference', () => {
    expect(() =>
      contextMirrorFileSchema.parse({ type: 'video', ...reference, unknownMember: true }),
    ).toThrow()
  })

  it('parses a file the mirror has not stored yet', () => {
    expect(contextMirrorFileSchema.parse({ type: 'pending', path: 'media/take.mov' })).toEqual({
      type: 'pending',
      path: 'media/take.mov',
    })
  })

  it('keeps a text file free of urls', () => {
    expect(() =>
      contextMirrorFileSchema.parse({
        ...reference,
        type: 'text',
        content: '# Plan',
        truncated: false,
      }),
    ).toThrow()
  })
})
