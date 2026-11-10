const KINDS = ['show', 'hide', 'setRect', 'navigate', 'back', 'forward', 'reload', 'stop']

function isRect(value) {
  if (typeof value !== 'object' || value === null) return false
  const { x, y, width, height } = value
  return (
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    Number.isFinite(width) &&
    width >= 0 &&
    Number.isFinite(height) &&
    height >= 0
  )
}

function isUrl(value) {
  return typeof value === 'string' && value.length > 0
}

export function parsePaneCommand(body) {
  if (typeof body !== 'object' || body === null) return null
  const { kind } = body
  if (!KINDS.includes(kind) && kind !== 'setObscured') return null
  switch (kind) {
    case 'show':
      return isUrl(body.url) && isRect(body.rect) ? { kind, url: body.url, rect: body.rect } : null
    case 'setRect':
      return isRect(body.rect) ? { kind, rect: body.rect } : null
    case 'navigate':
      return isUrl(body.url) ? { kind, url: body.url } : null
    case 'setObscured':
      return typeof body.obscured === 'boolean' ? { kind, obscured: body.obscured } : null
    default:
      return { kind }
  }
}
