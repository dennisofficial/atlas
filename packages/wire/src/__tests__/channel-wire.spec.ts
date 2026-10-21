import { describe, expect, it } from 'vitest'

import {
  decodeClientFrame,
  decodeServeFrame,
  EClientFrame,
  encodeFrame,
  EServeFrame,
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

