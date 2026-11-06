import {
  DESKTOP_OPEN_HOST,
  DESKTOP_PREVIEW_CALLBACK_HOST,
  DESKTOP_URL_SCHEME,
} from '@dltech/atlas-wire/web'

function pathOfLink(args: { link: string; host: string }): string | null {
  if (!URL.canParse(args.link)) return null
  const parsed = new URL(args.link)
  if (parsed.protocol !== `${DESKTOP_URL_SCHEME}:` || parsed.host !== args.host) return null
  const path = parsed.pathname === '' ? '/' : parsed.pathname
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null
  return `${path}${parsed.search}`
}

export const inAppPathOf = (link: string): string | null =>
  pathOfLink({ link, host: DESKTOP_OPEN_HOST })

export const previewCallbackPathOf = (link: string): string | null =>
  pathOfLink({ link, host: DESKTOP_PREVIEW_CALLBACK_HOST })

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
