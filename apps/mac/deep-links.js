import { HOST_SESSION_PATH, urlForSession } from './apns.js'

export const DESKTOP_URL_SCHEME = 'atlas'
export const DESKTOP_OPEN_HOST = 'open'
export const DESKTOP_FOCUS_HOST = 'focus'
export const DESKTOP_PREVIEW_CALLBACK_HOST = 'preview-callback'
export const DESKTOP_NAVIGATE_EVENT = 'atlas-desktop:navigate'
export const DESKTOP_PREVIEW_CALLBACK_EVENT = 'atlas-desktop:preview-callback'

export const EDeepLinkKind = Object.freeze({
  Open: 'open',
  PreviewCallback: 'preview-callback',
  Focus: 'focus',
})

export const EDeepLinkPlan = Object.freeze({
  Defer: 'defer',
  Dispatch: 'dispatch',
  Navigate: 'navigate',
  Focus: 'focus',
})

const PAGE_PROTOCOLS = new Set(['http:', 'https:'])

const KIND_OF_HOST = new Map([
  ['', EDeepLinkKind.Open],
  [DESKTOP_OPEN_HOST, EDeepLinkKind.Open],
  [DESKTOP_PREVIEW_CALLBACK_HOST, EDeepLinkKind.PreviewCallback],
])

const EVENT_OF_KIND = new Map([
  [EDeepLinkKind.Open, DESKTOP_NAVIGATE_EVENT],
  [EDeepLinkKind.PreviewCallback, DESKTOP_PREVIEW_CALLBACK_EVENT],
])

const isInAppPath = (path) => path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')

const parsed = (value) => {
  if (typeof value !== 'string' || value === '') return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const pageOriginOf = (pageUrl) => {
  const url = parsed(pageUrl)
  return url !== null && PAGE_PROTOCOLS.has(url.protocol) ? url.origin : undefined
}

export function deepLinkOf(value) {
  const url = parsed(value)
  if (url === null || url.protocol !== `${DESKTOP_URL_SCHEME}:`) return null
  if (url.host === DESKTOP_FOCUS_HOST) return { kind: EDeepLinkKind.Focus }
  const kind = KIND_OF_HOST.get(url.host)
  if (kind === undefined) return null
  const path = url.pathname === '' ? '/' : url.pathname
  if (!isInAppPath(path)) return null
  return { kind, path: `${path}${url.search}` }
}

export const landingPathOf = (link) => (link?.kind === EDeepLinkKind.Open ? link.path : undefined)

export function landingUrlOf({ pageUrl, sessionId, path }) {
  if (path === undefined) return urlForSession(pageUrl, sessionId)
  const url = new URL(pageUrl)
  if (url.pathname !== HOST_SESSION_PATH) return `${url.origin}${path}`
  url.searchParams.set('next', path)
  return url.href
}

const dispatchScriptOf = ({ event, path }) =>
  `window.dispatchEvent(new CustomEvent(${JSON.stringify(event)}, { detail: ${JSON.stringify(path)} }))`

export function livePlanOf({ link, pageUrl, loading }) {
  if (loading || pageOriginOf(pageUrl) === undefined) return { kind: EDeepLinkPlan.Defer }
  const event = EVENT_OF_KIND.get(link.kind)
  if (event === undefined) return { kind: EDeepLinkPlan.Focus }
  return { kind: EDeepLinkPlan.Dispatch, script: dispatchScriptOf({ event, path: link.path }) }
}

export function loadedPlanOf({ link, pageUrl }) {
  const origin = pageOriginOf(pageUrl)
  if (origin === undefined || link.kind !== EDeepLinkKind.Open) return { kind: EDeepLinkPlan.Focus }
  const target = `${origin}${link.path}`
  return target === pageUrl
    ? { kind: EDeepLinkPlan.Focus }
    : { kind: EDeepLinkPlan.Navigate, url: target }
}

export function createDeepLinkOpener({ windowNow, createWindow, reveal, log = () => {} }) {
  const apply = (win, plan) => {
    if (plan.kind === EDeepLinkPlan.Navigate) void win.loadURL(plan.url)
    if (plan.kind !== EDeepLinkPlan.Dispatch) return
    win.webContents.executeJavaScript(plan.script).catch((error) => {
      log(`[deep-link] could not hand the link to the page: ${error}`)
    })
  }

  return (value) => {
    const link = deepLinkOf(value)
    if (link === null) return false
    const win = windowNow()
    if (win === undefined) {
      void createWindow({ path: landingPathOf(link) })
      return true
    }
    reveal(win)
    const { webContents } = win
    const plan = livePlanOf({
      link,
      pageUrl: webContents.getURL(),
      loading: webContents.isLoading(),
    })
    if (plan.kind !== EDeepLinkPlan.Defer) {
      apply(win, plan)
      return true
    }
    webContents.once('did-finish-load', () => {
      if (!win.isDestroyed()) apply(win, loadedPlanOf({ link, pageUrl: webContents.getURL() }))
    })
    return true
  }
}

export function launchPlanOf(values) {
  const links = values.map((value) => ({ value, link: deepLinkOf(value) }))
  const landing = links.find(({ link }) => link?.kind === EDeepLinkKind.Open)
  return {
    path: landingPathOf(landing?.link),
    replay: links
      .filter((entry) => entry !== landing && entry.link !== null)
      .map(({ value }) => value),
  }
}

export function protocolClientArgsOf({ defaultApp, execPath, entry }) {
  if (!defaultApp) return [DESKTOP_URL_SCHEME]
  if (entry === undefined) return null
  return [DESKTOP_URL_SCHEME, execPath, [entry]]
}
