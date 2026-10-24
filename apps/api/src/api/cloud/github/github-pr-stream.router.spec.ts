import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'
import { ServiceUnavailableException } from '@nestjs/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test'
import { advanceTimersByTimeAsync, waitFor } from '../../../../test/fake-timers'
import {
  COMMENT_EVENT,
  ctxFor,
  optionsFor,
  routerWith,
  STATE,
  VERDICT_EVENT,
} from './github-pr-stream.fixture'
import { PR_STREAM_HEARTBEAT_INTERVAL_MS } from './github-pr-stream.router'

const HEARTBEAT: GithubPrStreamFrame = { type: EGithubPrStreamFrame.Heartbeat }
const stateFrame = (state = STATE): GithubPrStreamFrame => ({
  type: EGithubPrStreamFrame.PrState,
  state,
})
const eventFrame = (event = COMMENT_EVENT): GithubPrStreamFrame => ({
  type: EGithubPrStreamFrame.PrEvent,
  event,
})

const consume = (frames: AsyncGenerator<GithubPrStreamFrame>) => {
  const seen: GithubPrStreamFrame[] = []
  const finished = (async () => {
    for await (const frame of frames) seen.push(frame)
  })()
  return { seen, finished }
}

describe('GithubPrStreamRouter.stream', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('refuses to open a stream once the process is draining', () => {
    const { router, drain } = routerWith()
    drain.beginDrain()

    expect(() => router.stream(ctxFor('usr_1'), optionsFor())).toThrow(ServiceUnavailableException)
  })

  it('opens with a heartbeat frame', async () => {
    const { router } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))
    controller.abort()
    await finished
  })

  it('replays the cached states on open, then pushes live frames', async () => {
    const { router, fanout } = routerWith({ states: [STATE] })
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toHaveLength(2))
    fanout.push({ userIds: ['usr_1'], state: { ...STATE, checksPassed: 4 } })
    await waitFor(() => expect(seen).toHaveLength(3))
    controller.abort()
    await finished

    expect(seen).toEqual([HEARTBEAT, stateFrame(), stateFrame({ ...STATE, checksPassed: 4 })])
  })

  it('completes the stream when the drain closes the fanout', async () => {
    const { router, drain } = routerWith()
    const { finished } = consume(router.stream(ctxFor('usr_1'), optionsFor()))

    drain.beginDrain()

    await finished
  })

  it('still opens the stream when the state replay fails', async () => {
    const { router, fanout } = routerWith({ states: new Error('database is gone') })
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))
    fanout.push({ userIds: ['usr_1'], state: STATE })
    await waitFor(() => expect(seen).toEqual([HEARTBEAT, stateFrame()]))
    controller.abort()
    await finished
  })

  it('replays undelivered mailbox events as pr-event frames on open', async () => {
    const { router } = routerWith({ states: [STATE], undelivered: [COMMENT_EVENT] })
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toHaveLength(3))
    controller.abort()
    await finished

    expect(seen).toEqual([HEARTBEAT, stateFrame(), eventFrame()])
  })

  it('pushes live mailbox events to an open stream as pr-event frames', async () => {
    const { router, fanout } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))

    fanout.pushEvent({ userIds: ['usr_1'], event: VERDICT_EVENT })
    await waitFor(() => expect(seen).toHaveLength(2))
    controller.abort()
    await finished

    expect(seen[1]).toEqual(eventFrame(VERDICT_EVENT))
  })

  it('still opens the stream when the mailbox replay fails', async () => {
    const { router, fanout } = routerWith({ undelivered: new Error('database is gone') })
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )

    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))
    fanout.push({ userIds: ['usr_1'], state: STATE })
    await waitFor(() => expect(seen).toEqual([HEARTBEAT, stateFrame()]))
    controller.abort()
    await finished
  })

  it('delivers only to the stream of the addressed user', async () => {
    const { router, fanout } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))

    fanout.push({ userIds: ['usr_2'], state: STATE })
    await advanceTimersByTimeAsync(10)
    controller.abort()
    await finished

    expect(seen).toEqual([HEARTBEAT])
  })

  it('ends when the signal aborts and detaches from the fanout', async () => {
    const { router, fanout } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )
    await waitFor(() => expect(seen).toEqual([HEARTBEAT]))
    expect(vi.getTimerCount()).toBe(1)

    controller.abort()
    await finished

    expect(vi.getTimerCount()).toBe(0)
    fanout.push({ userIds: ['usr_1'], state: STATE })
    await advanceTimersByTimeAsync(PR_STREAM_HEARTBEAT_INTERVAL_MS * 2)
    expect(seen).toEqual([HEARTBEAT])
  })

  it('sends a heartbeat frame on every heartbeat interval', async () => {
    const { router } = routerWith()
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(ctxFor('usr_1'), optionsFor(controller.signal)),
    )
    await advanceTimersByTimeAsync(0)
    expect(seen).toEqual([HEARTBEAT])

    await advanceTimersByTimeAsync(PR_STREAM_HEARTBEAT_INTERVAL_MS / 2)
    expect(seen).toEqual([HEARTBEAT])

    await advanceTimersByTimeAsync(PR_STREAM_HEARTBEAT_INTERVAL_MS / 2 + 10)
    expect(seen).toEqual([HEARTBEAT, HEARTBEAT])

    await advanceTimersByTimeAsync(PR_STREAM_HEARTBEAT_INTERVAL_MS)
    expect(seen).toEqual([HEARTBEAT, HEARTBEAT, HEARTBEAT])
    controller.abort()
    await finished
  })
})
