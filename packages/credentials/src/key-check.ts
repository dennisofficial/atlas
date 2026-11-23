import { EAuthProvider, providerSpec } from '@dltech/atlas-core'

export enum EKeyCheckFault {
  Format = 'format',
  Refused = 'refused',
  Unreachable = 'unreachable',
}

export type KeyCheck = { ok: true } | { ok: false; fault: EKeyCheckFault; detail: string }

const MIN_LENGTH = 20
const DEFAULT_TIMEOUT_MS = 5000
const REFUSED_STATUS = [401, 403]

const REQUIRED_PREFIX: Partial<Record<EAuthProvider, string>> = {
  [EAuthProvider.Anthropic]: 'sk-ant-',
  [EAuthProvider.OpenAI]: 'sk-',
  [EAuthProvider.OpenRouter]: 'sk-or-',
}

type Probe = { url: string; headers: (apiKey: string) => Record<string, string> }

const bearer = (apiKey: string): Record<string, string> => ({ authorization: `Bearer ${apiKey}` })

const PROBES: Record<EAuthProvider, Probe> = {
  [EAuthProvider.Anthropic]: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (apiKey) => ({ 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }),
  },
  [EAuthProvider.OpenAI]: { url: 'https://api.openai.com/v1/models', headers: bearer },
  [EAuthProvider.OpenRouter]: { url: 'https://openrouter.ai/api/v1/key', headers: bearer },
  [EAuthProvider.Inference]: { url: 'https://api.inference.net/v1/models', headers: bearer },
  [EAuthProvider.Typesafe]: { url: 'https://api.typesafe.ai/v1/models', headers: bearer },
  [EAuthProvider.Gateway]: { url: 'https://ai-gateway.vercel.sh/v1/credits', headers: bearer },
}

export const keyFormatFault = (args: {
  provider: EAuthProvider
  apiKey: string
}): string | undefined => {
  const key = args.apiKey.trim()
  const label = providerSpec(args.provider).label
  if (key.length === 0) return 'This key is empty.'
  if (/\s/.test(key)) return 'This key has spaces in it.'
  if (key.length < MIN_LENGTH) return 'This key is too short.'
  const prefix = REQUIRED_PREFIX[args.provider]
  if (prefix !== undefined && !key.startsWith(prefix))
    return `An ${label} key starts with ${prefix}.`
  return undefined
}

const unreachableDetail = (args: { label: string; reason: string }): string =>
  `Atlas could not reach ${args.label} to check this key (${args.reason}). Try again.`

const faultOf = (args: {
  provider: EAuthProvider
  status: number
}): { fault: EKeyCheckFault; detail: string } => {
  const label = providerSpec(args.provider).label
  if (REFUSED_STATUS.includes(args.status))
    return { fault: EKeyCheckFault.Refused, detail: `${label} refused this key (${args.status}).` }
  return {
    fault: EKeyCheckFault.Unreachable,
    detail: unreachableDetail({ label, reason: String(args.status) }),
  }
}

const reasonOf = (error: unknown): string =>
  error instanceof Error && error.name === 'AbortError'
    ? 'timed out'
    : error instanceof Error
      ? error.message
      : String(error)

export const checkProviderKey = async (args: {
  provider: EAuthProvider
  apiKey: string
  fetch: typeof fetch
  timeoutMs?: number
}): Promise<KeyCheck> => {
  const formatFault = keyFormatFault({ provider: args.provider, apiKey: args.apiKey })
  if (formatFault !== undefined)
    return { ok: false, fault: EKeyCheckFault.Format, detail: formatFault }
  const probe = PROBES[args.provider]
  const label = providerSpec(args.provider).label
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const response = await args.fetch(probe.url, {
      method: 'GET',
      headers: probe.headers(args.apiKey.trim()),
      signal: controller.signal,
    })
    if (response.ok) return { ok: true }
    return { ok: false, ...faultOf({ provider: args.provider, status: response.status }) }
  } catch (error) {
    return {
      ok: false,
      fault: EKeyCheckFault.Unreachable,
      detail: unreachableDetail({ label, reason: reasonOf(error) }),
    }
  } finally {
    clearTimeout(timer)
  }
}
