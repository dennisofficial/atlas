import { z } from 'zod'

export const PANE_PATH = '/desktop/pane'

const RECT = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
})

const URL = z.string().min(1)

export const paneCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('show'), url: URL, rect: RECT }),
  z.object({ kind: z.literal('hide') }),
  z.object({ kind: z.literal('setRect'), rect: RECT }),
  z.object({ kind: z.literal('navigate'), url: URL }),
  z.object({ kind: z.literal('back') }),
  z.object({ kind: z.literal('forward') }),
  z.object({ kind: z.literal('reload') }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('setObscured'), obscured: z.boolean() }),
])

export type PaneCommand = z.infer<typeof paneCommandSchema>

export type PaneReply = { ok: true } | { ok: false; error: string }

export interface IPanePort {
  send: (command: PaneCommand) => Promise<PaneReply>
}

export type PaneHandler = (request: Request, pathname: string) => Promise<Response | undefined>

export function createPaneHandler({ pane }: { pane: IPanePort }): PaneHandler {
  return async (request, pathname) => {
    if (pathname !== PANE_PATH) return undefined
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const body = await request.json().catch(() => null)
    const parsed = paneCommandSchema.safeParse(body)
    if (!parsed.success)
      return Response.json({ ok: false, error: 'invalid command' }, { status: 400 })
    return Response.json(await pane.send(parsed.data))
  }
}
