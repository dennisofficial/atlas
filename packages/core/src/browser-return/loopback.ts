import {
  browserReturnOf,
  LOOPBACK_HOST,
  LOOPBACK_PATH,
  parsedUrlOf,
  type ReturnOutcome,
} from './links'

export const LOOPBACK_TIMEOUT_MS = 10 * 60_000

const LOOPBACK_ADDRESSES: ReadonlySet<string> = new Set([LOOPBACK_HOST, '::ffff:127.0.0.1'])

export type LoopbackReply = { accepted: true; outcome: ReturnOutcome } | { accepted: false }

const REJECTED: LoopbackReply = { accepted: false }

export const loopbackReplyOf = (args: {
  method: string
  address: string | undefined
  url: string
  port: number
  state: string
}): LoopbackReply => {
  if (args.method !== 'GET') return REJECTED
  if (args.address === undefined || !LOOPBACK_ADDRESSES.has(args.address)) return REJECTED
  const parsed = parsedUrlOf(args.url)
  if (parsed === undefined) return REJECTED
  if (parsed.hostname !== LOOPBACK_HOST || Number(parsed.port) !== args.port) return REJECTED
  if (parsed.pathname !== LOOPBACK_PATH) return REJECTED
  const returned = browserReturnOf(args.url)
  if (returned === undefined || returned.state !== args.state) return REJECTED
  return { accepted: true, outcome: returned.outcome }
}
