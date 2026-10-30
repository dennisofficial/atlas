import { z } from 'zod'

export interface IDesktopWindowPort {
  titlebarDoubleClick: () => void
  setPreviewOrigins: (origins: string[]) => void
}

export const TITLEBAR_DOUBLE_CLICK_PATH = '/desktop/window/titlebar-double-click'
export const PREVIEW_ORIGINS_PATH = '/desktop/window/preview-origins'

const MAX_PREVIEW_ORIGINS = 32

const previewOriginsSchema = z.object({
  origins: z.array(z.url({ protocol: /^https?$/ })).max(MAX_PREVIEW_ORIGINS),
})

const methodNotAllowed = () => new Response('Method Not Allowed', { status: 405 })

async function readPreviewOrigins(request: Request): Promise<string[] | undefined> {
  const body: unknown = await request.json().catch(() => undefined)
  const parsed = previewOriginsSchema.safeParse(body)
  if (!parsed.success) return undefined
  return [...new Set(parsed.data.origins.map((url) => new URL(url).origin))]
}

async function handlePreviewOrigins({
  request,
  window,
}: {
  request: Request
  window: IDesktopWindowPort
}): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const origins = await readPreviewOrigins(request)
  if (origins === undefined) return new Response('Bad Request', { status: 400 })
  window.setPreviewOrigins(origins)
  return new Response(null, { status: 204 })
}

export function createWindowHandler({
  window,
}: {
  window: IDesktopWindowPort
}): (request: Request, pathname: string) => Response | Promise<Response> | undefined {
  return (request, pathname) => {
    if (pathname === PREVIEW_ORIGINS_PATH) return handlePreviewOrigins({ request, window })
    if (pathname !== TITLEBAR_DOUBLE_CLICK_PATH) return undefined
    if (request.method !== 'POST') return methodNotAllowed()
    window.titlebarDoubleClick()
    return new Response(null, { status: 204 })
  }
}
