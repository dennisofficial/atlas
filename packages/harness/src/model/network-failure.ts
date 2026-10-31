import { droppedByMessageHeuristic } from './dropped-by-message'

const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
])

const UNDICI_PREFIX = 'UND_ERR_'
const NETWORK_NAMES: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError'])
const FETCH_FAILED = 'fetch failed'
const MAX_CHAIN_DEPTH = 8

const codeOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined
  return typeof error.code === 'string' ? error.code : undefined
}

const causeOf = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'cause' in error ? error.cause : undefined

const isNetworkCode = (code: string): boolean =>
  NETWORK_CODES.has(code) || code.startsWith(UNDICI_PREFIX)

const isNetworkLink = (error: unknown): boolean => {
  const code = codeOf(error)
  if (code !== undefined && isNetworkCode(code)) return true
  if (!(error instanceof Error)) return false
  if (NETWORK_NAMES.has(error.name)) return true
  return error instanceof TypeError && error.message === FETCH_FAILED
}

export function networkFailureOf(error: unknown): boolean {
  let link: unknown = error
  for (let depth = 0; depth < MAX_CHAIN_DEPTH && link !== undefined; depth += 1) {
    if (isNetworkLink(link) || droppedByMessageHeuristic(link)) return true
    link = causeOf(link)
  }
  return false
}
