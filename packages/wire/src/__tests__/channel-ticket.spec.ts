import { describe, expect, it } from 'bun:test'

import { channelTicketThread, channelTicketValid, mintChannelTicket } from '../channel-ticket.js'

const NOW = Date.parse('2026-10-22T12:00:00.000Z')
const SERVE_TOKEN = 'serve-token-abc'
const THREAD = 'thr-1'

const mint = (args: { ttlSeconds?: number; serveToken?: string; threadId?: string } = {}) =>
  mintChannelTicket({
    serveToken: args.serveToken ?? SERVE_TOKEN,
    threadId: args.threadId ?? THREAD,
    ttlSeconds: args.ttlSeconds ?? 60,
    nowMs: NOW,
  })

const valid = (args: {
  ticket: string
  nowMs?: number
  serveToken?: string
  threadId?: string
}): boolean =>
  channelTicketValid({
    serveToken: args.serveToken ?? SERVE_TOKEN,
    threadId: args.threadId ?? THREAD,
    ticket: args.ticket,
    nowMs: args.nowMs ?? NOW,
  })

const base64url = (value: string): string => Buffer.from(value).toString('base64url')

describe('channel tickets', () => {
  it('round-trips and reports its expiry as an ISO instant', () => {
    const { ticket, expiresAt } = mint({ ttlSeconds: 60 })

    expect(ticket.startsWith('ct1.')).toBe(true)
    expect(ticket.split('.')).toHaveLength(3)
    expect(expiresAt).toBe('2026-10-22T12:01:00.000Z')
    expect(valid({ ticket })).toBe(true)
  })

  it('is valid up to its expiry and not at it', () => {
    const { ticket } = mint({ ttlSeconds: 60 })

    expect(valid({ ticket, nowMs: NOW + 59_999 })).toBe(true)
    expect(valid({ ticket, nowMs: NOW + 60_000 })).toBe(false)
    expect(valid({ ticket, nowMs: NOW + 120_000 })).toBe(false)
  })

  it('rejects a tampered payload', () => {
    const [prefix, , signature] = mint().ticket.split('.')
    const forged = base64url(
      JSON.stringify({ aud: 'serve-channel', threadId: THREAD, exp: NOW / 1000 + 86_400 }),
    )

    expect(valid({ ticket: `${prefix}.${forged}.${signature}` })).toBe(false)
  })

  it('rejects a tampered signature', () => {
    const [prefix, payload, signature = ''] = mint().ticket.split('.')
    const flipped = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`

    expect(valid({ ticket: `${prefix}.${payload}.${flipped}` })).toBe(false)
    expect(valid({ ticket: `${prefix}.${payload}.${signature.slice(1)}` })).toBe(false)
    expect(valid({ ticket: `${prefix}.${payload}.${signature}ab` })).toBe(false)
    expect(valid({ ticket: `${prefix}.${payload}.` })).toBe(false)
  })

  it('rejects a ticket minted for another thread', () => {
    expect(valid({ ticket: mint({ threadId: 'thr-2' }).ticket })).toBe(false)
  })

  it('rejects a ticket signed with another serve token', () => {
    expect(valid({ ticket: mint({ serveToken: 'other-token' }).ticket })).toBe(false)
  })

  it('rejects the raw serve token and garbage without throwing', () => {
    const garbage = [
      '',
      'ct1',
      'ct1.',
      'ct1..',
      'ct1.a.b',
      'ct1.a.b.c',
      'ct2.a.b',
      SERVE_TOKEN,
      'not a ticket at all',
      '....',
      `ct1.${base64url('not json')}.${base64url('sig')}`,
      `ct1.${base64url('{"aud":"x"}')}.${base64url('sig')}`,
      `ct1.${base64url('null')}.${base64url('sig')}`,
    ]

    for (const ticket of garbage) expect(valid({ ticket })).toBe(false)
  })

  it('rejects a payload with the wrong audience', () => {
    const [prefix, , signature] = mint().ticket.split('.')
    const wrongAudience = base64url(
      JSON.stringify({ aud: 'other', threadId: THREAD, exp: NOW / 1000 + 60 }),
    )

    expect(valid({ ticket: `${prefix}.${wrongAudience}.${signature}` })).toBe(false)
  })

  it('refuses an empty serve token on both sides', () => {
    expect(() => mint({ serveToken: '' })).toThrow()
    expect(valid({ ticket: mint().ticket, serveToken: '' })).toBe(false)
  })
})

describe('channelTicketThread', () => {
  const hinted = (args: { ticket: string; nowMs?: number; serveToken?: string }): string | null =>
    channelTicketThread({
      serveToken: args.serveToken ?? SERVE_TOKEN,
      ticket: args.ticket,
      nowMs: args.nowMs ?? NOW,
    })

  it('reads the thread of a sound ticket without pinning one', () => {
    expect(hinted({ ticket: mint().ticket })).toBe(THREAD)
    expect(hinted({ ticket: mint({ threadId: 'thr-2' }).ticket })).toBe('thr-2')
  })

  it('answers null for tampered, expired and foreign tickets', () => {
    const [prefix, , signature] = mint().ticket.split('.')
    const forged = base64url(
      JSON.stringify({ aud: 'serve-channel', threadId: 'thr-9', exp: NOW / 1000 + 60 }),
    )

    expect(hinted({ ticket: `${prefix}.${forged}.${signature}` })).toBe(null)
    expect(hinted({ ticket: mint().ticket, nowMs: NOW + 120_000 })).toBe(null)
    expect(hinted({ ticket: mint().ticket, serveToken: 'other-token' })).toBe(null)
    expect(hinted({ ticket: 'not a ticket at all' })).toBe(null)
    expect(hinted({ ticket: mint().ticket, serveToken: '' })).toBe(null)
  })
})
