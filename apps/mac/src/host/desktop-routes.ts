import type { PodsHandler } from './pods/routes'

export type DesktopRouteHandler = (request: Request) => Response | Promise<Response>

export function createDesktopRouter({
  pods,
}: {
  pods?: PodsHandler | undefined
} = {}): (request: Request, pathname: string) => Response | Promise<Response> {
  const routes = new Map<string, DesktopRouteHandler>()
  routes.set('/desktop/health', () => Response.json({ ok: true }))
  return async (request, pathname) => {
    const handler = routes.get(pathname)
    if (handler) return handler(request)
    const handled = pods === undefined ? undefined : await pods(request, pathname)
    return handled ?? new Response('Not Found', { status: 404 })
  }
}
