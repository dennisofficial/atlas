import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, describe, expect, it } from 'bun:test'
import { toThreadId } from '@dltech/atlas-core'
import type { SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { downloadSessionArchive, SESSION_EXPORT_DIRECTORY } from '../session-archive-transport'
import type { TransferProgress } from '../transfer-progress'

const threadId = toThreadId('brn_stream-root')
const path = `${SESSION_EXPORT_DIRECTORY}/session-${threadId}-abcdef012345.tar.gz`
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

const descriptor = (bytes: Buffer): SessionArchiveDescriptor => ({
  path,
  threadId,
  size: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

const download = async (args: { archive: Buffer; streamed: Buffer[] }) => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-session-progress-'))
  roots.push(root)
  const events: TransferProgress[] = []
  let error: unknown
  try {
    await downloadSessionArchive({
      sandbox: { readFile: async () => Readable.from(args.streamed) },
      threadId,
      archive: descriptor(args.archive),
      destination: join(root, 'session.tar.gz'),
      onProgress: (progress) => events.push(progress),
    })
  } catch (failure) {
    error = failure
  }
  return { events, error, root }
}

describe('session archive download progress', () => {
  it('reports cumulative verified bytes against the descriptor size and completes after publication', async () => {
    const bytes = Buffer.from('session bytes')
    const { events, error, root } = await download({
      archive: bytes,
      streamed: [bytes.subarray(0, 3), bytes.subarray(3, 8), bytes.subarray(8)],
    })

    expect(error).toBeUndefined()
    expect(events).toEqual([
      { transferredBytes: 0, totalBytes: 13, complete: false },
      { transferredBytes: 3, totalBytes: 13, complete: false },
      { transferredBytes: 8, totalBytes: 13, complete: false },
      { transferredBytes: 13, totalBytes: 13, complete: false },
      { transferredBytes: 13, totalBytes: 13, complete: true },
    ])
    expect(await readdir(root)).toEqual(['session.tar.gz'])
  })

  it('never completes on a checksum mismatch', async () => {
    const bytes = Buffer.from('correct')
    const { events, error, root } = await download({ archive: bytes, streamed: [Buffer.from('altered')] })

    expect(String(error)).toContain('checksum')
    expect(events.some((event) => event.complete)).toBe(false)
    expect(await readdir(root)).toEqual([])
  })

  it('never completes on a short stream', async () => {
    const bytes = Buffer.from('correct')
    const { events, error } = await download({ archive: bytes, streamed: [bytes.subarray(0, 2)] })

    expect(error).toBeInstanceOf(Error)
    expect(events.at(-1)).toEqual({ transferredBytes: 2, totalBytes: 7, complete: false })
  })

  it('stops counting and never completes on an oversized stream', async () => {
    const bytes = Buffer.from('correct')
    const { events, error, root } = await download({ archive: bytes, streamed: [bytes, bytes] })

    expect(String(error)).toContain('declared size')
    expect(Math.max(...events.map((event) => event.transferredBytes))).toBe(7)
    expect(events.some((event) => event.complete)).toBe(false)
    expect(await readdir(root)).toEqual([])
  })
})
