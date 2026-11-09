import type { PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

import { parseWebUrl } from './preview-browser/web-url'
import { previewPortForUrl } from './preview-ports'

export type LinkClickModifiers = {
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

export enum ELinkClickTarget {
  Preview = 'preview',
  Browser = 'browser',
}

export type LinkRoute = { target: ELinkClickTarget; url: string }

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0'])

const modified = (click: LinkClickModifiers): boolean =>
  click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey

export function previewUrlOfLoopback(args: { url: URL; ports: PreviewPort[] }): string | null {
  const { url, ports } = args
  if (!LOOPBACK_HOSTS.has(url.hostname)) return null
  const port = ports.find((candidate) => String(candidate.port) === url.port)
  const origin = port === undefined ? undefined : parseWebUrl(port.url)?.origin
  if (origin === undefined) return null
  return `${origin}${url.pathname}${url.search}${url.hash}`
}

export function previewLinkRouteOf(args: {
  href: string
  ports: PreviewPort[]
  click: LinkClickModifiers
}): LinkRoute | null {
  const { href, ports, click } = args
  const url = parseWebUrl(href)
  if (url === null) return null
  const loopback = previewUrlOfLoopback({ url, ports })
  if (loopback !== null) {
    const target = modified(click) ? ELinkClickTarget.Browser : ELinkClickTarget.Preview
    return { target, url: loopback }
  }
  if (previewPortForUrl({ url: href, ports }) !== null) {
    return modified(click) ? null : { target: ELinkClickTarget.Preview, url: href }
  }
  return modified(click) ? null : { target: ELinkClickTarget.Preview, url: url.toString() }
}
