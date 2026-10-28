import { EThreadStreamFrame, type ThreadStreamFrame } from '@dltech/atlas-wire'
import { ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { request } from 'express'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { advanceTimersByTimeAsync, waitFor } from '../../../../test/fake-timers'
import { DrainStateService } from '../health/drain-state.service'
import type { EventsService } from './events.service'
import type { SessionOrSandboxTrpcCtx } from './session-or-sandbox.middleware'
import { ThreadEventsRouter } from './thread-events.router'
import { ThreadSignalsService } from './thread-signals.service'
import { THREAD_STREAM_HEARTBEAT_INTERVAL_MS, THREAD_STREAM_LIFETIME_MS } from './thread-stream'

const HEAD = (head: number): ThreadStreamFrame => ({ type: EThreadStreamFrame.Head, head })
const POD: ThreadStreamFrame = { type: EThreadStreamFrame.Pod }
const HEARTBEAT: ThreadStreamFrame = { type: EThreadStreamFrame.Heartbeat }

const ctxFor = (extra: Partial<SessionOrSandboxTrpcCtx> = {}): SessionOrSandboxTrpcCtx => ({
  req: request,
  bearerToken: undefined,
  clientVersion: undefined,
  auth: { userId: 'usr_1', sessionId: 'ses', email: '' },
  ...extra,
})

const optionsFor = (signal?: AbortSignal) => ({
  ctx: undefined,
  input: undefined,
  type: 'subscription',
  path: 'threadEvents.stream',
  rawInput: undefined,
  signal,
})

function routerWith(args: { head?: () => Promise<{ head: number }> } = {}) {
  const drain = new DrainStateService()
  const signals = new ThreadSignalsService(drain)
  const events = {
    head: vi.fn(args.head ?? (async () => ({ head: 7 }))),
  } as unknown as EventsService
  return { router: new ThreadEventsRouter(events, signals, drain), signals, drain, events }
}

const consume = (frames: AsyncGenerator<ThreadStreamFrame>) => {
  const seen: ThreadStreamFrame[] = []
  const finished = (async () => {
    for await (const frame of frames) seen.push(frame)
  })()
  return { seen, finished }
}

describe('ThreadEventsRouter.stream', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('opens with the current head, then relays head and pod signals of that thread', async () => {
    const { router, signals } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toEqual([HEAD(7)]))
    await signals.headMoved({ threadId: 'thr_1', head: 9 })
    await signals.headMoved({ threadId: 'thr_other', head: 1 })
    await signals.podChanged({ threadId: 'thr_1' })

    await waitFor(() => expect(seen).toEqual([HEAD(7), HEAD(9), POD]))
    controller.abort()
    await finished
  })

  it('refuses a thread the caller does not own before streaming', async () => {
    const { router } = routerWith({
      head: async () => {
        throw new NotFoundException('thread not found')
      },
    })

    await expect(
      router.stream({ threadId: 'thr_x' }, ctxFor(), optionsFor()),
    ).rejects.toBeInstanceOf(NotFoundException)
  })

  it('forbids sandbox and pod tokens', async () => {
    const { router } = routerWith()

    await expect(
      router.stream(
        { threadId: 'thr_1' },
        ctxFor({ sandbox: { sandboxId: 'sbx_1', threadId: 'thr_1' } }),
        optionsFor(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException)
    await expect(
      router.stream({ threadId: 'thr_1' }, ctxFor({ pod: { threadId: 'thr_1' } }), optionsFor()),
    ).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('refuses to open once the process is draining', async () => {
    const { router, drain } = routerWith()
    drain.beginDrain()

    await expect(
      router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor()),
    ).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('heartbeats every 30 seconds', async () => {
    const { router } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(seen).toEqual([HEAD(7)]))

    await advanceTimersByTimeAsync(THREAD_STREAM_HEARTBEAT_INTERVAL_MS)

    await waitFor(() => expect(seen).toEqual([HEAD(7), HEARTBEAT]))
    controller.abort()
    await finished
  })

  it('ends the stream after its lifetime so the client resubscribes', async () => {
    const { router } = routerWith()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor()),
    )
    await waitFor(() => expect(seen).toContainEqual(HEAD(7)))

    await advanceTimersByTimeAsync(THREAD_STREAM_LIFETIME_MS)

    await finished
    expect(THREAD_STREAM_LIFETIME_MS).toBe(240_000)
  })

  it('ends the stream when the process drains', async () => {
    const { router, drain } = routerWith()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor()),
    )
    await waitFor(() => expect(seen).toEqual([HEAD(7)]))

    drain.beginDrain()

    await finished
  })

  it('detaches from the signals when the client aborts', async () => {
    const { router, signals } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(seen).toEqual([HEAD(7)]))

    controller.abort()
    await finished
    await signals.headMoved({ threadId: 'thr_1', head: 99 })

    expect(seen).toEqual([HEAD(7)])
  })

  it('does not lose a signal that lands while the first head is being read', async () => {
    let release: (value: { head: number }) => void = () => {}
    let reads = 0
    const { router, signals } = routerWith({
      head: () => {
        reads += 1
        if (reads === 1) return Promise.resolve({ head: 7 })
        return new Promise((resolve) => {
          release = resolve
        })
      },
    })
    const controller = new AbortController()
    const { seen, finished } = consume(
      await router.stream({ threadId: 'thr_1' }, ctxFor(), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(reads).toBe(2))

    await signals.podChanged({ threadId: 'thr_1' })
    release({ head: 8 })

    await waitFor(() => expect(seen).toEqual([HEAD(8), POD]))
    controller.abort()
    await finished
  })
})
