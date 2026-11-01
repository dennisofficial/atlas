import { createPodService, type IPodService } from './service'
import { NotAPodThreadError } from './pod-records'
import { createThreadsHandler } from './thread-routes'
import type { IPodHostConfig } from './config'
import { createPodInputSchema, resizePodInputSchema, POD_NOT_RUNNING_CODE } from './wire'

const COLLECTION = '/desktop/pods'
const CAPABILITIES = '/desktop/capabilities'

export type PodsHandler = ((
  request: Request,
  pathname: string,
) => Promise<Response | undefined>) & {
  close: () => Promise<void>
}

const failed = (error: unknown): Response =>
  Response.json(
    { code: 'pod-failed', message: error instanceof Error ? error.message : String(error) },
    { status: 502 },
  )

const notFound = (): Response => Response.json({ code: 'not-found' }, { status: 404 })

export function createPodsHandler({
  config,
  service,
  bearer,
}: {
  config: IPodHostConfig
  service?: IPodService
  bearer: () => string | undefined
}): PodsHandler {
  const pods = service ?? createPodService({ config, bearer })
  const threads = createThreadsHandler({ reads: pods })

  const handle = async (request: Request, pathname: string): Promise<Response | undefined> => {
    const threaded = await threads(request, pathname)
    if (threaded !== undefined) return threaded
    const { method } = request
    if (pathname === CAPABILITIES) {
      return method === 'GET' ? Response.json(await pods.capabilities()) : undefined
    }
    if (pathname === COLLECTION) {
      if (method === 'GET') return Response.json({ pods: await pods.list() })
      if (method !== 'POST') return undefined
      const parsed = createPodInputSchema.safeParse(await request.json().catch(() => undefined))
      if (!parsed.success) return Response.json({ code: 'invalid-input' }, { status: 400 })
      try {
        return Response.json(await pods.create({ input: parsed.data }))
      } catch (error) {
        if (error instanceof NotAPodThreadError) {
          return Response.json(
            { code: 'not-a-pod-thread', message: error.message },
            { status: 409 },
          )
        }
        return failed(error)
      }
    }
    if (!pathname.startsWith(`${COLLECTION}/`)) return undefined
    const [threadId, action, ...rest] = pathname.slice(COLLECTION.length + 1).split('/')
    if (threadId === undefined || threadId.length === 0 || rest.length > 0) return undefined

    try {
      if (action === 'resize' && method === 'POST') {
        const parsed = resizePodInputSchema.safeParse(await request.json().catch(() => undefined))
        if (!parsed.success) return Response.json({ code: 'invalid-input' }, { status: 400 })
        const reply = await pods.resize({ threadId, vcpus: parsed.data.vcpus })
        return reply === undefined ? notFound() : Response.json(reply)
      }
      if (action === 'status' && method === 'GET') {
        const status = await pods.status({ threadId })
        return status === undefined ? notFound() : Response.json(status)
      }
      if (action === undefined && method === 'GET') {
        const pod = await pods.get({ threadId })
        return pod === undefined ? notFound() : Response.json(pod)
      }
      if (action === undefined && method === 'DELETE') {
        return (await pods.destroy({ threadId })) ? new Response(null, { status: 204 }) : notFound()
      }
      if (action === 'wake' && method === 'POST') {
        const pod = await pods.wake({ threadId })
        return pod === undefined ? notFound() : Response.json(pod)
      }
      if (action === 'connect' && method === 'POST') {
        const reply = await pods.connect({ threadId })
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
  return Object.assign(handle, { close: () => pods.close() })
}
