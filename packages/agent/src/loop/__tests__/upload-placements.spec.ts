import { describe, expect, it } from 'bun:test'

import {
  EUploadState,
  type MediaUrlResolver,
  type SaidMediaFile,
  type SaidUpload,
  type ThreadId,
  type UploadPlacement,
} from '@dltech/atlas-core'

import { THREAD, rigOf } from '../../__tests__/exit-fixture'
import { InMemoryModelContext } from '../../testing'
import { SaidUploadsPort } from '../../uploads/said-uploads.port'

const UPLOAD_ID = '0b9f3c1e-5d2a-4c8e-9a41-7e6d2f8b1a30'
const PLACED = `/atlas/home/uploads/${UPLOAD_ID}/a.png`
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const UPLOAD: SaidUpload = {
  uploadId: UPLOAD_ID,
  pathname: `composer-uploads/user-1/${UPLOAD_ID}/a.png`,
  name: 'a.png',
  size: 68,
  mediaType: 'image/png',
}

type PlaceCall = { uploads: string[]; mediaFiles: string[]; current: string[] }

class CountingUploads extends SaidUploadsPort {
  readonly calls: PlaceCall[] = []

  constructor(private readonly placement: UploadPlacement) {
    super()
  }

  async place(args: {
    threadId: ThreadId
    uploads: readonly SaidUpload[]
    mediaFiles?: readonly SaidMediaFile[] | undefined
    currentFileIds?: ReadonlySet<string> | undefined
  }): Promise<ReadonlyMap<string, UploadPlacement>> {
    this.calls.push({
      uploads: args.uploads.map((upload) => upload.uploadId),
      mediaFiles: (args.mediaFiles ?? []).map((file) => file.hash),
      current: [...(args.currentFileIds ?? [])],
    })
    return new Map([
      ...args.uploads.map((upload) => [upload.uploadId, this.placement] as const),
      ...(args.mediaFiles ?? []).map((file) => [file.hash, this.placement] as const),
    ])
  }
}

const refusalSpy = (): { mediaUrls: MediaUrlResolver; asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    mediaUrls: {
      async urlOf({ ref, placements }) {
        const fileId = 'hash' in ref ? ref.hash : ref.uploadId
        asked.push(fileId)
        if (placements?.get(fileId)?.state === EUploadState.Missing) {
          throw new Error(`${fileId} is no longer available`)
        }
        return `https://media.test/${fileId}`
      },
    },
  }
}

const requestText = (rig: ReturnType<typeof rigOf>): string =>
  JSON.stringify(rig.model.requests.at(-1)?.assembled)

describe('a file a message carries', () => {
  it('is placed once and its outcome recorded as a fact', async () => {
    const uploads = new CountingUploads({ state: EUploadState.Ready, path: PLACED })
    const rig = rigOf({ script: [{ text: 'got it' }], overrides: { uploads } })

    await rig.runner.say({ threadId: THREAD, text: 'see a.png', uploads: [UPLOAD] })

    expect(uploads.calls).toHaveLength(1)
    expect(uploads.calls[0]?.uploads).toEqual([UPLOAD_ID])
    expect(uploads.calls[0]?.current).toEqual([UPLOAD_ID])
    expect(rig.record.factsOf(THREAD)).toEqual([
      {
        type: 'fact-recorded',
        key: `upload:${UPLOAD_ID}`,
        kind: 'upload-placement',
        value: { state: EUploadState.Ready, path: PLACED },
      },
    ])
    expect(requestText(rig)).toContain(PLACED)
  })

  it('is not placed again on a later step of the same thread', async () => {
    const uploads = new CountingUploads({ state: EUploadState.Ready, path: PLACED })
    const rig = rigOf({
      script: [{ text: 'got it' }, { text: 'still here' }],
      overrides: { uploads },
    })

    await rig.runner.say({ threadId: THREAD, text: 'see a.png', uploads: [UPLOAD] })
    await rig.runner.say({ threadId: THREAD, text: 'and again' })

    expect(uploads.calls).toHaveLength(1)
    expect(requestText(rig)).toContain(PLACED)
  })

  it('is not placed again by a fresh runtime reading the same record', async () => {
    const first = new CountingUploads({ state: EUploadState.Ready, path: PLACED })
    const rig = rigOf({ script: [{ text: 'got it' }], overrides: { uploads: first } })
    await rig.runner.say({ threadId: THREAD, text: 'see a.png', uploads: [UPLOAD] })

    const second = new CountingUploads({ state: EUploadState.Ready, path: PLACED })
    const fresh = rigOf({
      script: [{ text: 'still here' }],
      overrides: {
        uploads: second,
        record: rig.record,
        modelContext: new InMemoryModelContext(rig.record),
      },
    })
    await fresh.runner.say({ threadId: THREAD, text: 'and again' })

    expect(first.calls).toHaveLength(1)
    expect(second.calls).toHaveLength(0)
    expect(requestText(fresh)).toContain(PLACED)
  })

  it('renders as no longer available, and asks for no url, once its placement is missing', async () => {
    const uploads = new CountingUploads({ state: EUploadState.Missing })
    const spy = refusalSpy()
    const rig = rigOf({
      script: [{ text: 'ok' }],
      overrides: { uploads, mediaUrls: spy.mediaUrls },
    })

    await rig.runner.say({
      threadId: THREAD,
      text: 'see a.png',
      images: [{ path: 'a.png', mediaType: 'image/png', data: PNG }],
      uploads: [UPLOAD],
    })

    expect(spy.asked).toContain(UPLOAD_ID)
    expect(requestText(rig)).toContain('a.png: no longer available')
    expect(requestText(rig)).not.toContain('https://media.test')
    expect(uploads.calls).toHaveLength(1)
  })
})
