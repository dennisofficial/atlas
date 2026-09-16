import { createHash, timingSafeEqual } from 'node:crypto'

const BEARER_PREFIX = 'bearer '

const digestOf = (value: string): Buffer => createHash('sha256').update(value).digest()

/** Digests first so the comparison is fixed-width: a length difference would otherwise leak. */
export const tokenMatches = (args: { expected: string; offered: string | null }): boolean => {
  if (args.offered === null || args.expected.length === 0) return false
  return timingSafeEqual(digestOf(args.expected), digestOf(args.offered))
}

export const bearerToken = (header: string | null): string | null => {
  if (header === null) return null
  if (!header.toLowerCase().startsWith(BEARER_PREFIX)) return null

  const token = header.slice(BEARER_PREFIX.length).trim()
  return token.length === 0 ? null : token
}

export const offeredSubprotocols = (header: string | null): readonly string[] =>
  header === null
    ? []
    : header
        .split(',')
        .map((protocol) => protocol.trim())
        .filter((protocol) => protocol.length > 0)
