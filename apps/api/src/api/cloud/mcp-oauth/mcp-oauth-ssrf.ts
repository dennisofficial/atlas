import { lookup } from 'node:dns/promises'
import type { OAuthFetch } from '@dltech/atlas-harness/mcp-oauth'
import type { McpOauthFetcher } from './mcp-oauth.types'

export class SsrfRejectedError extends Error {}

export type HostResolver = (hostname: string) => Promise<string[]>

export const REQUEST_TIMEOUT_MS = 10_000

export const lookupHost: HostResolver = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address)

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HEX_GROUP = /^[0-9a-f]{1,4}$/

const parseIpv4 = (text: string): number[] | undefined => {
  const match = IPV4.exec(text)
  if (match === null) return undefined
  const octets = match.slice(1).map(Number)
  return octets.every((octet) => octet <= 255) ? octets : undefined
}

const parseIpv6 = (text: string): number[] | undefined => {
  const bare = (text.split('%')[0] ?? '').toLowerCase()
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(bare)
  let expanded = bare
  if (dotted !== null) {
    const octets = parseIpv4(dotted[1] ?? '')
    if (octets === undefined) return undefined
    const [a = 0, b = 0, c = 0, d = 0] = octets
    expanded = `${bare.slice(0, -(dotted[1] ?? '').length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = expanded.split('::')
  if (halves.length > 2) return undefined
  const groupsOf = (part: string | undefined) =>
    part === undefined || part === '' ? [] : part.split(':')
  const left = groupsOf(halves[0])
  const right = halves.length === 2 ? groupsOf(halves[1]) : []
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined
  const groups = [
    ...left,
    ...Array.from({ length: halves.length === 2 ? missing : 0 }, () => '0'),
    ...right,
  ]
  if (!groups.every((group) => HEX_GROUP.test(group))) return undefined
  return groups.map((group) => Number.parseInt(group, 16))
}

const isBlockedIpv4 = (octets: number[]): boolean => {
  const [a = 0, b = 0, c = 0] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 192 && b === 0 && c === 0) return true
  if (a === 198 && (b === 18 || b === 19)) return true
  return a === 100 && b >= 64 && b <= 127
}

const isBlockedIpv6 = (groups: number[]): boolean => {
  const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0] = groups
  const zeroPrefix = [g0, g1, g2, g3, g4, g5].every((group) => group === 0)
  if (zeroPrefix) return true
  if ([g0, g1, g2, g3, g4].every((group) => group === 0) && g5 === 0xffff) return true
  if (g0 === 0x64 && g1 === 0xff9b && [g2, g3, g4, g5].every((group) => group === 0)) return true
  if (g0 === 0x2002) return true
  if ((g0 & 0xffc0) === 0xfec0 || (g0 & 0xffc0) === 0xfe80) return true
  if ((g0 & 0xfe00) === 0xfc00) return true
  return (g0 & 0xff00) === 0xff00
}

export const isBlockedAddress = (address: string): boolean => {
  const v4 = parseIpv4(address)
  if (v4 !== undefined) return isBlockedIpv4(v4)
  const v6 = parseIpv6(address.replace(/^\[|\]$/g, ''))
  return v6 === undefined ? true : isBlockedIpv6(v6)
}

const literalAddress = (host: string): string | undefined => {
  if (host.startsWith('[')) return host
  return IPV4.test(host) ? host : undefined
}

export const assertPublicUrl = (args: { url: string; allowLocalTargets: boolean }): void => {
  if (args.allowLocalTargets) return
  let parsed: URL
  try {
    parsed = new URL(args.url)
  } catch {
    throw new SsrfRejectedError(`not a valid URL: ${args.url}`)
  }
  if (parsed.protocol !== 'https:') throw new SsrfRejectedError('only https URLs are allowed')
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) {
    throw new SsrfRejectedError('localhost is not allowed')
  }
  const literal = literalAddress(host)
  if (literal !== undefined && isBlockedAddress(literal)) {
    throw new SsrfRejectedError('private network addresses are not allowed')
  }
}

export const assertPublicHost = async (args: {
  url: string
  allowLocalTargets: boolean
  resolveHost?: HostResolver | undefined
}): Promise<void> => {
  if (args.allowLocalTargets) return
  assertPublicUrl(args)
  const host = new URL(args.url).hostname.toLowerCase().replace(/\.$/, '')
  if (literalAddress(host) !== undefined) return
  const addresses = await (args.resolveHost ?? lookupHost)(host)
  if (addresses.length === 0) throw new SsrfRejectedError(`could not resolve ${host}`)
  if (addresses.some(isBlockedAddress)) {
    throw new SsrfRejectedError('private network addresses are not allowed')
  }
}

export const guardedFetch = (args: {
  fetcher: McpOauthFetcher
  allowLocalTargets: boolean
  resolveHost?: HostResolver | undefined
}): OAuthFetch => {
  return async (input, init) => {
    await assertPublicHost({
      url: input,
      allowLocalTargets: args.allowLocalTargets,
      resolveHost: args.resolveHost,
    })
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    return args.fetcher.fetch(input, { ...init, signal, redirect: 'manual' })
  }
}
