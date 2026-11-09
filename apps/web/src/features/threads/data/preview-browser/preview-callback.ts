import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'
import { PREVIEW_CALLBACK_HOST, PREVIEW_CALLBACK_START_PATH } from '@dltech/atlas-wire/web'

import { previewPortForUrl } from '../preview-ports'
import { activeTabOf, currentUrlOf, openTab, type BrowserState } from './browser-model'
import { parseWebUrl } from './web-url'

export function previewOriginFor(args: {
  currentUrl: string
  ports: PreviewPort[]
}): string | null {
  const port =
    previewPortForUrl({ url: args.currentUrl, ports: args.ports }) ??
    args.ports.find((candidate) => candidate.status === EPreviewStatus.Live)
  return port === undefined ? null : (parseWebUrl(port.url)?.origin ?? null)
}

export function previewCallbackUrlOf(args: {
  url: string
  currentUrl: string
  ports: PreviewPort[]
}): string | null {
  const { url, currentUrl, ports } = args
  const parsed = parseWebUrl(url)
  if (parsed === null || parsed.hostname !== PREVIEW_CALLBACK_HOST) return null
  if (parsed.pathname === PREVIEW_CALLBACK_START_PATH) return null
  const origin = previewOriginFor({ currentUrl, ports })
  if (origin === null) return null
  return `${origin}${parsed.pathname}${parsed.search}${parsed.hash}`
}

export function openPreviewCallback(args: {
  state: BrowserState
  tabId: string
  path: string
}): BrowserState {
  const { state, tabId, path } = args
  const tab = state.tabs.find((candidate) => candidate.id === tabId) ?? activeTabOf(state)
  const origin = tab === undefined ? undefined : parseWebUrl(currentUrlOf(tab))?.origin
  if (origin === undefined) return state
  return openTab({ state, url: `${origin}${path}` })
}
