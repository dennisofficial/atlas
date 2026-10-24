const TRPC_CODES: Record<number, { code: string; number: number }> = {
  400: { code: 'BAD_REQUEST', number: -32600 },
  401: { code: 'UNAUTHORIZED', number: -32001 },
  403: { code: 'FORBIDDEN', number: -32003 },
  404: { code: 'NOT_FOUND', number: -32004 },
  429: { code: 'TOO_MANY_REQUESTS', number: -32029 },
  500: { code: 'INTERNAL_SERVER_ERROR', number: -32603 },
  503: { code: 'SERVICE_UNAVAILABLE', number: -32603 },
}

export const trpcOk = (data: unknown): Response => Response.json({ result: { data } })

export const trpcFailure = (args: { status: number; message?: string }): Response => {
  const mapped = TRPC_CODES[args.status] ?? TRPC_CODES[500]
  return Response.json(
    {
      error: {
        message: args.message ?? 'failed',
        code: mapped?.number ?? -32603,
        data: { code: mapped?.code ?? 'INTERNAL_SERVER_ERROR', httpStatus: args.status },
      },
    },
    { status: args.status },
  )
}

export const procedureOf = (input: unknown): string =>
  new URL(String(input)).pathname.split('/v1/trpc/')[1] ?? ''

export const inputOf = (init: { body?: unknown } | undefined): unknown =>
  typeof init?.body === 'string' ? JSON.parse(init.body) : undefined

export const STREAM_PROCEDURE = 'githubPrs.stream'

export const heartbeatChunk = (): string =>
  `event: connected\ndata: {}\n\ndata: ${JSON.stringify({ type: 'heartbeat' })}\n\n`

export const stateChunk = (state: unknown): string =>
  `data: ${JSON.stringify({ type: 'pr-state', state })}\n\n`

export const eventChunk = (event: unknown): string =>
  `data: ${JSON.stringify({ type: 'pr-event', event })}\n\n`

export const streamResponse = (): Response =>
  new Response(heartbeatChunk(), { headers: { 'content-type': 'text/event-stream' } })

export const openStreamResponse = (args: {
  request: Request
  onAbort?: () => void
  register?: (controller: ReadableStreamDefaultController<Uint8Array>) => void
}): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        args.register?.(controller)
        controller.enqueue(new TextEncoder().encode(heartbeatChunk()))
        args.request.signal.addEventListener(
          'abort',
          () => {
            args.onAbort?.()
            controller.close()
          },
          { once: true },
        )
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  )
