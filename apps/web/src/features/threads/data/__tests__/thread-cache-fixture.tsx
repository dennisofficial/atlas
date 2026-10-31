import {
  decodeClientFrame,
  EClientFrame,
  encodeFrame,
  type ClientFrame,
  type ServeFrame,
} from '@dltech/atlas-client/channel'
import { readEventsParamsSchema, type WireEvent } from '@dltech/atlas-wire/web'
import { act } from 'react'

import { cloudThreadBackend } from '../thread-backend'
import { fetchSnapshot } from '../threads-api'
import { EPodConnectOutcome, type PodConnectResult } from '../pod-connect'
import { createThreadSignalHub } from '../thread-signal-hub'
import { useThreadSource, type ThreadSource } from '../use-thread-source'
import { ThreadBackendProvider } from '../use-thread-backend'
import { event, ticketOf } from './live-thread-fixture'
import { fakeFetch, trpcOk } from './trpc-fake'

export class TestWebSocket {
  static OPEN = 1
  static sockets: TestWebSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: ClientFrame[] = []

  constructor(
    readonly url: string,
    readonly protocols: string[],
  ) {
    TestWebSocket.sockets.push(this)
  }
  send(data: string) {
    const frame = decodeClientFrame(data)
    if (frame !== null) this.sent.push(frame)
  }
  close() {
    this.readyState = 3
  }
  open() {
    this.readyState = TestWebSocket.OPEN
    this.onopen?.()
  }
  receive(frame: ServeFrame) {
    this.onmessage?.({ data: encodeFrame(frame) })
  }
  requests() {
    return this.sent.flatMap((frame) => (frame.kind === EClientFrame.Request ? [frame] : []))
  }
}

export function threadCacheRig(args?: {
  live?: boolean
  local?: boolean
  deferred?: boolean
  deferredMint?: boolean
  snapshot?: boolean
  afterSnapshot?: () => Promise<void>
}) {
  let historyRev = 0
  let log = [event(1), event(2)]
  let latest: ThreadSource | undefined
  const renders: ThreadSource[] = []
  const reads: (number | undefined)[] = []
  let release: (() => void) | undefined
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const mintReady = Promise.withResolvers<void>()
  const calls = fakeFetch(() => {
    const url = new URL(calls.at(-1)!.url, 'https://atlas.test')
    const { fromSeq } = readEventsParamsSchema.parse(JSON.parse(url.searchParams.get('input')!))
    reads.push(fromSeq)
    const events = log.filter((entry) => fromSeq === undefined || entry.seq >= fromSeq)
    return trpcOk(args?.snapshot ? { events, historyRev, head: log.at(-1)?.seq ?? 0 } : events)
  })
  const rawSeed = cloudThreadBackend.fetchSeed
  const { fetchSnapshot: cloudSnapshot, ...legacyBackend } = cloudThreadBackend
  const backend = {
    ...legacyBackend,
    ...(args?.snapshot
      ? {
          fetchSnapshot: async (request: Parameters<typeof fetchSnapshot>[0]) => {
            if (args.deferred) await released
            const snapshot = await fetchSnapshot(request)
            await args.afterSnapshot?.()
            return snapshot
          },
        }
      : {}),
    local: args?.local ?? false,
    mint: async (): Promise<PodConnectResult> => {
      if (args?.deferredMint) await mintReady.promise
      return args?.live ? ticketOf('open-ticket') : { outcome: EPodConnectOutcome.NotRunning }
    },
    fetchThread: async (): Promise<never> => {
      throw new Error('no stored model')
    },
    fetchSeed: args?.local
      ? async () => []
      : async (threadId: string) => {
          if (args?.deferred) await released
          return rawSeed(threadId)
        },
    fetchEvents: args?.local
      ? async ({ fromSeq }: Parameters<typeof cloudThreadBackend.fetchEvents>[0]) => {
          reads.push(fromSeq)
          return []
        }
      : cloudThreadBackend.fetchEvents,
  }
  const hub = createThreadSignalHub()
  function Probe({ liveEligible }: { liveEligible: boolean }) {
    latest = useThreadSource({ threadId: 'thr_1', signals: hub, liveEligible })
    renders.push(latest)
    return null
  }
  const mount = async (liveEligible = true) => {
    const { createRoot } = await import('react-dom/client')
    const root = createRoot(document.createElement('div'))
    const render = async (eligible: boolean) => {
      await act(async () =>
        root.render(
          <ThreadBackendProvider backend={backend}>
            <Probe liveEligible={eligible} />
          </ThreadBackendProvider>,
        ),
      )
    }
    await render(liveEligible)
    return { render, unmount: () => act(async () => root.unmount()) }
  }
  const state = () => {
    if (latest === undefined) throw new Error('not mounted')
    return latest
  }
  const socket = () => {
    const latest = TestWebSocket.sockets.at(-1)
    if (latest === undefined) throw new Error('no websocket opened')
    return latest
  }
  return {
    mount,
    hub,
    reads,
    calls,
    state,
    socket,
    renders,
    release: () => release?.(),
    releaseMint: () => mintReady.resolve(),
    setEpoch: (rev: number) => {
      historyRev = rev
    },
    setLog: (events: WireEvent[]) => {
      log = events
    },
  }
}
