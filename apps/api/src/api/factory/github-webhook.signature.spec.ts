import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyGithubSignature } from './github-webhook.signature'

const SECRET = 'whsec_test_secret'
const BODY = Buffer.from(JSON.stringify({ zen: 'keep it logically awesome' }))

function sign(args: { body: Buffer; secret: string }): string {
  return `sha256=${createHmac('sha256', args.secret).update(args.body).digest('hex')}`
}

describe('verifyGithubSignature', () => {
  it('accepts a signature computed with the same secret over the same body', () => {
    const signatureHeader = sign({ body: BODY, secret: SECRET })

    expect(verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(true)
  })

  it('rejects a signature computed with a different secret', () => {
    const signatureHeader = sign({ body: BODY, secret: 'a-different-secret' })

    expect(verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(false)
  })

  it('rejects a signature computed over a different body', () => {
    const otherBody = Buffer.from(JSON.stringify({ zen: 'tampered' }))
    const signatureHeader = sign({ body: otherBody, secret: SECRET })

    expect(verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader })).toBe(false)
  })

  it('rejects a missing signature header', () => {
    expect(
      verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader: undefined }),
    ).toBe(false)
  })

  it('rejects a signature of the wrong length instead of throwing', () => {
    expect(
      verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader: 'sha256=ab' }),
    ).toBe(false)
  })

  it('rejects a signature missing the sha256= prefix', () => {
    const hex = createHmac('sha256', SECRET).update(BODY).digest('hex')

    expect(verifyGithubSignature({ secret: SECRET, rawBody: BODY, signatureHeader: hex })).toBe(false)
  })

  it('rejects a signature with non-hex characters', () => {
    expect(
      verifyGithubSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: `sha256=${'zz'.repeat(32)}`,
      }),
    ).toBe(false)
  })
})
