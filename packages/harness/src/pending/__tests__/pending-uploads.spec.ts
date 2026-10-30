import { MAX_MESSAGE_UPLOADS } from '@dltech/atlas-core'
import {
  MAX_MESSAGE_UPLOADS as WIRE_MAX_MESSAGE_UPLOADS,
  MAX_UPLOAD_BYTES as WIRE_MAX_UPLOAD_BYTES,
} from '@dltech/atlas-wire'
import { MAX_UPLOAD_BYTES } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { createPendingQueue } from '../pending-queue'
import { userSaidDraft } from '../user-said'

const upload = {
  uploadId: '8d3f0c1e-1111-4222-8333-444455556666',
  pathname: 'p',
  name: 'a.txt',
  size: 1,
  mediaType: 'text/plain',
}

describe('pending uploads', () => {
  it('returns uploads on take-back', () => {
    const queue = createPendingQueue()
    queue.enqueue({ text: 'x', uploads: [upload] })
    expect(queue.takeBackLast()?.uploads).toEqual([upload])
  })

  it('emits uploads in the drained user-said draft and omits them when absent', () => {
    const queue = createPendingQueue()
    queue.enqueue({ text: 'x', uploads: [upload] })
    queue.enqueue({ text: 'y' })
    const [first, second] = queue.drain()
    expect(userSaidDraft(first!)).toMatchObject({ uploads: [upload] })
    expect('uploads' in userSaidDraft(second!)).toBe(false)
  })

  it('prepare carries uploads into the drafts', () => {
    const queue = createPendingQueue()
    queue.enqueue({ text: 'x', uploads: [upload] })
    expect(queue.prepare().drafts[0]).toMatchObject({ uploads: [upload] })
  })

  it('keeps wire limits equal to core limits', () => {
    expect(WIRE_MAX_MESSAGE_UPLOADS).toBe(MAX_MESSAGE_UPLOADS)
    expect(WIRE_MAX_UPLOAD_BYTES).toBe(MAX_UPLOAD_BYTES)
  })
})
