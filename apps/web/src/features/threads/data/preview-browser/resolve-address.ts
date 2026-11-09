import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { previewPortForUrl } from '../preview-ports'
import { previewCallbackUrlOf, previewOriginFor } from './preview-callback'
import { parseWebUrl } from './web-url'

const PORT_ONLY = /^:?(\d{2,5})(\/\S*)?$/
const LOCALHOST = /^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(\/\S*)?$/
const DIGITS_ONLY = /^:?\d+$/
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i
const MAX_PORT = 65535

type ResolveArgs = {
  input: string
  currentUrl: string
  ports: PreviewPort[]
  allowExternal: boolean
}

function resolvePath(args: {
  path: string
  currentUrl: string
  ports: PreviewPort[]
}): string | null {
  const { path, currentUrl, ports } = args
  const origin = previewOriginFor({ currentUrl, ports })
  if (origin === null) return null
  return parseWebUrl(`${origin}${path}`)?.toString() ?? null
}

function resolveLocal(args: {
  match: RegExpExecArray
  ports: PreviewPort[]
  allowExternal: boolean
}): string | null {
  const { match, ports, allowExternal } = args
  const number = Number(match[1])
  if (number < 1 || number > MAX_PORT) return null
  const path = match[2] ?? '/'
  const preview = ports.find((candidate) => candidate.port === number)
  if (preview === undefined) return allowExternal ? `http://localhost:${number}${path}` : null
  const origin = parseWebUrl(preview.url)?.origin
  return origin === undefined ? null : `${origin}${path}`
}

function resolveWeb(args: {
  text: string
  currentUrl: string
  ports: PreviewPort[]
  allowExternal: boolean
}): string | null {
  const { text, currentUrl, ports, allowExternal } = args
  const url = parseWebUrl(HAS_SCHEME.test(text) ? text : `https://${text}`)
  if (url === null) return null
  const callback = previewCallbackUrlOf({ url: url.toString(), currentUrl, ports })
  if (callback !== null) return callback
  const resolved = url.toString()
  if (allowExternal) return resolved
  return previewPortForUrl({ url: resolved, ports }) === null ? null : resolved
}

export function resolveAddress(args: ResolveArgs): string | null {
  const { currentUrl, ports, allowExternal } = args
  const text = args.input.trim()
  if (text === '' || /\s/.test(text)) return null
  if (text.startsWith('//')) return null
  if (text.startsWith('/')) return resolvePath({ path: text, currentUrl, ports })
  const local = PORT_ONLY.exec(text) ?? LOCALHOST.exec(text)
  if (local !== null) return resolveLocal({ match: local, ports, allowExternal })
  if (DIGITS_ONLY.test(text)) return null
  return resolveWeb({ text, currentUrl, ports, allowExternal })
}
