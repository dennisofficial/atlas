import { EGithubPrStreamFrame, type GithubPrStreamFrame } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import {
  COMMENT_EVENT,
  optionsFor,
  podCtxFor,
  routerWith,
  VERDICT_EVENT,
} from './github-pr-stream.fixture'

const consume = (frames: AsyncGenerator<GithubPrStreamFrame>) => {
  const seen: GithubPrStreamFrame[] = []
  const finished = (async () => {
    for await (const frame of frames) seen.push(frame)
  })()
  return { seen, finished }
}

const events = (seen: readonly GithubPrStreamFrame[]) =>
  seen.flatMap((frame) => (frame.type === EGithubPrStreamFrame.PrEvent ? [frame.event.id] : []))

describe('GithubPrStreamRouter.stream for a thread-bound pod', () => {
  it('replays the thread’s missed events, not the user mailbox', async () => {
    const { router } = routerWith({ undelivered: [COMMENT_EVENT], threadMissed: [VERDICT_EVENT] })
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(
        podCtxFor({ userId: 'usr_1', threadId: 'thr_1' }),
        optionsFor(controller.signal),
      ),
    )

    await waitFor(() => expect(events(seen)).toEqual([VERDICT_EVENT.id]))
    controller.abort()
    await finished
  })

  it('acknowledges a live event against the pod’s thread', async () => {
    const { router, fanout } = routerWith()
    const acks: unknown[] = []
    fanout.onEventDelivered((ack) => acks.push(ack))
    const controller = new AbortController()
    const { seen, finished } = consume(
      router.stream(
        podCtxFor({ userId: 'usr_1', threadId: 'thr_1' }),
        optionsFor(controller.signal),
      ),
    )
    await waitFor(() => expect(seen.length).toBeGreaterThan(0))

    fanout.pushEvent({ userIds: ['usr_1'], event: COMMENT_EVENT, ackId: 'evt_1' })
    await waitFor(() => expect(acks).toHaveLength(1))
    controller.abort()
    await finished

    expect(acks[0]).toEqual({
      ackId: 'evt_1',
      userId: 'usr_1',
      userStream: false,
      threadIds: ['thr_1'],
    })
  })
})
