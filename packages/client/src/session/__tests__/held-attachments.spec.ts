import { describe, expect, it } from 'bun:test'

import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES } from '@dltech/atlas-core'

import {
  EAttachmentStatus,
  hasFailed,
  isUploading,
  MAX_UPLOAD_MB,
  planAttach,
  readyAttachments,
  REMOVE_FAILED_FILES,
  TOO_MANY_FILES,
  tooLargeNotice,
  uploadFailedNotice,
  withFailed,
  withProgress,
  withoutAttachment,
  type HeldStatus,
} from '../held-attachments'

const sized = (name: string, size = 1024) => ({ name, size })

const held = (id: string, status: EAttachmentStatus = EAttachmentStatus.Uploading): HeldStatus => ({
  id,
  status,
  progress: 0,
})

describe('planAttach', () => {
  it('accepts files within the size and count limits', () => {
    const plan = planAttach({ files: [sized('a.jpg'), sized('b.jpg')], held: 0 })
    expect(plan.accepted.map((file) => file.name)).toEqual(['a.jpg', 'b.jpg'])
    expect(plan.oversize).toEqual([])
    expect(plan.droppedOverflow).toBe(false)
  })

  it('separates oversize files from accepted ones', () => {
    const plan = planAttach({
      files: [sized('a.jpg'), sized('huge.bin', MAX_UPLOAD_BYTES + 1)],
      held: 0,
    })
    expect(plan.accepted.map((file) => file.name)).toEqual(['a.jpg'])
    expect(plan.oversize.map((file) => file.name)).toEqual(['huge.bin'])
  })

  it('accepts a file at the byte limit', () => {
    const plan = planAttach({ files: [sized('exact.bin', MAX_UPLOAD_BYTES)], held: 0 })
    expect(plan.accepted.map((file) => file.name)).toEqual(['exact.bin'])
    expect(plan.oversize).toEqual([])
  })

  it('drops overflow once the message is full', () => {
    const files = Array.from({ length: 3 }, (_, index) => sized(`f${index}.jpg`))
    const plan = planAttach({ files, held: MAX_MESSAGE_UPLOADS - 2 })
    expect(plan.accepted.map((file) => file.name)).toEqual(['f0.jpg', 'f1.jpg'])
    expect(plan.droppedOverflow).toBe(true)
  })

  it('accepts nothing when the message is already full', () => {
    const plan = planAttach({ files: [sized('a.jpg')], held: MAX_MESSAGE_UPLOADS })
    expect(plan.accepted).toEqual([])
    expect(plan.droppedOverflow).toBe(true)
  })
})

describe('held status', () => {
  it('tracks progress only while uploading', () => {
    const uploading = withProgress({ held: [held('one')], id: 'one', progress: 0.4 })
    expect(uploading[0]?.progress).toBe(0.4)
    const late = withProgress({
      held: [held('one', EAttachmentStatus.Ready)],
      id: 'one',
      progress: 0.6,
    })
    expect(late[0]?.progress).toBe(0)
  })

  it('fails one attachment only', () => {
    const failed = withFailed({ held: [held('a'), held('b')], id: 'a' })
    expect(failed[0]?.status).toBe(EAttachmentStatus.Failed)
    expect(failed[1]?.status).toBe(EAttachmentStatus.Uploading)
  })

  it('reports uploading and failed', () => {
    expect(isUploading([held('one')])).toBe(true)
    expect(isUploading([held('one', EAttachmentStatus.Ready)])).toBe(false)
    expect(hasFailed([held('one', EAttachmentStatus.Failed)])).toBe(true)
    expect(hasFailed([held('one')])).toBe(false)
  })

  it('removes by id and keeps the rest', () => {
    expect(withoutAttachment({ held: [held('a'), held('b')], id: 'a' }).map((e) => e.id)).toEqual([
      'b',
    ])
  })

  it('returns only the ready attachments', () => {
    expect(
      readyAttachments([
        held('a'),
        held('b', EAttachmentStatus.Ready),
        held('c', EAttachmentStatus.Failed),
      ]).map((entry) => entry.id),
    ).toEqual(['b'])
  })
})

describe('notices', () => {
  it('names the message file count', () => {
    expect(TOO_MANY_FILES).toBe(`Up to ${MAX_MESSAGE_UPLOADS} files`)
    expect(REMOVE_FAILED_FILES).toBe('Remove failed files first')
  })

  it('names the size ceiling from the byte limit', () => {
    expect(MAX_UPLOAD_MB).toBe(Math.round(MAX_UPLOAD_BYTES / (1024 * 1024)))
    expect(tooLargeNotice('clip.mov')).toBe(`clip.mov is over ${MAX_UPLOAD_MB} MB`)
  })

  it('names the file that failed', () => {
    expect(uploadFailedNotice('notes.pdf')).toBe("Couldn't upload notes.pdf")
  })
})
