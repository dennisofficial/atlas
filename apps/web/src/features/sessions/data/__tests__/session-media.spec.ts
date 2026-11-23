import { describe, expect, it } from 'bun:test'

import { EAttachmentStatus } from '@/features/threads/data/composer-attachments'

import {
  hasMediaFailed,
  isMediaUploading,
  planImageAttach,
  readyMediaOf,
  startedMedia,
  withMediaFailed,
  withMediaReady,
} from '../session-media'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

const file = (name: string, type: string) => new File(['x'], name, { type })

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
