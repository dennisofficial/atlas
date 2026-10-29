import { EGithubWakeFrame, type GithubWakeFrame } from '@dltech/atlas-wire'
import { describe, expect, it } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import { ctxFor, optionsFor, routerWith } from './github-pr-stream.fixture'

describe('GithubPrStreamRouter.wakes', () => {
  it('streams wake frames for the signed-in user’s threads', async () => {
    const { router, fanout } = routerWith()
    const controller = new AbortController()
    const seen: GithubWakeFrame[] = []
    const finished = (async () => {
      for await (const frame of router.wakes(ctxFor('usr_1'), optionsFor(controller.signal))) {
        seen.push(frame)
      }
    })()
    await waitFor(() => expect(seen).toEqual([{ type: EGithubWakeFrame.Heartbeat }]))

    fanout.pushWake({ userIds: ['usr_2'], threadId: 'thr_other_user' })
    fanout.pushWake({ userIds: ['usr_1'], threadId: 'thr_1' })
    await waitFor(() => expect(seen).toHaveLength(2))
    controller.abort()
    await finished

    expect(seen[1]).toEqual({ type: EGithubWakeFrame.Wake, threadId: 'thr_1' })
  })
})
