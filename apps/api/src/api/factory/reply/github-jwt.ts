import { createSign } from 'node:crypto'

const JWT_TTL_SECONDS = 9 * 60
const CLOCK_SKEW_SECONDS = 60

const encode = (value: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/** Tier files store the PEM on one line with escaped newlines; real newlines pass through. */
export const normalizePrivateKey = (raw: string): string =>
  raw.includes('\n') ? raw : raw.replaceAll('\\n', '\n')

// https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
export function mintAppJwt(args: {
  appId: string
  privateKey: string
  nowSeconds: number
}): string {
  const header = encode({ alg: 'RS256', typ: 'JWT' })
  const payload = encode({
    iat: args.nowSeconds - CLOCK_SKEW_SECONDS,
    exp: args.nowSeconds + JWT_TTL_SECONDS,
    iss: args.appId,
  })
  const unsigned = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsigned)
  const signature = signer.sign(normalizePrivateKey(args.privateKey)).toString('base64url')
  return `${unsigned}.${signature}`
}
