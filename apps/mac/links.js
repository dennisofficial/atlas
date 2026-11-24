const BROWSER_PROTOCOLS = new Set(['http:', 'https:'])
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

function parsed(value) {
  if (typeof value !== 'string' || value === '') return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

export function externalUrlOf(value) {
  const url = parsed(value)
  return url !== null && EXTERNAL_PROTOCOLS.has(url.protocol) ? url.href : null
}

export function sameOrigin(first, second) {
  const left = parsed(first)
  const right = parsed(second)
  if (left === null || right === null) return false
  return BROWSER_PROTOCOLS.has(left.protocol) && left.origin === right.origin
}

export const PREVIEW_CALLBACK_HOST = 'callback.byatlas.dev'
export const PREVIEW_CALLBACK_START_PATH = '/__atlas/start'

export const ENavigation = Object.freeze({
  Stay: 'stay',
  Browser: 'browser',
})

export function previewCallbackStartOf(value) {
  const url = parsed(value)
  if (url === null || url.protocol !== 'https:') return null
  const redirect = parsed(url.searchParams.get('redirect_uri') ?? '')
  if (redirect === null || redirect.hostname !== PREVIEW_CALLBACK_HOST) return null
  const start = new URL(PREVIEW_CALLBACK_START_PATH, `https://${PREVIEW_CALLBACK_HOST}`)
  start.searchParams.set('to', url.href)
  return start.toString()
}

export const browserUrlOf = (value) => externalUrlOf(previewCallbackStartOf(value) ?? value)

export function windowNavigationOf({ url, pageUrl }) {
  if (sameOrigin(url, pageUrl)) return { kind: ENavigation.Stay }
  return { kind: ENavigation.Browser, url: browserUrlOf(url) }
}

export function paneNavigationOf(url) {
  const start = previewCallbackStartOf(url)
  return start === null ? { kind: ENavigation.Stay } : { kind: ENavigation.Browser, url: start }
}
