import { toRunId, toThreadId, type Event, type EventId } from '@dltech/atlas-core'
import { acceptsRuntimeCheckpoint } from '@dltech/atlas-harness'
import { runtimeCheckpointSchema, type RuntimeCheckpoint } from '@dltech/atlas-wire'

import { createRuntimeCheckpointCapture, SANDBOX_SESSION_ID_ENV } from '../runtime-checkpoint'
import { createServeLog, type ServeLogLine } from '../serve-log'

export { SANDBOX_SESSION_ID_ENV }

export const threadId = toThreadId('thread-checkpoint')

export const fakeFetch = (
  handler: (input: unknown, init?: RequestInit) => Promise<Response>,
): typeof fetch =>
  Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      handler(input, init),
    { preconnect: () => undefined },
  )

export const saidEvent = (args: { id: string; seq: number; text?: string }): Event => ({
  id: args.id as EventId,
  seq: args.seq,
  threadId,
  runId: toRunId('run-1'),
  depth: 0,
  at: '2026-09-30T00:00:00.000Z',
  type: 'user-said',
  text: args.text ?? 'hello',
})

export const startApi = (args: {
  stored: () => RuntimeCheckpoint | null
  publish: (checkpoint: RuntimeCheckpoint) => void
}): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (url.pathname !== `/v1/sandboxes/${threadId}/checkpoint`) {
        return new Response('not found', { status: 404 })
      }
      if (request.method === 'GET') {
        return Response.json({ checkpoint: args.stored() })
      }
      if (request.method === 'PUT') {
        const reported = runtimeCheckpointSchema.parse(await request.json())
        const stored = args.stored()
        if (acceptsRuntimeCheckpoint({ stored, reported })) {
          args.publish(reported)
          return Response.json({ checkpoint: reported })
        }
        return Response.json({ checkpoint: stored })
      }
      return new Response('method not allowed', { status: 405 })
    },
  })

export const captureFor = (args: {
  home: string
  events?: readonly Event[]
  cloudURL?: string
  env?: Record<string, string | undefined>
  lines?: ServeLogLine[]
  fetchFn?: typeof fetch
  now?: () => number
  transcript?: { read: () => Promise<Event[]> }
}) => {
  const lines = args.lines ?? []
  const transcript = args.transcript ?? {
    read: () => Promise.resolve((args.events ?? []).map((event) => event)),
  }
  return createRuntimeCheckpointCapture({
    threadId,
    atlasHome: args.home,
    env: {
      [SANDBOX_SESSION_ID_ENV]: 'sandbox-session-1',
      ...(args.cloudURL === undefined ? {} : { ATLAS_CLOUD_URL: args.cloudURL }),
      ...args.env,
    },
    token: 'serve-token-1',
    transcript,
    log: createServeLog({ write: (line) => lines.push(JSON.parse(line) as ServeLogLine) }),
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
    ...(args.now === undefined ? {} : { now: args.now }),
  })
}
