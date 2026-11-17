import { useTestDatabase } from '@dltech/atlas-db/testing'
import { EGithubPrStatesFrame, type GithubPrStatesFrame } from '@dltech/atlas-wire'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'bun:test'
import { stubGlobal, unstubAllGlobals } from '@dltech/bun-test-shims'
import { waitFor } from '../../../../test/fake-timers'
import { seedPrState } from '../../../../test/github-seed'
import { seedLinkedPr } from './github-linked-pr.fixture'
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

const allowRepos = (allowed: readonly string[]) => {
  stubGlobal(
    'fetch',
    vi.fn(async (target: Parameters<typeof fetch>[0]) => {
      const repo = new URL(String(target)).pathname.replace('/repos/', '')
      return allowed.includes(repo)
        ? Response.json({ full_name: repo }, { status: 200 })
        : Response.json({}, { status: 404 })
    }),
  )
}

const prStates = (frames: readonly GithubPrStatesFrame[]) =>
  frames.flatMap((frame) => (frame.type === EGithubPrStatesFrame.PrState ? [frame.state] : []))

describe('GithubPrStreamRouter.states', () => {
  useTestDatabase()

  beforeAll(() => {
    allowRepos(['compai/app'])
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
  afterAll(() => {
    unstubAllGlobals()
  })

  it('connects with no input and replays subscribed and linked states', async () => {
    await seedLinkedPr({ userId: 'usr_1', threadId: 'thr_1' })
    await seedPrState({ prNumber: 42, checksPassed: 2, version: 1 })
    const subscribed: typeof STATE = {
      ...STATE,
      repoFullName: 'compai/other',
      prNumber: 7,
      url: 'https://github.com/compai/other/pull/7',
    }
    const { router, fanout } = routerWith({ states: [{ ...subscribed, version: 1 }] })
    const { controller, seen, finished } = open(router)

    await waitFor(() =>
      expect(prStates(seen).map((state) => `${state.repoFullName}#${state.prNumber}`)).toEqual([
        'compai/other#7',
        'compai/app#42',
      ]),
    )
    expect(seen[0]).toEqual(HEARTBEAT)

    fanout.push({ userIds: [], state: { ...STATE, version: 2, checksPassed: 6 } })
    await waitFor(() => expect(prStates(seen)).toHaveLength(3))
    expect(prStates(seen)[2]?.checksPassed).toBe(6)

    controller.abort()
    await finished
  })

  it('replays known states, then pushes live fanout states', async () => {
    const { router, fanout } = routerWith({ states: [STATE] })
    const { controller, seen, finished } = open(router)

    await waitFor(() => expect(seen).toHaveLength(2))
    fanout.push({ userIds: ['usr_1'], state: { ...STATE, version: 2, checksFailed: 1 } })
    await waitFor(() => expect(seen).toHaveLength(3))
    controller.abort()
    await finished

    expect(seen).toEqual([
      HEARTBEAT,
      stateFrame(),
      stateFrame({ ...STATE, version: 2, checksFailed: 1 }),
    ])
  })

  it('never reads or acks the mailbox, and ignores mailbox events', async () => {
    const { router, fanout, mailbox } = routerWith({ states: [STATE] })
    const replayAll = vi.spyOn(mailbox, 'replayUndelivered')
    const replayThread = vi.spyOn(mailbox, 'replayForThread')
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
