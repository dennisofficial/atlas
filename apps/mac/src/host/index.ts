import { resolveApiOrigin } from './api-origin'
import { createAuthService, type IAuthConfig } from './auth/auth-service'
import { createAuthHandler } from './auth/routes'
import { createDesktopRouter } from './desktop-routes'
import { isAuthorized, startSession } from './guard'
import { isProxyPath, proxyToApi } from './proxy'
import type { IPodHostConfig } from './pods/config'
import { createPodsHandler } from './pods/routes'
import { serveStatic } from './static'

export { resolveApiOrigin }

export interface ICreateDesktopHostOptions {
  webRoot: string
  secret: string
  apiOrigin?: string
  pods?: IPodHostConfig
  auth?: Omit<IAuthConfig, 'home'> & { home?: string }
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
}: ICreateDesktopHostOptions): IDesktopHost {
  const origin = apiOrigin ?? resolveApiOrigin(process.env)
  const authService = createAuthService({
    config: { ...auth, home: auth?.home ?? pods?.home ?? '' },
    apiOrigin: origin,
  })
  const bearer = () => authService.token()
  const desktopRouter = createDesktopRouter({
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
      if (pathname === '/desktop/session') return startSession({ url, secret })
      if (pathname === '/desktop' || pathname.startsWith('/desktop/')) {
        if (!isAuthorized({ request, secret, port: server.port as number })) {
          return new Response('Forbidden', { status: 403 })
        }
        return desktopRouter(request, pathname)
      }
      if (isProxyPath(pathname)) return proxyToApi({ request, apiOrigin: origin, bearer })
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
