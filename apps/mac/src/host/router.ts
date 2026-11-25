import { CALLBACK_PATH, type IAuthService } from './auth/auth-service'
import { callbackResponse } from './auth/callback-page'
import { isAuthorized, startSession } from './guard'
import { isProxyPath, proxyToApi, proxyToApp } from './proxy'

export type DesktopHandler = (request: Request, pathname: string) => Response | Promise<Response>

export type HostHandler = (args: { request: Request; selfHost: string }) => Promise<Response>

export function createHostHandler({
  auth,
  desktop,
  apiOrigin,
  secret,
  bearer,
  appOrigin,
  previewViews,
}: {
  auth: IAuthService
  desktop: DesktopHandler
  apiOrigin: string
  secret: string
  bearer: () => string | undefined
  appOrigin: () => string
  previewViews?: { clear: () => void } | undefined
}): HostHandler {
  return async function handle({ request, selfHost }) {
    const url = new URL(request.url)
    const { pathname } = url
    if (pathname === CALLBACK_PATH && request.method === 'GET') {
      if (request.headers.get('host') !== selfHost)
        return new Response('Forbidden', { status: 403 })
      return callbackResponse(await auth.callback(url))
    }
    if (pathname === '/desktop/session') return startSession({ url, secret })
    if (pathname === '/desktop' || pathname.startsWith('/desktop/')) {
      if (!isAuthorized({ request, secret, selfHost }))
        return new Response('Forbidden', { status: 403 })
      return desktop(request, pathname)
    }
    if (isProxyPath(pathname))
      return proxyToApi({
        request,
        apiOrigin,
        bearer,
        onSignIn: auth.adopt,
      })
    if (request.method === 'GET' && request.headers.get('sec-fetch-dest') === 'document')
      previewViews?.clear()
    return proxyToApp({ request, appOrigin: appOrigin() })
  }
}
