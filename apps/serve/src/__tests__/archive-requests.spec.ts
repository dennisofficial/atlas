import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import { EClientRequest } from '@dltech/atlas-harness'
import { readSessionArchiveReplySchema } from '@dltech/atlas-wire'

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
    })

    expect(reply.ok).toBe(true)
    expect(readSessionArchiveReplySchema.parse(reply.data)).toEqual({ archive: descriptor })
    expect(typeof (reply.data as { archive: unknown }).archive).toBe('object')
  })

  it('answers null when the session holds nothing', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: async () => null,
    })

    expect(reply.data).toEqual({ archive: null })
  })

  it('refuses a transcript read when the serve has no session archive', async () => {
    const reply = await answerArchiveRead({
      frame: frameOf(EClientRequest.ReadSessionArchive),
      sessionArchive: undefined,
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
    })

    expect(reply.ok).toBe(false)
    expect(reply.data).toEqual({ message: 'disk full' })
  })
})
