import { timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'atlas_desktop'

function safeEqual({ a, b }: { a: string; b: string }): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function cookieValue({
  header,
  name,
}: {
  header: string | null
  name: string
}): string | undefined {
  if (header === null) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

export function startSession({ url, secret }: { url: URL; secret: string }): Response {
  const provided = url.searchParams.get('secret')
  if (provided === null || !safeEqual({ a: provided, b: secret })) {
    return new Response('Forbidden', { status: 403 })
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/',
      'Set-Cookie': `${SESSION_COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict`,
    },
  })
}

export function isAuthorized({
  request,
  secret,
  port,
}: {
  request: Request
  secret: string
  port: number
}): boolean {
  if (request.headers.get('host') !== `127.0.0.1:${port}`) return false
  const cookie = cookieValue({ header: request.headers.get('cookie'), name: SESSION_COOKIE })
  return cookie !== undefined && safeEqual({ a: cookie, b: secret })
}
