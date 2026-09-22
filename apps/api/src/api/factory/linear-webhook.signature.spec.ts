import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyLinearSignature } from './linear-webhook.signature'

const SECRET = 'lin_whsec_test_secret'
const BODY = Buffer.from(JSON.stringify({ action: 'create', type: 'Comment' }))

function sign(args: { body: Buffer; secret: string }): string {
  return createHmac('sha256', args.secret).update(args.body).digest('hex')
}

describe('verifyLinearSignature', () => {
  it('accepts a signature computed with the same secret over the same body', () => {
    const signatureHeader = sign({ body: BODY, secret: SECRET })

    expect(verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(true)
  })

  it('rejects a signature computed with a different secret', () => {
    const signatureHeader = sign({ body: BODY, secret: 'a-different-secret' })

    expect(verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(false)
  })

  it('rejects a signature computed over a different body', () => {
    const otherBody = Buffer.from(JSON.stringify({ action: 'remove' }))
    const signatureHeader = sign({ body: otherBody, secret: SECRET })

    expect(verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(
      verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader: undefined }),
    ).toBe(false)
  })

  it('rejects a signature of the wrong length instead of throwing', () => {
    expect(verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader: 'ab' })).toBe(
      false,
    )
  })

  it('rejects a signature carrying a sha256= prefix', () => {
    const hex = sign({ body: BODY, secret: SECRET })

    expect(
      verifyLinearSignature({ secret: SECRET, rawBody: BODY, signatureHeader: `sha256=${hex}` }),
    ).toBe(false)
  })

  it('rejects a signature with non-hex characters', () => {
    expect(
      verifyLinearSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: 'zz'.repeat(32),
      }),
    ).toBe(false)
  })
})
