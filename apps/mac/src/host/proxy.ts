const HOP_BY_HOP = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]

export function isProxyPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/v1/') ||
    pathname === '/v1'
  )
}

function forwardHeaders(incoming: Headers): Headers {
  const headers = new Headers(incoming)
  for (const name of HOP_BY_HOP) headers.delete(name)
  headers.delete('accept-encoding')
  return headers
}

function responseHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  for (const [name, value] of upstream) {
    if (HOP_BY_HOP.includes(name) || name === 'content-encoding' || name === 'set-cookie') continue
    headers.append(name, value)
  }
  for (const cookie of upstream.getSetCookie()) headers.append('set-cookie', cookie)
  return headers
}

export async function proxyToApi({
  request,
  apiOrigin,
}: {
  request: Request
  apiOrigin: string
}): Promise<Response> {
  const source = new URL(request.url)
  const target = `${apiOrigin.replace(/\/+$/, '')}${source.pathname}${source.search}`
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      body: hasBody ? request.body : null,
      redirect: 'manual',
      signal: request.signal,
    })
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders(upstream.headers),
    })
  } catch {
    return new Response('Bad Gateway', { status: 502 })
  }
}
