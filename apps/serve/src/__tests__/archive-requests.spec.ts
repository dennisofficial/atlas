import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-harness'
import { readMemoryArchiveReplySchema, readSessionArchiveReplySchema } from '@dltech/atlas-wire'

import { answerArchiveRead } from '../archive-requests'
import type { RequestFrame } from '../request-reply'

const descriptor = {
  path: '/atlas/home/exports/session-root-0123456789ab.tar.gz',
  size: 12,
  sha256: 'b'.repeat(64),
  threadId: toThreadId('root'),
}

const frameOf = (op: EClientRequest): RequestFrame => ({ kind: 'request', id: 'r1', op, params: {} }) as RequestFrame

describe('answering an archive read', () => {
  it('answers the session archive as a descriptor, never a string', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: async () => descriptor,
      memoryArchive: undefined,
    })

    expect(reply.ok).toBe(true)
    expect(readSessionArchiveReplySchema.parse(reply.data)).toEqual({ archive: descriptor })
    expect(typeof (reply.data as { archive: unknown }).archive).toBe('object')
  })

  it('answers null when the session holds nothing', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: async () => null,
      memoryArchive: undefined,
    })

    expect(reply.data).toEqual({ archive: null })
  })

  it('keeps the memory archive on its own base64 string path', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadMemoryArchive),
      sessionArchive: undefined,
      memoryArchive: async () => new Uint8Array([1, 2, 3]),
    })
    const empty = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadMemoryArchive),
      sessionArchive: undefined,
      memoryArchive: async () => null,
    })

    expect(readMemoryArchiveReplySchema.parse(reply.data)).toEqual({ archive: 'AQID' })
    expect(empty.data).toEqual({ archive: '' })
  })

  it('refuses a transcript read when the serve has no session archive, even with memory present', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: undefined,
      memoryArchive: async () => new Uint8Array(),
    })

    expect(reply.ok).toBe(false)
    expect(reply.data).toEqual({ message: 'this serve has no transcript to read' })
  })

  it('refuses with the failure message when the export fails', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: async () => {
        throw new Error('disk full')
      },
      memoryArchive: undefined,
    })

    expect(reply.ok).toBe(false)
    expect(reply.data).toEqual({ message: 'disk full' })
  })
})
