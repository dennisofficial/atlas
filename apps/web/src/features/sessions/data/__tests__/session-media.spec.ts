import { describe, expect, it } from 'bun:test'

import { EAttachmentStatus } from '@/features/threads/data/composer-attachments'

import {
  hasMediaFailed,
  isMediaUploading,
  planImageAttach,
  postInputOf,
  readyMediaOf,
  sha256Hex,
  startedMedia,
  storeImage,
  withMediaFailed,
  withMediaReady,
  type MediaUploadApi,
  type PutImage,
} from '../session-media'

const UPLOAD = {
  uploadId: '11111111-1111-4111-8111-111111111111',
  pathname: 'composer-uploads/user-1/11111111-1111-4111-8111-111111111111/deploy.sh',
  name: 'deploy.sh',
  size: 12,
  mediaType: 'application/x-sh',
}

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_SHA256 = '497790947d4666760ce38f3c00e852c71fdb66cae849bae8e9ede352719e1581'
const pngBytes = () => Uint8Array.from(Buffer.from(PNG_BASE64, 'base64'))
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const file = (name: string, type: string) => new File(['x'], name, { type })

const media = {
  hash: PNG_SHA256,
  mediaType: 'image/png',
  size: 1,
  width: 1,
  height: 1,
} as const

function recorder(args: { exists: boolean; confirmFails?: boolean; putFails?: boolean }) {
  const calls: string[] = []
  const api: MediaUploadApi = {
    presign: async () => {
      calls.push('presign')
      return args.exists
        ? { exists: true, media }
        : {
            exists: false,
            uploadUrl: 'https://blob.example/put',
            validUntil: 1,
          }
    },
    confirm: async () => {
      calls.push('confirm')
      if (args.confirmFails === true) throw new Error('not an image')
      return { media }
    },
  }
  const put: PutImage = ({ url }) => {
    calls.push(`put ${url}`)
    return {
      done: args.putFails === true ? Promise.reject(new Error('put failed')) : Promise.resolve(),
      abort: () => undefined,
    }
  }
  return { calls, api, put }
}

const store = (made: ReturnType<typeof recorder>) =>
  storeImage({
    bytes: pngBytes(),
    mediaType: 'image/png',
    api: made.api,
    put: made.put,
    onProgress: () => undefined,
    onHandle: () => undefined,
  })

describe('sha256Hex', () => {
  it('hashes known PNG bytes to lowercase hex', async () => {
    expect(await sha256Hex(pngBytes())).toBe(PNG_SHA256)
  })
})

describe('storeImage', () => {
  it('skips the PUT and confirm when the image already exists', async () => {
    const made = recorder({ exists: true })
    expect(await store(made)).toBe(PNG_SHA256)
    expect(made.calls).toEqual(['presign'])
  })

  it('presigns, puts, then confirms a new image', async () => {
    const made = recorder({ exists: false })
    expect(await store(made)).toBe(PNG_SHA256)
    expect(made.calls).toEqual(['presign', 'put https://blob.example/put', 'confirm'])
  })

  it('rejects when the PUT fails and never confirms', async () => {
    const made = recorder({ exists: false, putFails: true })
    await expect(store(made)).rejects.toThrow('put failed')
    expect(made.calls).not.toContain('confirm')
  })

  it('rejects when confirm refuses the bytes', async () => {
    await expect(store(recorder({ exists: false, confirmFails: true }))).rejects.toThrow(
      'not an image',
    )
  })
})

describe('attachment state', () => {
  const started = startedMedia({ id: '1', file: file('a.png', 'image/png') })

  it('starts uploading, then becomes ready with its hash', () => {
    expect(isMediaUploading([started])).toBe(true)
    const ready = withMediaReady({ held: [started], id: '1', hash: HASH_A })
    expect(isMediaUploading(ready)).toBe(false)
    expect(ready[0]).toMatchObject({
      status: EAttachmentStatus.Ready,
      hash: HASH_A,
      progress: 1,
    })
  })

  it('marks a failure and keeps it out of the ready list', () => {
    const failed = withMediaFailed({ held: [started], id: '1' })
    expect(hasMediaFailed(failed)).toBe(true)
    expect(readyMediaOf(failed)).toEqual([])
  })

  it('lists ready items once per hash with their display name', () => {
    const one = withMediaReady({ held: [started], id: '1', hash: HASH_A })
    const two = withMediaReady({
      held: [...one, startedMedia({ id: '2', file: file('b.png', 'image/png') })],
      id: '2',
      hash: HASH_A,
    })
    const three = withMediaReady({
      held: [...two, startedMedia({ id: '3', file: file('c.png', 'image/png') })],
      id: '3',
      hash: HASH_B,
    })
    expect(readyMediaOf(three)).toEqual([
      { hash: HASH_A, source: 'a.png' },
      { hash: HASH_B, source: 'c.png' },
    ])
  })

  it('caps the display name at 200 characters', () => {
    const long = startedMedia({
      id: '1',
      file: file(`${'n'.repeat(300)}.png`, 'image/png'),
    })
    const [item] = readyMediaOf(withMediaReady({ held: [long], id: '1', hash: HASH_A }))
    expect(item?.source?.length).toBe(200)
  })
})

describe('planImageAttach', () => {
  it('accepts images and rejects other files', () => {
    const plan = planImageAttach({
      files: [file('a.png', 'image/png'), file('notes.txt', 'text/plain')],
      held: 0,
    })
    expect(plan.accepted.map((entry) => entry.name)).toEqual(['a.png'])
    expect(plan.rejected.map((entry) => entry.name)).toEqual(['notes.txt'])
  })
})

describe('postInputOf', () => {
  const media = {
    id: `media:${HASH_A}`,
    name: 'a.png',
    mediaType: 'image/png',
    size: 4,
    content: { store: 'media' as const, hash: HASH_A },
  }

  it('omits attachments for a text-only message', () => {
    expect(postInputOf({ sessionId: 's', text: 'hi', media: [], uploads: [] })).toEqual({
      sessionId: 's',
      text: 'hi',
    })
  })

  it('carries one media attachment for an image-only message', () => {
    expect(postInputOf({ sessionId: 's', text: '', media: [media], uploads: [] })).toEqual({
      sessionId: 's',
      text: '',
      attachments: [media],
    })
  })

  it('carries an upload as one upload attachment', () => {
    const input = postInputOf({
      sessionId: 's',
      text: '',
      media: [],
      uploads: [UPLOAD],
    })
    expect(input.attachments).toHaveLength(1)
    expect(input.attachments?.[0]).toMatchObject({
      id: UPLOAD.uploadId,
      name: UPLOAD.name,
      content: { store: 'upload', uploadId: UPLOAD.uploadId },
    })
    expect('uploads' in input).toBe(false)
    expect('media' in input).toBe(false)
  })

  it('carries media and uploads together, media first', () => {
    const input = postInputOf({
      sessionId: 's',
      text: 'both',
      media: [media],
      uploads: [UPLOAD],
    })
    expect(input.attachments?.map((entry) => entry.id)).toEqual([media.id, UPLOAD.uploadId])
  })
})
