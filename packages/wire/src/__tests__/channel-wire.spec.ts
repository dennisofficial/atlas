import { describe, expect, it } from 'bun:test'

import {
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  EClientRequest,
  encodeFrame,
  EServeFrame,
  readMemoryArchiveReplySchema,
  readSessionArchiveReplySchema,
  SESSION_EXPORT_DIRECTORY_NAME,
  SESSION_EXPORT_FILE_PATTERN,
  sessionArchiveDescriptorSchema,
  type ClientFrame,
  type ServeFrame,
} from '../index'

describe('the send frame', () => {
  it('round-trips a bare text message unchanged', () => {
    const frame: ClientFrame = { kind: EClientFrame.Send, sendId: 'send-1' as never, text: 'hello' }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips images and context drafts, so a steered message lands as a local one would', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Send,
      sendId: 'send-2' as never,
      text: 'look at this',
      images: [
        { path: '/tmp/shot.png', mediaType: 'image/png', data: 'aGVsbG8=', width: 560, height: 280 },
      ],
      context: [
        { type: 'context-loaded', slot: 'skill', key: 'commit', content: 'commit prose' },
        {
          type: 'context-loaded',
          slot: 'file',
          key: 'src/a.ts',
          content: 'const a = 1',
          triggeredBy: 'mention',
        },
        { type: 'nudge', text: 'stay on task', lifetimeSteps: 2 },
        { type: 'user-said', text: 'quoted', via: 'operator' },
      ],
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('carries context opaquely — validating the drafts is the harness’s job at the decode seam', () => {
    const sendId = 'send-3' as const
    const raw = JSON.stringify({
      kind: EClientFrame.Send,
      sendId,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })

    expect(decodeClientFrame(raw)).toEqual({
      kind: EClientFrame.Send,
      sendId: sendId as never,
      text: 'go',
      context: [{ type: 'context-loaded', slot: 'skill' }],
    })
  })

  it('drops a send without a sendId — a re-drivable send must name its re-drive', () => {
    const raw = JSON.stringify({ kind: EClientFrame.Send, text: 'hello' })

    expect(decodeClientFrame(raw)).toBeNull()
  })
})

describe('the send ack', () => {
  it('round-trips the sendId the serve committed', () => {
    const frame: ServeFrame = { kind: EServeFrame.SendAcked, sendId: 'send-1' as never }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('drops an ack without a sendId', () => {
    expect(decodeServeFrame(JSON.stringify({ kind: EServeFrame.SendAcked }))).toBeNull()
  })
})

describe('the ready frame', () => {
  it('round-trips the transcript-currency vouch', () => {
    const frame: ServeFrame = { kind: EServeFrame.Ready, seq: 1, transcriptCurrent: true }

    expect(decodeServeFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('decodes a ready from a serve built before the vouch, leaving it absent', () => {
    const decoded = decodeServeFrame(JSON.stringify({ kind: EServeFrame.Ready, seq: 1 }))

    expect(decoded).toEqual({ kind: EServeFrame.Ready, seq: 1 })
    expect(decoded?.kind === EServeFrame.Ready ? decoded.transcriptCurrent : true).toBeUndefined()
  })

  it('keeps a negative vouch distinct from no vouch at all', () => {
    const frame: ServeFrame = { kind: EServeFrame.Ready, seq: 1, transcriptCurrent: false }

    const decoded = decodeServeFrame(encodeFrame(frame))
    expect(decoded).toEqual(frame)
    expect(decoded?.kind === EServeFrame.Ready ? decoded.transcriptCurrent : undefined).toBe(false)
  })
})

describe('the memory archive op', () => {
  it('round-trips a read-memory-archive request through the request frame', () => {
    const frame: ClientFrame = {
      kind: EClientFrame.Request,
      id: 'mem-1',
      op: EClientRequest.ReadMemoryArchive,
      params: {},
    }

    expect(decodeClientFrame(encodeFrame(frame))).toEqual(frame)
  })

  it('round-trips its reply — a base64 tar, empty when the sandbox holds no memory', () => {
    const reply = { archive: 'H4sIAAAAAAAAA2NgGAWjYGgH' }

    expect(readMemoryArchiveReplySchema.parse(reply)).toEqual(reply)
    expect(readMemoryArchiveReplySchema.parse({ archive: '' })).toEqual({ archive: '' })
  })

  it('drops a reply whose archive is not a string', () => {
    expect(readMemoryArchiveReplySchema.safeParse({ archive: 42 }).success).toBe(false)
  })
})

const descriptor = {
  path: '/atlas/home/exports/session-root-0123456789ab.tar.gz',
  size: 1_640_826_469,
  sha256: 'a'.repeat(64),
  threadId: 'root',
}

describe('the session archive op', () => {
  it('answers a small file descriptor, or null when the session holds nothing', () => {
    expect(JSON.stringify(readSessionArchiveReplySchema.parse({ archive: descriptor }))).toBe(JSON.stringify({ archive: descriptor }))
    expect(readSessionArchiveReplySchema.parse({ archive: null })).toEqual({ archive: null })
  })

  it('refuses the old base64 string reply, so archive bytes never ride the JSON', () => {
    expect(readSessionArchiveReplySchema.safeParse({ archive: 'H4sIAAAAAAAAA2NgGAWjYGgH' }).success).toBe(false)
    expect(readSessionArchiveReplySchema.safeParse({ archive: '' }).success).toBe(false)
  })

  it.each([
    { size: -1 },
    { size: 1.5 },
    { size: Number.MAX_SAFE_INTEGER + 2 },
    { sha256: 'A'.repeat(64) },
    { sha256: 'a'.repeat(63) },
    { path: '' },
    { threadId: '' },
  ])('refuses a malformed descriptor field %o', (override) => {
    expect(sessionArchiveDescriptorSchema.safeParse({ ...descriptor, ...override }).success).toBe(false)
  })

  it('names the export directory and a safe file pattern', () => {
    expect(SESSION_EXPORT_DIRECTORY_NAME).toBe('exports')
    expect(SESSION_EXPORT_FILE_PATTERN.test('session-root-0123456789ab.tar.gz')).toBe(true)
    expect(SESSION_EXPORT_FILE_PATTERN.test('session-../x.tar.gz')).toBe(false)
    expect(SESSION_EXPORT_FILE_PATTERN.test('workspace-x.tar.gz')).toBe(false)
  })
})
