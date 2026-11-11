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
