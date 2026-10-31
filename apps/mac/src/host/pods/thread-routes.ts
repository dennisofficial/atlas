import type { IThreadReads } from './thread-reads'
import { markReadInputSchema, renameInputSchema, threadEventsQuerySchema } from './wire'

const THREADS = '/desktop/threads'

const notFound = (): Response => Response.json({ code: 'not-found' }, { status: 404 })
const invalid = (): Response => Response.json({ code: 'invalid-input' }, { status: 400 })

const failed = (error: unknown): Response =>
  Response.json(
    { code: 'thread-failed', message: error instanceof Error ? error.message : String(error) },
    { status: 502 },
  )

const bodyOf = (request: Request): Promise<unknown> => request.json().catch(() => undefined)

export function createThreadsHandler({ reads }: { reads: IThreadReads }) {
  return async (request: Request, pathname: string): Promise<Response | undefined> => {
    const { method } = request
    if (pathname === THREADS) {
      if (method !== 'GET') return undefined
      try {
        return Response.json({ threads: await reads.threads() })
      } catch (error) {
        return failed(error)
      }
    }
    if (!pathname.startsWith(`${THREADS}/`)) return undefined
    const [threadId, action, ...rest] = pathname.slice(THREADS.length + 1).split('/')
    if (threadId === undefined || threadId.length === 0 || rest.length > 0) return undefined
    try {
      if (action === 'rename' && method === 'POST') {
        const parsed = renameInputSchema.safeParse(await bodyOf(request))
        if (!parsed.success) return invalid()
        const renamed = await reads.rename({ threadId, title: parsed.data.title })
        return renamed ? new Response(null, { status: 204 }) : notFound()
      }
      if (action === 'events' && method === 'GET') {
        const query = threadEventsQuerySchema.safeParse(
          Object.fromEntries(new URL(request.url).searchParams),
        )
        if (!query.success) return invalid()
        const reply = await reads.events({ threadId, query: query.data })
        return reply === undefined ? notFound() : Response.json(reply)
      }
      if (action === 'read' && method === 'GET') {
        const seq = await reads.readCursor({ threadId })
        return seq === undefined ? notFound() : Response.json({ seq })
      }
      if (action === 'read' && method === 'POST') {
        const parsed = markReadInputSchema.safeParse(await bodyOf(request))
        if (!parsed.success) return invalid()
        const seq = await reads.markRead({ threadId, seq: parsed.data.seq })
        return seq === undefined ? notFound() : Response.json({ seq })
      }
    } catch (error) {
      return failed(error)
    }
    return undefined
  }
}
