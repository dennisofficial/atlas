import { handoffPage } from './handoff-page'
import { isPreviewHost } from './origins'

export const CALLBACK_HOST = 'callback.byatlas.dev'
export const PREVIEW_COOKIE = 'atlas-preview'
export const DESKTOP_TARGET = 'desktop'
export const START_PATH = '/__atlas/start'

const DESKTOP_CALLBACK_LINK = 'atlas://preview-callback'
const PREVIEW_COOKIE_DOMAIN = 'byatlas.dev'
const FOUND_STATUS = 302
const TEMPORARY_REDIRECT_STATUS = 307
const BAD_REQUEST_STATUS = 400
const NO_STORE = { 'cache-control': 'no-store' }
const DESKTOP_SIGN_IN_WINDOW_SECONDS = 600
const NO_PREVIEW_MESSAGE =
  'No Atlas preview is waiting for this sign-in in this browser. Open the preview in this browser, then start the sign-in again.'
const INVALID_START_MESSAGE = `This sign-in link does not return to ${CALLBACK_HOST}.`
const DESKTOP_POST_MESSAGE =
  'This provider posts its sign-in result, which cannot be handed back to the Atlas Mac app. Open the preview in this browser and sign in there.'

export function previewCookie(target: string): string {
  return `${PREVIEW_COOKIE}=${target}; Domain=${PREVIEW_COOKIE_DOMAIN}; Path=/; Secure; HttpOnly; SameSite=None`
}

const desktopCookie = (): string =>
  `${previewCookie(DESKTOP_TARGET)}; Max-Age=${DESKTOP_SIGN_IN_WINDOW_SECONDS}`

const consumedCookie = (): string => `${previewCookie('')}; Max-Age=0`

function redirectsToCallback(value: string): boolean {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  const redirect = url.searchParams.get('redirect_uri') ?? ''
  return (
    url.protocol === 'https:' &&
    URL.canParse(redirect) &&
    new URL(redirect).hostname === CALLBACK_HOST
  )
}

function targetFromCookies(header: string | null): string | null {
  for (const pair of (header ?? '').split(';')) {
    const separator = pair.indexOf('=')
    if (separator === -1) continue
    const name = pair.slice(0, separator).trim()
    const value = pair.slice(separator + 1).trim()
    if (name !== PREVIEW_COOKIE) continue
    if (value === DESKTOP_TARGET || isPreviewHost(value)) return value
  }
  return null
}

function textResponse(message: string): Response {
  return new Response(message, {
    status: BAD_REQUEST_STATUS,
    headers: { 'content-type': 'text/plain; charset=utf-8', ...NO_STORE },
  })
}

function handleStart(url: URL): Response {
  const to = url.searchParams.get('to') ?? ''
  if (!redirectsToCallback(to)) return textResponse(INVALID_START_MESSAGE)
  return new Response(null, {
    status: FOUND_STATUS,
    headers: { location: to, 'set-cookie': desktopCookie(), ...NO_STORE },
  })
}

function handleDesktopCallback(args: { request: Request; url: URL }): Response {
  const { request, url } = args
  if (request.method !== 'GET') return textResponse(DESKTOP_POST_MESSAGE)
  return new Response(handoffPage(`${DESKTOP_CALLBACK_LINK}${url.pathname}${url.search}`), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'set-cookie': consumedCookie(),
      ...NO_STORE,
    },
  })
}

export function handleCallbackRequest(request: Request): Response {
  const url = new URL(request.url)
  if (url.pathname === START_PATH) return handleStart(url)
  const target = targetFromCookies(request.headers.get('cookie'))
  if (target === null) return textResponse(NO_PREVIEW_MESSAGE)
  if (target === DESKTOP_TARGET) return handleDesktopCallback({ request, url })
  return new Response(null, {
    status: TEMPORARY_REDIRECT_STATUS,
    headers: {
      location: `https://${target}${url.pathname}${url.search}`,
      'set-cookie': consumedCookie(),
      ...NO_STORE,
    },
  })
}
