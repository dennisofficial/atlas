import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import { verifyAgent37Signature } from './agent37-webhook.signature'

const SECRET = `whsec_${Buffer.from('agent37-test-signing-key').toString('base64')}`
const NOW_MS = Date.parse('2026-11-19T12:00:00.000Z')
const ID = '6f1c0d0e-2a4b-4c1e-9d3a-8b7e5f0a1c2d'
const BODY = Buffer.from(JSON.stringify({ type: 'instance.status.updated' }))

const timestampAt = (offsetSeconds: number): string =>
  String(Math.floor(NOW_MS / 1000) + offsetSeconds)

function signatureOf(args: {
  secret?: string | undefined
  id?: string | undefined
  timestamp?: string | undefined
  body?: Buffer | undefined
}): string {
  const key = Buffer.from((args.secret ?? SECRET).replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', key)
    .update(`${args.id ?? ID}.${args.timestamp ?? timestampAt(0)}.`)
    .update(args.body ?? BODY)
    .digest('base64')
  return `v1,${digest}`
}

const verify = (patch: {
  secret?: string
  id?: string
  timestamp?: string
  body?: Buffer
  signatureHeader?: string | undefined
  nowMs?: number
}) =>
  verifyAgent37Signature({
    secret: patch.secret ?? SECRET,
    id: patch.id ?? ID,
    timestamp: patch.timestamp ?? timestampAt(0),
    rawBody: patch.body ?? BODY,
    signatureHeader:
      'signatureHeader' in patch
        ? patch.signatureHeader
        : signatureOf({ id: patch.id, timestamp: patch.timestamp, secret: patch.secret }),
    nowMs: patch.nowMs ?? NOW_MS,
  })

describe('verifyAgent37Signature', () => {
  it('accepts a signature over the id, timestamp and body', () => {
    expect(verify({})).toBe(true)
  })

  it('accepts the matching signature among several', () => {
    expect(verify({ signatureHeader: `v1,AAAA ${signatureOf({})}` })).toBe(true)
  })

  it('rejects a signature made with another secret', () => {
    expect(
      verify({
        signatureHeader: signatureOf({
          secret: `whsec_${Buffer.from('other').toString('base64')}`,
        }),
      }),
    ).toBe(false)
  })

  it('rejects a body that changed after signing', () => {
    expect(verify({ body: Buffer.from('{"type":"instance.status.updated","x":1}') })).toBe(false)
  })

  it('rejects a replayed signature outside the five minute window', () => {
    expect(verify({ nowMs: NOW_MS + 301_000 })).toBe(false)
    expect(verify({ nowMs: NOW_MS - 301_000 })).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(verify({ signatureHeader: undefined })).toBe(false)
  })

  it('rejects a signature without the v1 prefix', () => {
    expect(verify({ signatureHeader: signatureOf({}).slice('v1,'.length) })).toBe(false)
  })

  it('rejects a timestamp that is not an integer', () => {
    expect(verify({ timestamp: 'soon' })).toBe(false)
  })
})
