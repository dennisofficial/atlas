import { describe, expect, it } from 'bun:test'

import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES, type SaidUpload } from '@dltech/atlas-core'
import { EPromptAttachmentStatus } from '@dltech/atlas-ui/ai/prompt-input'

import {
  chipOf,
  contentTypeOf,
  EAttachmentStatus,
  fitsInline,
  hasFailed,
  attachmentsOf,
  sameAttachments,
  isUploading,
  planAttach,
  restoredAttachmentsOf,
  startedAttachment,
  uploadsOf,
  withFailed,
  withInline,
  withProgress,
  withReady,
} from '../composer-attachments'

const U1 = '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a01'
const U2 = '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a02'
const UA = '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a0a'
const UB = '6f1c1d0e-8a58-4a5c-9d49-0d6c1d7f0a0b'
const upload = (uploadId: string, name = 'a.pdf'): SaidUpload => ({
  uploadId,
  pathname: `composer-uploads/u/${uploadId}/${name}`,
  name,
  size: 3,
  mediaType: 'application/pdf',
})
const file = (name: string, size = 1, type = 'text/plain') => {
  const made = new File(['x'], name, { type })
  Object.defineProperty(made, 'size', { value: size })
  return made
}
const started = (id: string) => startedAttachment({ id, file: file(`${id}.pdf`) })

describe('planAttach', () => {
  it('accepts any file type up to the cap', () => {
    const plan = planAttach({
      files: [file('a.zip', 5, ''), file('b.png', 5, 'image/png')],
      held: 0,
    })
    expect(plan.accepted).toHaveLength(2)
    expect(plan.oversize).toEqual([])
  })

  it('flags files over the byte limit', () => {
    const big = file('big.bin', MAX_UPLOAD_BYTES + 1)
    const plan = planAttach({ files: [big, file('ok.txt')], held: 0 })
    expect(plan.oversize).toEqual([big])
    expect(plan.accepted.map((entry) => entry.name)).toEqual(['ok.txt'])
  })

  it('caps the held total at the message limit', () => {
    const files = Array.from({ length: 3 }, (_, index) => file(`${index}.txt`))
    const plan = planAttach({ files, held: MAX_MESSAGE_UPLOADS - 1 })
    expect(plan.accepted).toHaveLength(1)
    expect(plan.droppedOverflow).toBe(true)
  })
})

describe('status transitions', () => {
  it('starts uploading with octet-stream for an untyped file', () => {
    const entry = startedAttachment({ id: 'x', file: file('x.bin', 1, '') })
    expect(entry).toMatchObject({ status: EAttachmentStatus.Uploading, progress: 0 })
    expect(entry.mediaType).toBe('application/octet-stream')
    expect(contentTypeOf({ type: 'text/csv' })).toBe('text/csv')
  })

  it('moves progress, then ready with the upload', () => {
    let held = [started('a')]
    held = withProgress({ held, id: 'a', progress: 0.5 })
    expect(held[0]?.progress).toBe(0.5)
    expect(isUploading(held)).toBe(true)
    held = withReady({ held, id: 'a', upload: upload(UA) })
    expect(held[0]?.status).toBe(EAttachmentStatus.Ready)
    expect(isUploading(held)).toBe(false)
    expect(withProgress({ held, id: 'a', progress: 0.1 })[0]?.progress).toBe(1)
  })

  it('fails and blocks send until removed', () => {
    const held = withFailed({ held: [started('a'), started('b')], id: 'a' })
    expect(hasFailed(held)).toBe(true)
    expect(uploadsOf(held)).toEqual([])
  })

  it('only ready attachments contribute uploads', () => {
    const held = withReady({ held: [started('a'), started('b')], id: 'b', upload: upload(UB) })
    expect(uploadsOf(held)).toEqual([upload(UB)])
  })

  it('maps to chip statuses', () => {
    expect(chipOf(started('a')).status).toBe(EPromptAttachmentStatus.Uploading)
    expect(chipOf(withFailed({ held: [started('a')], id: 'a' })[0]!).status).toBe(
      EPromptAttachmentStatus.Failed,
    )
  })
})

describe('inline images', () => {
  const image = (data: string) => ({ path: 'a.png', mediaType: 'image/png', data })

  it('previews an inlined image', () => {
    const held = withInline({
      held: [started('a')],
      id: 'a',
      image: image('QUJD'),
    })
    expect(held[0]?.previewUrl).toBe('data:image/png;base64,QUJD')
  })

  it('refuses an image over the inline budget', () => {
    const held = withInline({ held: [started('a')], id: 'a', image: image('a'.repeat(3_500_000)) })
    expect(fitsInline({ held, image: image('b') })).toBe(false)
    expect(fitsInline({ held: [], image: image('b') })).toBe(true)
  })
})

describe('restoredAttachmentsOf', () => {
  it('restores uploads as ready and pairs images by name', () => {
    let next = 0
    const restored = restoredAttachmentsOf({
      uploads: [upload(U1, 'shot.png'), upload(U2)],
      images: [{ path: 'shot.png', mediaType: 'image/png', data: 'QUJD' }],
      idOf: () => `id${next++}`,
    })
    expect(restored.map((entry) => entry.status)).toEqual([
      EAttachmentStatus.Ready,
      EAttachmentStatus.Ready,
    ])
    expect(restored[0]?.image?.data).toBe('QUJD')
    expect(uploadsOf(restored).map((entry) => entry.uploadId)).toEqual([U1, U2])
  })
})

describe('attachmentsOf', () => {
  const inlined = {
    path: 'photo.png',
    mediaType: 'image/png',
    data: 'QUJD',
    width: 4,
    height: 3,
  }

  it('writes a picture that was uploaded and inlined as one attachment holding both', () => {
    const held = withInline({
      held: withReady({
        held: [started('a')],
        id: 'a',
        upload: upload(U1, 'photo.png'),
      }),
      id: 'a',
      image: inlined,
    })
    const all = attachmentsOf(held)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      id: U1,
      name: 'photo.png',
      content: { store: 'upload', uploadId: U1, inline: 'QUJD' },
      image: { width: 4, height: 3 },
    })
  })

  it('writes a document as one upload attachment with no inline copy', () => {
    const held = withReady({
      held: [started('a')],
      id: 'a',
      upload: upload(U1),
    })
    const all = attachmentsOf(held)
    expect(all).toHaveLength(1)
    expect(all[0]?.content).toEqual({
      store: 'upload',
      uploadId: U1,
      pathname: upload(U1).pathname,
    })
  })

  it('writes an image that never uploaded as an inline attachment', () => {
    const all = attachmentsOf(withInline({ held: [started('a')], id: 'a', image: inlined }))
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({
      name: 'photo.png',
      content: { store: 'inline', data: 'QUJD' },
    })
  })

  it('skips an attachment still uploading', () => {
    expect(attachmentsOf([started('a')])).toEqual([])
  })

  it('round-trips through restore into one held attachment', () => {
    const held = withInline({
      held: withReady({
        held: [started('a')],
        id: 'a',
        upload: upload(U1, 'photo.png'),
      }),
      id: 'a',
      image: inlined,
    })
    const [only] = attachmentsOf(held)
    let next = 0
    const restored = restoredAttachmentsOf({
      uploads: [upload(U1, 'photo.png')],
      images: [{ ...inlined, path: only?.name ?? '' }],
      idOf: () => `id${next++}`,
    })
    expect(restored).toHaveLength(1)
    expect(restored[0]?.image?.data).toBe('QUJD')
  })
})

describe('attachment identity', () => {
  it('compares by id', () => {
    const [one] = attachmentsOf(withReady({ held: [started('a')], id: 'a', upload: upload(UA) }))
    const [other] = attachmentsOf(withReady({ held: [started('a')], id: 'a', upload: upload(UB) }))
    expect(sameAttachments([one!], [one!])).toBe(true)
    expect(sameAttachments([one!], [other!])).toBe(false)
  })
})
