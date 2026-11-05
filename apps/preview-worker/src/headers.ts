import { editCsp } from './csp'
import { rewriteSetCookie } from './cookies'

export function rewriteResponseHeaders(args: {
  headers: Headers
  scriptHash: string | null
  dropContentLength: boolean
}): Headers {
  const { headers, scriptHash, dropContentLength } = args
  const cookies = headers.getSetCookie()
  const next = new Headers(headers)
  next.delete('x-frame-options')
  next.delete('set-cookie')
  for (const cookie of cookies) next.append('set-cookie', rewriteSetCookie(cookie))
  const csp = headers.get('content-security-policy')
  if (csp !== null) {
    const edited = editCsp({ header: csp, scriptHash })
    if (edited === null) next.delete('content-security-policy')
    else next.set('content-security-policy', edited)
  }
  if (dropContentLength) next.delete('content-length')
  return next
}
