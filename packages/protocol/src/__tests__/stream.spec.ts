import { describe, expect, it } from 'bun:test'

import type { z } from 'zod'

import {
  EStreamClose,
  EStreamErrorCode,
  STREAM_EVENT_TYPES_VERSION,
  STREAM_HELLO_TIMEOUT_MS,
  STREAM_MAX_CLIENT_FRAME_BYTES,
  STREAM_MAX_SESSION_SUBSCRIPTIONS,
  STREAM_PAGE_EVENTS,
  STREAM_PROTOCOL_MIN_VERSION,
  STREAM_PROTOCOL_VERSION,
  STREAM_SESSION_VIEW_VERSION,
  STREAM_TAIL_EVENTS,
  parseClientMessage,
  parseServerMessage,
  streamClientMessageSchema,
  streamServerMessageSchema,
} from '../stream'
import { streamClientFixtures, streamServerFixtures } from '../testing/stream-fixtures'

const roundTrip = (value: unknown): unknown => JSON.parse(JSON.stringify(value))

describe('stream constants', () => {
  it('pins the protocol version, limits and close codes', () => {
    expect(STREAM_PROTOCOL_VERSION).toBe(3)
    expect(STREAM_SESSION_VIEW_VERSION).toBe(2)
    expect(STREAM_EVENT_TYPES_VERSION).toBe(3)
    expect(STREAM_PROTOCOL_MIN_VERSION).toBe(1)
    expect(STREAM_MAX_CLIENT_FRAME_BYTES).toBe(65_536)
    expect(STREAM_HELLO_TIMEOUT_MS).toBe(5_000)
    expect(STREAM_MAX_SESSION_SUBSCRIPTIONS).toBe(32)
    expect(STREAM_TAIL_EVENTS).toBe(1_000)
    expect(STREAM_PAGE_EVENTS).toBe(200)
    expect(EStreamClose.Unauthenticated).toBe(4401)
    expect(EStreamClose.SlowConsumer).toBe(4408)
    expect(EStreamClose.GoingAway).toBe(1001)
  })
})

describe('client messages', () => {
  for (const [name, fixture] of Object.entries(streamClientFixtures)) {
    it(`round-trips the ${name} fixture`, () => {
      const parsed = streamClientMessageSchema.parse(roundTrip(fixture))
      expect(parsed).toEqual(fixture as typeof parsed)
      expect(parseClientMessage(roundTrip(fixture))).toEqual({ ok: true, message: parsed })
    })

    it(`rejects an extra key on the ${name} fixture`, () => {
      expect(streamClientMessageSchema.safeParse({ ...fixture, extra: 1 }).success).toBe(false)
    })
  }

  it('rejects afterHash without afterSeq', () => {
    const { afterSeq: _afterSeq, ...withoutSeq } = streamClientFixtures.subscribeSession
    expect(streamClientMessageSchema.safeParse(withoutSeq).success).toBe(false)
  })

  it('accepts afterSeq without afterHash', () => {
    const { afterHash: _afterHash, ...withoutHash } = streamClientFixtures.subscribeSession
    expect(streamClientMessageSchema.safeParse(withoutHash).success).toBe(true)
  })

  it('accepts a session subscription at the tail', () => {
    const tail = { type: 'subscribe', id: 's', kind: 'session', sessionId: 'x' }
    expect(streamClientMessageSchema.safeParse(tail).success).toBe(true)
  })

  it('serializes a hello under the client frame limit', () => {
    const bytes = new TextEncoder().encode(JSON.stringify(streamClientFixtures.hello)).byteLength
    expect(bytes).toBeLessThan(STREAM_MAX_CLIENT_FRAME_BYTES)
  })

  it('reports an unknown client kind as unknown', () => {
    expect(parseClientMessage({ type: 'teleport', id: 'x' })).toEqual({ ok: false, unknown: true })
  })

  it('reports a malformed known client kind as an issue', () => {
    const result = parseClientMessage({ type: 'hello', v: 'one' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && 'issue' in result).toBe(true)
  })
})

describe('server messages', () => {
  for (const [name, fixture] of Object.entries(streamServerFixtures)) {
    it(`round-trips the ${name} fixture`, () => {
      const parsed = streamServerMessageSchema.parse(roundTrip(fixture))
      expect(parsed).toEqual(fixture as typeof parsed)
      expect(parseServerMessage(roundTrip(fixture))).toEqual({ ok: true, message: parsed })
    })

    it(`rejects an extra key on the ${name} fixture`, () => {
      expect(streamServerMessageSchema.safeParse({ ...fixture, extra: 1 }).success).toBe(false)
    })
  }

  it('rejects a negative delta offset', () => {
    expect(
      streamServerMessageSchema.safeParse({ ...streamServerFixtures.delta, from: -1 }).success,
    ).toBe(false)
  })

  it('rejects an unknown error code', () => {
    expect(streamServerMessageSchema.safeParse({ type: 'error', code: 'exploded' }).success).toBe(
      false,
    )
    expect(
      streamServerMessageSchema.safeParse({ type: 'error', code: EStreamErrorCode.Internal })
        .success,
    ).toBe(true)
  })
})

describe('protocol versions', () => {
  const accepts = (schema: z.ZodType, value: unknown) => schema.safeParse(value).success

  it('accepts a version 1 hello and a version 1 or 2 ready', () => {
    expect(accepts(streamClientMessageSchema, streamClientFixtures.helloV1)).toBe(true)
    expect(accepts(streamServerMessageSchema, streamServerFixtures.readyV1)).toBe(true)
    expect(accepts(streamServerMessageSchema, streamServerFixtures.ready)).toBe(true)
  })

  it('refuses a hello below the minimum version', () => {
    const hello = { ...streamClientFixtures.hello, v: 0 }
    expect(accepts(streamClientMessageSchema, hello)).toBe(false)
  })

  it('parses both view frames and refuses an unknown view name', () => {
    expect(parseServerMessage(streamServerFixtures.view).ok).toBe(true)
    expect(parseServerMessage(streamServerFixtures.viewSession).ok).toBe(true)
    expect(parseServerMessage({ ...streamServerFixtures.view, name: 'other' }).ok).toBe(false)
  })

  it('refuses a session view carrying a status value', () => {
    const frame = { ...streamServerFixtures.viewSession, value: streamServerFixtures.view.value }
    expect(parseServerMessage(frame).ok).toBe(false)
  })
})

describe('version skew', () => {
  it('ignores a well-formed message of a kind it does not know', () => {
    expect(parseServerMessage({ type: 'from-the-future', id: 'x', payload: 1 })).toEqual({
      ok: false,
      unknown: true,
    })
  })

  it('reports a bad known kind as an issue, not unknown', () => {
    const result = parseServerMessage({ type: 'delta', id: 'x' })
    expect(result.ok).toBe(false)
    expect(result.ok === false && 'unknown' in result).toBe(false)
    expect(result.ok === false && 'issue' in result).toBe(true)
  })

  it('reports non-objects and typeless objects as issues', () => {
    for (const raw of [null, 7, 'ready', [], {}, { type: 5 }]) {
      const result = parseServerMessage(raw)
      expect(result.ok === false && 'issue' in result).toBe(true)
    }
  })
})
