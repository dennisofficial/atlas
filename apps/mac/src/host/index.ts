import { createApiClient } from '@dltech/atlas-api-router'
import { ENotifyDeviceKind } from '@dltech/atlas-notifications'
import type { MacClientFrame } from '@dltech/atlas-protocol/mac-link'

import type { IDesktopAppInfo } from './app-info'
import { resolveApiOrigin, resolveWebOrigin } from './api-origin'
import { createApnsRoutes } from './apns-routes'
import { createAuthService, type IAuthConfig } from './auth/auth-service'
import { createAuthHandler } from './auth/routes'
import { createDesktopRouter } from './desktop-routes'
import { createMacLinkClient, type MacFrameSink } from './mac-link/client'
import { createDeviceId } from './mac-link/device-id'
import type { IPanePort } from './pane-routes'
import { defaultDesktopHome } from './desktop-home'
import { createHostHandler } from './router'
import { HOST_TLS_PORT_FILE, startOnStablePort, startOnStablePortAsync } from './stable-port'
import { serveHttp2 } from './http2-server'
import { createSelfSignedCert } from './tls/self-signed'
import type { IDesktopUpdatesPort } from './update-routes'
import type { IDesktopWindowPort } from './window-routes'

export { resolveApiOrigin, resolveWebOrigin }

export interface ICreateDesktopHostOptions {
  appOrigin: string | (() => string)
  secret: string
  apiOrigin?: string
  auth?: Omit<IAuthConfig, 'home'> & { home?: string }
  updates?: IDesktopUpdatesPort | undefined
  window?: IDesktopWindowPort
  app?: IDesktopAppInfo
  previewViews?: { clear: () => void }
  pane?: IPanePort | undefined
  macMcp?: (emit: (frame: MacClientFrame) => void) => MacFrameSink
  port?: number
  stablePortHome?: string
}

export interface IDesktopHost {
  url: string
  secureUrl: string
  port: number
  securePort: number
  certFingerprint: string
  stop: () => Promise<void>
}

export async function createDesktopHost({
  appOrigin,
  apiOrigin,
  port,
  stablePortHome,
  secret,
  auth,
  updates,
  window,
  app,
  previewViews,
  pane,
  macMcp,
}: ICreateDesktopHostOptions): Promise<IDesktopHost> {
  const origin = apiOrigin ?? resolveApiOrigin(process.env)
  const appOriginOf = typeof appOrigin === 'function' ? appOrigin : () => appOrigin
  let boundPort = 0
  let selfHost = ''
  const authService = createAuthService({
    config: { ...auth, home: auth?.home ?? defaultDesktopHome() },
    apiOrigin: origin,
    webOrigin: auth?.webOrigin ?? resolveWebOrigin(process.env),
    port: () => boundPort,
  })
  const bearer = () => authService.token()
  const deviceId = createDeviceId({
    read: () => authService.deviceId(),
    write: (value) => authService.saveDeviceId(value),
  })
  const link = createMacLinkClient({
    apiOrigin: origin,
    token: bearer,
    deviceId,
    appVersion: () => app?.version ?? '0.0.0',
    ...(macMcp === undefined ? {} : { sink: macMcp }),
  })
  const apns = createApnsRoutes({
    signedIn: () => authService.status().state === 'signed-in',
    track: async (input) => {
      const authToken = authService.token()
      if (authToken === undefined) return
      await createApiClient({ baseUrl: origin, token: authToken }).notifications.track.mutate(input)
    },
    register: async ({ token }) => {
      const authToken = authService.token()
      if (authToken === undefined) return
      await createApiClient({
        baseUrl: origin,
        token: authToken,
      }).notifications.registerDevice.mutate({
        kind: ENotifyDeviceKind.ApnsMac,
        clientId: deviceId(),
        token,
        secret: null,
        label: 'Mac',
      })
    },
  })
  const syncLink = (): void => {
    if (authService.status().state === 'signed-in') link.start()
    else link.stop()
    void apns.sync()
  }
  authService.onChange(syncLink)
  syncLink()
  const desktopRouter = createDesktopRouter({
    updates,
    window,
    app,
    pane,
    auth: createAuthHandler({ auth: authService }),
    apns: apns.handler,
  })

  const handle = createHostHandler({
    auth: authService,
    desktop: desktopRouter,
    apiOrigin: origin,
    secret,
    bearer,
    appOrigin: appOriginOf,
    previewViews,
  })
  const serveOn = (bindPort: number) => {
    const started = Bun.serve({
      hostname: '127.0.0.1',
      port: bindPort,
      idleTimeout: 0,
      fetch: (request: Request): Promise<Response> => handle({ request, selfHost }),
    })
    boundPort = started.port as number
    selfHost = `127.0.0.1:${boundPort}`
    return started
  }
  const server =
    stablePortHome === undefined
      ? serveOn(port ?? 0)
      : startOnStablePort({ home: stablePortHome, start: serveOn })

  const tls = createSelfSignedCert({ now: Date.now() })
  let secureSelfHost = ''
  const serveSecure = (bindPort: number) =>
    serveHttp2({
      hostname: '127.0.0.1',
      port: bindPort,
      tls: { cert: tls.certPem, key: tls.keyPem },
      fetch: (request: Request) => handle({ request, selfHost: secureSelfHost }),
    })
  const secure =
    stablePortHome === undefined
      ? await serveSecure(0)
      : await startOnStablePortAsync({
          home: stablePortHome,
          file: HOST_TLS_PORT_FILE,
          start: serveSecure,
        })
  secureSelfHost = `127.0.0.1:${secure.port}`

  return {
    url: `http://${selfHost}`,
    secureUrl: `https://${secureSelfHost}`,
    port: boundPort,
    securePort: secure.port,
    certFingerprint: tls.fingerprint,
    stop: async () => {
      link.stop()
      await Promise.all([server.stop(true), secure.stop()])
    },
  }
}
