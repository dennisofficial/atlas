import { describe, expect, it } from 'bun:test'

import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES } from '@dltech/atlas-core'

import {
  EAttachmentStatus,
  attachmentsOf,
  describeBytes,
  hasFailed,
  isUploading,
  planAttach,
  sendableOf,
  startedAttachment,
  withFailed,
  withProgress,
  withReady,
  withoutAttachment,
  type PickedFile,
} from '../attachment-plan'

const picked = (name: string, size = 1024): PickedFile => ({
  name,
  size,
  mediaType: 'image/jpeg',
  uri: `file:///${name}`,
})

const uploadOf = (name: string) => ({
  uploadId: '6f1e9a3c-0000-4000-8000-000000000001',
  pathname: `composer-uploads/${name}`,
  name,
  size: 1024,
  mediaType: 'image/jpeg',
})

describe('planAttach', () => {
  it('accepts files within the size and count limits', () => {
    const plan = planAttach({ files: [picked('a.jpg'), picked('b.jpg')], held: 0 })
    expect(plan.accepted.map((file) => file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(plan.oversize).toEqual([])
    expect(plan.droppedOverflow).toBe(false)
  })

  it('separates oversize files from accepted ones', () => {
    const plan = planAttach({
      files: [picked('a.jpg'), picked('huge.bin', MAX_UPLOAD_BYTES + 1)],
      held: 0,
    })
    expect(plan.accepted.map((file) => file.name)).toEqual(['a.jpg'])
    expect(plan.oversize.map((file) => file.name)).toEqual(['huge.bin'])
  })

  it('drops overflow once the message is full', () => {
    const files = Array.from({ length: 3 }, (_, index) => picked(`f${index}.jpg`))
    const plan = planAttach({ files, held: MAX_MESSAGE_UPLOADS - 2 })
    expect(plan.accepted.map((file) => file.name)).toEqual(['f0.jpg', 'f1.jpg'])
    expect(plan.droppedOverflow).toBe(true)
  })

  it('accepts nothing when the message is already full', () => {
    const plan = planAttach({ files: [picked('a.jpg')], held: MAX_MESSAGE_UPLOADS })
    expect(plan.accepted).toEqual([])
    expect(plan.droppedOverflow).toBe(true)
  })
})

describe('held attachment status', () => {
  const started = startedAttachment({ id: 'one', file: picked('a.jpg') })

  it('starts uploading with no upload attached', () => {
    expect(started.status).toBe(EAttachmentStatus.Uploading)
    expect(started.progress).toBe(0)
    expect(attachmentsOf([started])).toEqual([])
  })

  it('tracks progress only while uploading', () => {
    const uploading = withProgress({ held: [started], id: 'one', progress: 0.4 })
    expect(uploading[0]?.progress).toBe(0.4)
    const ready = withReady({ held: uploading, id: 'one', upload: uploadOf('a.jpg') })
    const late = withProgress({ held: ready, id: 'one', progress: 0.6 })
    expect(late[0]?.progress).toBe(1)
  })

  it('projects a ready upload into an upload-store attachment', () => {
    const ready = withReady({ held: [started], id: 'one', upload: uploadOf('a.jpg') })
    expect(attachmentsOf(ready)).toEqual([
      {
        id: uploadOf('a.jpg').uploadId,
        name: 'a.jpg',
        mediaType: 'image/jpeg',
        size: 1024,
        content: {
          store: 'upload',
          uploadId: uploadOf('a.jpg').uploadId,
          pathname: 'composer-uploads/a.jpg',
        },
      },
    ])
  })

  it('keeps a failed upload out of the send', () => {
    const failed = withFailed({ held: [started], id: 'one' })
    expect(hasFailed(failed)).toBe(true)
    expect(attachmentsOf(failed)).toEqual([])
  })

  it('reports uploading and removes by id', () => {
    expect(isUploading([started])).toBe(true)
    expect(withoutAttachment({ held: [started], id: 'one' })).toEqual([])
  })
})

describe('sendableOf', () => {
  const ready = withReady({
    held: [startedAttachment({ id: 'one', file: picked('a.jpg') })],
    id: 'one',
    upload: uploadOf('a.jpg'),
  })

  it('sends text alone', () => {
    expect(sendableOf({ text: 'hello', held: [] })).toBe(true)
  })

  it('sends a ready attachment without a caption', () => {
    expect(sendableOf({ text: '', held: ready })).toBe(true)
  })

  it('refuses whitespace with no attachment', () => {
    expect(sendableOf({ text: '   ', held: [] })).toBe(false)
  })

  it('refuses while an upload is in flight or failed', () => {
    const uploading = [startedAttachment({ id: 'one', file: picked('a.jpg') })]
    expect(sendableOf({ text: 'hello', held: uploading })).toBe(false)
    expect(sendableOf({ text: 'hello', held: withFailed({ held: uploading, id: 'one' }) })).toBe(
      false,
    )
  })
})

describe('describeBytes', () => {
  it('rounds to a readable unit', () => {
    expect(describeBytes(512)).toBe('512 B')
    expect(describeBytes(2048)).toBe('2.0 KB')
    expect(describeBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(describeBytes(100 * 1024 * 1024)).toBe('100 MB')
  })
})
