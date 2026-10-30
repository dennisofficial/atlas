import type { IDesktopAppInfo } from './app-info'
import { resolveApiOrigin, resolveWebOrigin } from './api-origin'
import { CALLBACK_PATH, createAuthService, type IAuthConfig } from './auth/auth-service'
import { callbackResponse } from './auth/callback-page'
import { createAuthHandler } from './auth/routes'
import { createDesktopRouter } from './desktop-routes'
import { isAuthorized, startSession } from './guard'
import { isProxyPath, proxyToApi } from './proxy'
import type { IPodHostConfig } from './pods/config'
import { createPodsHandler } from './pods/routes'
import { serveStatic } from './static'
import type { IDesktopUpdatesPort } from './update-routes'
import type { IDesktopWindowPort } from './window-routes'

export { resolveApiOrigin, resolveWebOrigin }

export interface ICreateDesktopHostOptions {
  webRoot: string
  secret: string
  apiOrigin?: string
  pods?: IPodHostConfig
  auth?: Omit<IAuthConfig, 'home'> & { home?: string }
  updates?: IDesktopUpdatesPort
  window?: IDesktopWindowPort
  app?: IDesktopAppInfo
  port?: number
}

export interface IDesktopHost {
  url: string
  port: number
  stop: () => Promise<void>
}

export function createDesktopHost({
  webRoot,
  apiOrigin,
  port,
  secret,
  pods,
  auth,
  updates,
  window,
  app,
}: ICreateDesktopHostOptions): IDesktopHost {
  const origin = apiOrigin ?? resolveApiOrigin(process.env)
  const authService = createAuthService({
    config: { ...auth, home: auth?.home ?? pods?.home ?? '' },
    apiOrigin: origin,
    webOrigin: auth?.webOrigin ?? resolveWebOrigin(process.env),
    port: () => server.port as number,
  })
  const bearer = () => authService.token()
  const desktopRouter = createDesktopRouter({
    updates,
    window,
    app,
    auth: createAuthHandler({ auth: authService }),
    pods:
      pods === undefined
        ? undefined
        : createPodsHandler({ config: { apiOrigin: origin, ...pods }, bearer }),
  })

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: port ?? 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const { pathname } = url
      if (pathname === CALLBACK_PATH && request.method === 'GET') {
        if (request.headers.get('host') !== `127.0.0.1:${server.port}`) {
          return new Response('Forbidden', { status: 403 })
        }
        return callbackResponse(await authService.callback(url))
      }
      if (pathname === '/desktop/session') return startSession({ url, secret })
      if (pathname === '/desktop' || pathname.startsWith('/desktop/')) {
        if (!isAuthorized({ request, secret, port: server.port as number })) {
          return new Response('Forbidden', { status: 403 })
        }
        return desktopRouter(request, pathname)
      }
      if (isProxyPath(pathname))
        return proxyToApi({
          request,
          apiOrigin: origin,
          bearer,
          onSignIn: authService.adopt,
        })
      return serveStatic({ webRoot, pathname })
    },
  })

  const boundPort = server.port as number
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    stop: () => server.stop(true),
  }
}
