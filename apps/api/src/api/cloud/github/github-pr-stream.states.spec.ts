import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { describe, expect, it, spyOn } from 'bun:test'
import { waitFor } from '../../../../test/fake-timers'
import { ctxFor, optionsFor, routerWith, STATE } from './github-pr-stream.fixture'

const HEARTBEAT: GithubPrStatesFrame = { type: EGithubPrStatesFrame.Heartbeat }
const stateFrame = (state = STATE): GithubPrStatesFrame => ({
  type: EGithubPrStatesFrame.PrState,
  state,
})

const open = (router: ReturnType<typeof routerWith>['router']) => {
  const controller = new AbortController()
  const seen: GithubPrStatesFrame[] = []
  const finished = (async () => {
    for await (const frame of router.states(ctxFor('usr_1'), optionsFor(controller.signal))) {
      seen.push(frame)
    }
  })()
  return { controller, seen, finished }
}

describe('GithubPrStreamRouter.states', () => {
  it('keeps legacy undefined input heartbeat/pr-state only and never acquires an observational lease', async () => {
    const { router, fanout, observations } = routerWith({ states: [STATE] })
    const acquire = spyOn(observations, 'acquire').mockRejectedValue(new Error('Redis unavailable'))
    const { controller, seen, finished } = open(router)
    await waitFor(() => expect(seen).toEqual([HEARTBEAT, stateFrame()]))
    fanout.push({ userIds: ['usr_1'], state: { ...STATE, checksPassed: 4 } })
    await waitFor(() => expect(seen).toHaveLength(3))
    controller.abort()
    await finished
    expect(seen).toEqual([HEARTBEAT, stateFrame(), stateFrame({ ...STATE, checksPassed: 4 })])
    expect(acquire).not.toHaveBeenCalled()
  })

  it('replays known states, then pushes live fanout states', async () => {
    const { router, fanout } = routerWith({ states: [STATE] })
    const { controller, seen, finished } = open(router)

    await waitFor(() => expect(seen).toHaveLength(2))
    fanout.push({ userIds: ['usr_1'], state: { ...STATE, checksFailed: 1 } })
    await waitFor(() => expect(seen).toHaveLength(3))
    controller.abort()
    await finished

    expect(seen).toEqual([HEARTBEAT, stateFrame(), stateFrame({ ...STATE, checksFailed: 1 })])
  })

  it('never reads or acks the mailbox, and ignores mailbox events', async () => {
    const { router, fanout, mailbox } = routerWith({ states: [STATE] })
    const replayAll = spyOn(mailbox, 'replayUndelivered')
    const replayThread = spyOn(mailbox, 'replayForThread')
    const { controller, seen, finished } = open(router)

    await waitFor(() => expect(seen).toHaveLength(2))
    fanout.pushEvent({
      userIds: ['usr_1'],
      event: {
        id: 'e',
        repoFullName: 'compai/app',
        prNumber: 42,
        kind: 'comment',
        payload: {},
        createdAt: '',
      } as never,
    })
    controller.abort()
    await finished

    expect(replayAll).not.toHaveBeenCalled()
    expect(replayThread).not.toHaveBeenCalled()
    expect(seen).toHaveLength(2)
  })
})
