import { createPodService, type IPodService } from './service'
import type { IPodHostConfig } from './config'
import { createPodInputSchema, POD_NOT_RUNNING_CODE } from './wire'

const COLLECTION = '/desktop/pods'
const CAPABILITIES = '/desktop/capabilities'

export type PodsHandler = (request: Request, pathname: string) => Promise<Response | undefined>

const failed = (error: unknown): Response =>
  Response.json(
    { code: 'pod-failed', message: error instanceof Error ? error.message : String(error) },
    { status: 502 },
  )

const notFound = (): Response => Response.json({ code: 'not-found' }, { status: 404 })

export function createPodsHandler({
  config,
  service,
}: {
  config: IPodHostConfig
  service?: IPodService
}): PodsHandler {
  const pods = service ?? createPodService({ config })

  return async (request, pathname) => {
    const cookie = request.headers.get('cookie')
    const { method } = request
    if (pathname === CAPABILITIES) {
      return method === 'GET' ? Response.json(await pods.capabilities()) : undefined
    }
    if (pathname === COLLECTION) {
      if (method === 'GET') return Response.json({ pods: await pods.list({ cookie }) })
      if (method !== 'POST') return undefined
      const parsed = createPodInputSchema.safeParse(await request.json().catch(() => undefined))
      if (!parsed.success) return Response.json({ code: 'invalid-input' }, { status: 400 })
      try {
        return Response.json(await pods.create({ input: parsed.data, cookie }))
      } catch (error) {
        return failed(error)
      }
    }
    if (!pathname.startsWith(`${COLLECTION}/`)) return undefined
    const [threadId, action, ...rest] = pathname.slice(COLLECTION.length + 1).split('/')
    if (threadId === undefined || threadId.length === 0 || rest.length > 0) return undefined

    try {
      if (action === undefined && method === 'GET') {
        const pod = await pods.get({ threadId, cookie })
        return pod === undefined ? notFound() : Response.json(pod)
      }
      if (action === undefined && method === 'DELETE') {
        await pods.destroy({ threadId, cookie })
        return new Response(null, { status: 204 })
      }
      if (action === 'wake' && method === 'POST') {
        const pod = await pods.wake({ threadId, cookie })
        return pod === undefined ? notFound() : Response.json(pod)
      }
      if (action === 'connect' && method === 'POST') {
        const reply = await pods.connect({ threadId, cookie })
        if (reply === undefined) return notFound()
        if (reply === 'not-running') {
          return Response.json({ code: POD_NOT_RUNNING_CODE }, { status: 409 })
        }
        return Response.json(reply)
      }
    } catch (error) {
      return failed(error)
    }
    return undefined
  }
}
