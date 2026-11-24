import { describe, expect, it } from 'bun:test'

import type { Attachment } from '@dltech/atlas-core'

import { fetchableOf, sourceOf, viewsOf } from '../attachment-views'

const inlineAttachment: Attachment = {
  id: 'inline-1',
  name: 'cat.png',
  mediaType: 'image/png',
  size: 12,
  content: { store: 'inline', data: 'YWJj' },
}

const uploadAttachment: Attachment = {
  id: 'upload-1',
  name: 'report.pdf',
  mediaType: 'application/pdf',
  size: 2048,
  content: { store: 'upload', uploadId: 'up-1', pathname: 'composer-uploads/report.pdf' },
}

const mediaAttachment: Attachment = {
  id: 'media-1',
  name: 'shot.png',
  mediaType: 'image/png',
  size: 4096,
  content: { store: 'media', hash: 'a'.repeat(64) },
}

describe('sourceOf', () => {
  it('turns inline data into a data URL', () => {
    expect(sourceOf(inlineAttachment)).toEqual({
      kind: 'ready',
      uri: 'data:image/png;base64,YWJj',
    })
  })

  it('asks the caller to fetch an upload store', () => {
    expect(sourceOf(uploadAttachment)).toEqual({
      kind: 'fetch',
      key: 'upload:composer-uploads/report.pdf',
      pathname: 'composer-uploads/report.pdf',
    })
  })

  it('asks the caller to resolve a media hash', () => {
    expect(sourceOf(mediaAttachment)).toEqual({
      kind: 'media',
      key: `media:${'a'.repeat(64)}`,
      hash: 'a'.repeat(64),
    })
  })
})

describe('fetchableOf', () => {
  it('keeps the upload and media stores', () => {
    expect(fetchableOf([inlineAttachment, uploadAttachment, mediaAttachment])).toEqual([
      {
        kind: 'upload',
        key: 'upload:composer-uploads/report.pdf',
        pathname: 'composer-uploads/report.pdf',
      },
      { kind: 'media', key: `media:${'a'.repeat(64)}`, hash: 'a'.repeat(64) },
    ])
  })
})

describe('viewsOf', () => {
  it('attaches a fetched URL to an upload store', () => {
    const views = viewsOf({
      attachments: [uploadAttachment],
      sources: new Map([['upload:composer-uploads/report.pdf', 'https://blob/report.pdf']]),
    })
    expect(views).toEqual([
      {
        key: 'upload-1:0',
        id: 'upload-1',
        name: 'report.pdf',
        mediaType: 'application/pdf',
        size: 2048,
        image: false,
        uri: 'https://blob/report.pdf',
      },
    ])
  })

  it('leaves the URI undefined until the source arrives', () => {
    const [view] = viewsOf({ attachments: [uploadAttachment], sources: new Map() })
    expect(view?.uri).toBeUndefined()
    expect(view?.image).toBe(false)
  })

  it('attaches a fetched URL to a media store', () => {
    const [view] = viewsOf({
      attachments: [mediaAttachment],
      sources: new Map([[`media:${'a'.repeat(64)}`, 'https://media/shot.png']]),
    })
    expect(view?.uri).toBe('https://media/shot.png')
    expect(view?.image).toBe(true)
  })

  it('draws inline images without a fetch', () => {
    const [view] = viewsOf({ attachments: [inlineAttachment], sources: new Map() })
    expect(view?.uri).toBe('data:image/png;base64,YWJj')
    expect(view?.image).toBe(true)
  })
})
