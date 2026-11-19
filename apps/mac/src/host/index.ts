import type { MacClientFrame } from '@dltech/atlas-protocol/mac-link'

import type { IDesktopAppInfo } from './app-info'
import { resolveApiOrigin, resolveWebOrigin } from './api-origin'
import { CALLBACK_PATH, createAuthService, type IAuthConfig } from './auth/auth-service'
import { callbackResponse } from './auth/callback-page'
import { createAuthHandler } from './auth/routes'
import { createDesktopRouter } from './desktop-routes'
import { isAuthorized, startSession } from './guard'
import { createMacLinkClient, type MacFrameSink } from './mac-link/client'
import { createDeviceId } from './mac-link/device-id'
import type { IPanePort } from './pane-routes'
import { isProxyPath, proxyToApp, proxyToApi } from './proxy'
import type { IPodHostConfig } from './pods/config'
import { defaultDesktopHome } from './pods/config'
import { createPodsHandler } from './pods/routes'
import type { IDesktopUpdatesPort } from './update-routes'
import type { IDesktopWindowPort } from './window-routes'

export { resolveApiOrigin, resolveWebOrigin }

export interface ICreateDesktopHostOptions {
  appOrigin: string | (() => string)
  secret: string
  apiOrigin?: string
  pods?: IPodHostConfig
  auth?: Omit<IAuthConfig, 'home'> & { home?: string }
  updates?: IDesktopUpdatesPort
  window?: IDesktopWindowPort
  app?: IDesktopAppInfo
  previewViews?: { clear: () => void }
  pane?: IPanePort | undefined
  macMcp?: (emit: (frame: MacClientFrame) => void) => MacFrameSink
  port?: number
}

export interface IDesktopHost {
  url: string
  port: number
  stop: () => Promise<void>
}

export function createDesktopHost({
  appOrigin,
  apiOrigin,
  port,
  secret,
  pods,
  auth,
  updates,
  window,
  app,
  previewViews,
  pane,
  macMcp,
}: ICreateDesktopHostOptions): IDesktopHost {
  const origin = apiOrigin ?? resolveApiOrigin(process.env)
  const appOriginOf = typeof appOrigin === 'function' ? appOrigin : () => appOrigin
  const authService = createAuthService({
    config: { ...auth, home: auth?.home ?? defaultDesktopHome() },
    apiOrigin: origin,
    webOrigin: auth?.webOrigin ?? resolveWebOrigin(process.env),
    port: () => server.port as number,
  })
  const bearer = () => authService.token()
  const link = createMacLinkClient({
    apiOrigin: origin,
    token: bearer,
    deviceId: createDeviceId({
      read: () => authService.deviceId(),
      write: (value) => authService.saveDeviceId(value),
    }),
    appVersion: app?.version ?? '0.0.0',
    ...(macMcp === undefined ? {} : { sink: macMcp }),
  })
  const syncLink = (): void => {
    if (authService.status().state === 'signed-in') link.start()
    else link.stop()
  }
  authService.onChange(syncLink)
  syncLink()
  const podsHandler =
    pods === undefined
      ? undefined
      : createPodsHandler({ config: { apiOrigin: origin, ...pods }, bearer })
  const desktopRouter = createDesktopRouter({
    updates,
    window,
    app,
    pane,
    auth: createAuthHandler({ auth: authService }),
    pods: podsHandler,
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
      if (request.method === 'GET' && request.headers.get('sec-fetch-dest') === 'document') {
        previewViews?.clear()
      }
      return proxyToApp({ request, appOrigin: appOriginOf() })
    },
  })

  const boundPort = server.port as number
  return {
    url: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    stop: () => {
      link.stop()
      podsHandler?.close()
      return server.stop(true)
    },
  }
}
