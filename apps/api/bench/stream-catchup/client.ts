import { streamServerMessageSchema } from '@dltech/atlas-protocol'
import { createTRPCClient, httpSubscriptionLink } from '@trpc/client'
import {
  createStreamConnection,
  ESessionConnection,
  EStreamConnectionState,
  memorySessionLog,
  systemStreamScheduler,
  type StreamTransport,
} from '@dltech/atlas-client/stream'
import { EventSource } from 'eventsource'

import type { BenchRouter } from './server'

const POLL_MS = 100

type SubscriptionEventSource = NonNullable<
  Parameters<typeof httpSubscriptionLink>[0]['EventSource']
>

const EVENT_SOURCE: SubscriptionEventSource = EventSource

export type RunOutcome = {
  firstEventsMs: number | null
  liveMs: number | null
  timedOut: boolean
  frames: number
  eventsFrames: number
  leftOpen: boolean
  phases: string
}

export const runCatchUp = async (args: {
  url: string
  sessionId: string
  startSeq: number | undefined
  timeoutMs: number
}): Promise<RunOutcome> => {
  const client = createTRPCClient<BenchRouter>({
    links: [httpSubscriptionLink({ url: `${args.url}/v1/trpc`, EventSource: EVENT_SOURCE })],
  })
  const started = performance.now()
  let firstEventsMs: number | null = null
  let frames = 0
  let eventsFrames = 0
  let following = 0

  const transport: StreamTransport = {
    follow: (input, handlers) => {
      following += 1
      const start = following === 1 ? args.startSeq : undefined
      const patched = start === undefined ? input : { ...input, afterSeq: start }
      const subscription = client.sessionStream.follow.subscribe(patched, {
        onData: (value) => {
          const parsed = streamServerMessageSchema.safeParse(value)
          if (!parsed.success) return
          frames += 1
          if (parsed.data.type === 'events') {
            eventsFrames += 1
            if (firstEventsMs === null) firstEventsMs = performance.now() - started
          }
          handlers.handleFrame(parsed.data)
        },
        onError: (failure) => handlers.handleFailure(undefined),
        onComplete: () => handlers.handleEnd(),
      })
      return { close: () => subscription.unsubscribe() }
    },
    list: () => ({ close: () => undefined }),
  }

  const connection = createStreamConnection({
    transport,
    scheduler: systemStreamScheduler,
    networkSignal: () => () => undefined,
  })
  const follower = connection.follow({ sessionId: args.sessionId, log: memorySessionLog() })
  let liveMs: number | null = null
  let resolveLive: (() => void) | undefined
  const reachedLive = new Promise<void>((resolve) => {
    resolveLive = resolve
  })
  const unsubscribe = follower.subscribe(() => {
    if (follower.getSnapshot().connection !== ESessionConnection.Live) return
    if (liveMs === null) liveMs = performance.now() - started
    resolveLive?.()
  })

  const phases = new Set<string>()
  let sawOpen = false
  let leftOpen = false
  const poll = setInterval(() => {
    const phase = connection.state()
    phases.add(phase)
    if (phase === EStreamConnectionState.Open) sawOpen = true
    else if (sawOpen) leftOpen = true
  }, POLL_MS)

  await Promise.race([reachedLive, Bun.sleep(args.timeoutMs)])
  clearInterval(poll)
  const snapshot = follower.getSnapshot()
  if (snapshot.connection === ESessionConnection.Live && liveMs === null)
    liveMs = performance.now() - started
  unsubscribe()
  follower.close()
  connection.close()

  return {
    firstEventsMs,
    liveMs,
    timedOut: liveMs === null,
    frames,
    eventsFrames,
    leftOpen,
    phases: [...phases].join('|'),
  }
}
