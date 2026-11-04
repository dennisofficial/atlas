import { DESKTOP_OPEN_HOST, DESKTOP_URL_SCHEME } from '@dltech/atlas-wire/web'

export function inAppPathOf(link: string): string | null {
  if (!URL.canParse(link)) return null
  const parsed = new URL(link)
  if (parsed.protocol !== `${DESKTOP_URL_SCHEME}:` || parsed.host !== DESKTOP_OPEN_HOST) return null
  const path = parsed.pathname === '' ? '/' : parsed.pathname
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return `${path}${parsed.search}`
}

export function deepLinkTargetOf(args: {
  link: string
  hostUrl: string
  secret: string
}): string | null {
  const next = inAppPathOf(args.link)
  if (next === null) return null
  const target = new URL('/desktop/session', args.hostUrl)
  target.searchParams.set('secret', args.secret)
  target.searchParams.set('next', next)
  return target.toString()
}

export function openUrlOf(event: unknown): string | null {
  const url = (event as { data?: { url?: unknown } } | null)?.data?.url
  return typeof url === 'string' ? url : null
}
