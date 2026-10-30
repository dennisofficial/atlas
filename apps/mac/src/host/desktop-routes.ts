import type { AuthHandler } from './auth/routes'
import type { PodsHandler } from './pods/routes'
import { createUpdateHandler, type IDesktopUpdatesPort } from './update-routes'
import { createWindowHandler, type IDesktopWindowPort } from './window-routes'

export type DesktopRouteHandler = (request: Request) => Response | Promise<Response>

export function createDesktopRouter({
  pods,
  auth,
  updates,
  window,
}: {
  pods?: PodsHandler | undefined
  auth?: AuthHandler | undefined
  updates?: IDesktopUpdatesPort | undefined
  window?: IDesktopWindowPort | undefined
} = {}): (request: Request, pathname: string) => Response | Promise<Response> {
  const routes = new Map<string, DesktopRouteHandler>()
  routes.set('/desktop/health', () => Response.json({ ok: true }))
  const updateHandler = updates === undefined ? undefined : createUpdateHandler({ updates })
  const windowHandler = window === undefined ? undefined : createWindowHandler({ window })
  return async (request, pathname) => {
    const handler = routes.get(pathname)
    if (handler) return handler(request)
    const updated = updateHandler?.(request, pathname)
    if (updated) return updated
    const windowed = windowHandler?.(request, pathname)
    if (windowed) return windowed
    const signedIn = auth === undefined ? undefined : await auth(request, pathname)
    if (signedIn) return signedIn
    const handled = pods === undefined ? undefined : await pods(request, pathname)
    return handled ?? new Response('Not Found', { status: 404 })
  }
}
