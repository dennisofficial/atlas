import { handoffPage } from './handoff-page'
import { DEFAULT_PREVIEW_DOMAIN, isPreviewHost } from './origins'

export const CALLBACK_LABEL = 'callback'
export const PREVIEW_COOKIE = 'atlas-preview'
export const DESKTOP_TARGET = 'desktop'
export const START_PATH = '/__atlas/start'

export const callbackHostOf = (domain: string): string => `${CALLBACK_LABEL}.${domain}`

export const CALLBACK_HOST = callbackHostOf(DEFAULT_PREVIEW_DOMAIN)

const DESKTOP_CALLBACK_LINK = 'atlas://preview-callback'
const FOUND_STATUS = 302
const TEMPORARY_REDIRECT_STATUS = 307
const BAD_REQUEST_STATUS = 400
const NO_STORE = { 'cache-control': 'no-store' }
const DESKTOP_SIGN_IN_WINDOW_SECONDS = 600
const NO_PREVIEW_MESSAGE =
  'No Atlas preview is waiting for this sign-in in this browser. Open the preview in this browser, then start the sign-in again.'
const DESKTOP_POST_MESSAGE =
  'This provider posts its sign-in result, which cannot be handed back to the Atlas Mac app. Open the preview in this browser and sign in there.'

const invalidStartMessage = (domain: string): string =>
  `This sign-in link does not return to ${callbackHostOf(domain)}.`

export function previewCookie(args: { target: string; domain: string }): string {
  return `${PREVIEW_COOKIE}=${args.target}; Domain=${args.domain}; Path=/; Secure; HttpOnly; SameSite=None`
}

export function framedPreviewCookie(args: { target: string; domain: string }): string {
  return `${previewCookie(args)}; Partitioned`
}

const desktopCookie = (domain: string): string =>
  `${previewCookie({ target: DESKTOP_TARGET, domain })}; Max-Age=${DESKTOP_SIGN_IN_WINDOW_SECONDS}`

const consumedCookie = (domain: string): string =>
  `${previewCookie({ target: '', domain })}; Max-Age=0`

function redirectsToCallback(args: { value: string; domain: string }): boolean {
  if (!URL.canParse(args.value)) return false
  const url = new URL(args.value)
  const redirect = url.searchParams.get('redirect_uri') ?? ''
  return (
    url.protocol === 'https:' &&
    URL.canParse(redirect) &&
    new URL(redirect).hostname === callbackHostOf(args.domain)
  )
}

function targetFromCookies(args: { header: string | null; domain: string }): string | null {
  for (const pair of (args.header ?? '').split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (name !== PREVIEW_COOKIE) continue
    if (value === DESKTOP_TARGET || isPreviewHost(value, args.domain)) return value
  }
  return null
}

function textResponse(message: string): Response {
  return new Response(message, {
    status: BAD_REQUEST_STATUS,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
  })
}

function handleStart(args: { url: URL; domain: string }): Response {
  const { url, domain } = args
  const to = url.searchParams.get('to') ?? ''
  if (!redirectsToCallback({ value: to, domain })) return textResponse(invalidStartMessage(domain))
  return new Response(null, {
    status: FOUND_STATUS,
    headers: { location: to, 'set-cookie': desktopCookie(domain), ...NO_STORE },
  })
}

function handleDesktopCallback(args: { request: Request; url: URL; domain: string }): Response {
  const { request, url, domain } = args
  if (request.method !== 'GET') return textResponse(DESKTOP_POST_MESSAGE)
  return new Response(handoffPage(`${DESKTOP_CALLBACK_LINK}${url.pathname}${url.search}`), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': consumedCookie(domain),
      ...NO_STORE,
    },
  })
}

export function handleCallbackRequest(args: { request: Request; domain: string }): Response {
  const { request, domain } = args
  const url = new URL(request.url)
  if (url.pathname === START_PATH) return handleStart({ url, domain })
  const target = targetFromCookies({ header: request.headers.get('cookie'), domain })
  if (target === null) return textResponse(NO_PREVIEW_MESSAGE)
  if (target === DESKTOP_TARGET) return handleDesktopCallback({ request, url, domain })
  return new Response(null, {
    status: TEMPORARY_REDIRECT_STATUS,
    headers: {
      location: `https://${target}${url.pathname}${url.search}`,
      'set-cookie': consumedCookie(domain),
      ...NO_STORE,
    },
  })
}
