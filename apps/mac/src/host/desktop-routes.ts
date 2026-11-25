import type { ApnsRouteHandler } from './apns-routes'
import { APP_INFO_PATH, type IDesktopAppInfo } from './app-info'
import type { AuthHandler } from './auth/routes'
import { createPaneHandler, type IPanePort } from './pane-routes'
import { createUpdateHandler, type IDesktopUpdatesPort } from './update-routes'
import { createWindowHandler, type IDesktopWindowPort } from './window-routes'

export type DesktopRouteHandler = (request: Request) => Response | Promise<Response>

export function createDesktopRouter({
  auth,
  updates,
  window,
  app,
  pane,
  apns,
}: {
  auth?: AuthHandler | undefined
  updates?: IDesktopUpdatesPort | undefined
  window?: IDesktopWindowPort | undefined
  app?: IDesktopAppInfo | undefined
  pane?: IPanePort | undefined
  apns?: ApnsRouteHandler | undefined
} = {}): (request: Request, pathname: string) => Response | Promise<Response> {
  const routes = new Map<string, DesktopRouteHandler>()
  routes.set('/desktop/health', () => Response.json({ ok: true }))
  if (app !== undefined) routes.set(APP_INFO_PATH, () => Response.json(app))
  const updateHandler = updates === undefined ? undefined : createUpdateHandler({ updates })
  const windowHandler = window === undefined ? undefined : createWindowHandler({ window })
  const paneHandler = pane === undefined ? undefined : createPaneHandler({ pane })
  return async (request, pathname) => {
    const handler = routes.get(pathname)
    if (handler) return handler(request)
    const updated = updateHandler?.(request, pathname)
    if (updated) return updated
    const windowed = windowHandler?.(request, pathname)
    if (windowed) return windowed
    const paned = await paneHandler?.(request, pathname)
    if (paned) return paned
    const pushed = await apns?.(request, pathname)
    if (pushed) return pushed
    const signedIn = auth === undefined ? undefined : await auth(request, pathname)
    return signedIn ?? new Response('Not Found', { status: 404 })
  }
}
