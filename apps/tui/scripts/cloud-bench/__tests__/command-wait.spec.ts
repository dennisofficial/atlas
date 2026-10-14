import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, ENoticePosition, ENoticeTone, type Notice } from '@dltech/atlas-core'

import { moveFailedNotice } from '../../../src/composition/container-notices'
import {
  CommandWaitError,
  createCommandWait,
  ECommandWaitFailure,
  moveFailureOf,
  type OwnerView,
} from '../command-wait'

const BIRTH_STEPS = ['flipOwnership', 'activate'] as const

type OwnerState = {
  location: EExecutionLocation
  bound: boolean
}

const fakeOwner = (initial: OwnerState) => {
  const listeners = new Set<() => void>()
  let state = initial
  const view: OwnerView = {
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    snapshot: () => ({ location: state.location, bound: state.bound, record: undefined }),
  }
  return {
    view,
    listeners,
    set: (next: Partial<OwnerState>) => {
      state = { ...state, ...next }
      for (const listener of [...listeners]) listener()
    },
  }
}

const noticeAt = (args: { key: string; text: string; tone?: ENoticeTone; issuedAtMs?: number }): Notice => ({
  key: args.key,
  text: args.text,
  tone: args.tone ?? ENoticeTone.Warn,
  position: ENoticePosition.Tray,
  issuedAtMs: args.issuedAtMs ?? 1,
  ttlMs: 1000,
})

const fakeNotices = (initial: readonly Notice[] = []) => {
  const listeners = new Set<() => void>()
  let held = initial
  return {
    listeners,
    view: {
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      current: () => held,
    },
    post: (notice: Notice) => {
      held = [...held.filter((entry) => entry.key !== notice.key), notice]
      for (const listener of [...listeners]) listener()
    },
  }
}

const clock = () => {
  let at = 1_000
  return { now: () => at, advance: (ms: number) => (at += ms) }
}

const isSettled = (promise: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5)),
  ])

const birthWait = (args: {
  owner: ReturnType<typeof fakeOwner>
  notices?: ReturnType<typeof fakeNotices>
  timeoutMs?: number
  now?: () => number
}) => {
  const notices = args.notices ?? fakeNotices()
  const wait = createCommandWait({
    target: EExecutionLocation.Cloud,
    requiredSteps: BIRTH_STEPS,
    owner: args.owner.view,
    notices: notices.view,
    failureOf: moveFailureOf,
    timeoutMs: args.timeoutMs ?? 60_000,
    ...(args.now === undefined ? {} : { now: args.now }),
  })
  return { wait, notices }
}

const cloudOwner = () => fakeOwner({ location: EExecutionLocation.Cloud, bound: true })

describe('command completion wait', () => {
  it('does not succeed when the ownership flip lands before activation', async () => {
    const owner = cloudOwner()
    const { wait } = birthWait({ owner })
    wait.start()

    wait.step('flipOwnership')
    expect(await isSettled(wait.completion)).toBe(false)

    wait.step('activate')
    expect((await wait.completion).timings.map((timing) => timing.step)).toEqual([...BIRTH_STEPS])
  })

  it('holds after the terminal step until the owner is bound at the target', async () => {
    const owner = fakeOwner({ location: EExecutionLocation.Host, bound: false })
    const { wait } = birthWait({ owner })
    wait.start()
    for (const step of BIRTH_STEPS) wait.step(step)
    expect(await isSettled(wait.completion)).toBe(false)

    owner.set({ location: EExecutionLocation.Cloud })
    expect(await isSettled(wait.completion)).toBe(false)

    owner.set({ bound: true })
    await expect(wait.completion).resolves.toBeDefined()
  })

  it('reports step offsets and elapsed time from the monotonic clock taken at start', async () => {
    const time = clock()
    const { wait } = birthWait({ owner: cloudOwner(), now: time.now })

    time.advance(50_000)
    wait.start()
    time.advance(120)
    wait.step('flipOwnership')
    time.advance(30)
    wait.step('activate')

    expect(await wait.completion).toEqual({
      elapsedMs: 150,
      timings: [
        { step: 'flipOwnership', elapsedMs: 120 },
        { step: 'activate', elapsedMs: 150 },
      ],
    })
  })

  it('ignores steps that arrive before the command starts', async () => {
    const { wait } = birthWait({ owner: cloudOwner() })

    wait.step('flipOwnership')
    wait.start()
    wait.step('activate')

    expect(await isSettled(wait.completion)).toBe(false)
  })

  it('rejects at once on a move-failure notice, naming the failure without any transcript', async () => {
    const owner = cloudOwner()
    const { wait, notices } = birthWait({ owner })
    wait.start()
    wait.step('flipOwnership')

    notices.post(
      noticeAt({
        key: 'container-cloud',
        text: moveFailedNotice({
          target: EExecutionLocation.Cloud,
          from: EExecutionLocation.Host,
          detail: 'the sandbox would not start',
        }),
      }),
    )

    const failure = await wait.completion.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CommandWaitError)
    if (!(failure instanceof CommandWaitError)) return
    expect(failure.reason).toBe(ECommandWaitFailure.MoveFailed)
    expect(failure.message).toContain('did not finish')
    expect(failure.timings.map((timing) => timing.step)).toEqual(['flipOwnership'])
  })

  it('ignores a failure notice that was already standing when the command started', async () => {
    const stale = noticeAt({ key: 'container-cloud', text: 'moving to the cloud failed — earlier attempt' })
    const { wait, notices } = birthWait({ owner: cloudOwner(), notices: fakeNotices([stale]) })
    wait.start()
    notices.post(noticeAt({ key: 'unrelated', text: 'something else', tone: ENoticeTone.Info }))
    for (const step of BIRTH_STEPS) wait.step(step)

    await expect(wait.completion).resolves.toBeDefined()
  })

  it('does not abort on a success-with-warning notice', async () => {
    const { wait, notices } = birthWait({ owner: cloudOwner() })
    wait.start()
    notices.post(
      noticeAt({ key: 'container-cloud', text: 'this conversation is in the cloud, but the context was skipped' }),
    )
    for (const step of BIRTH_STEPS) wait.step(step)

    await expect(wait.completion).resolves.toBeDefined()
  })

  it('rejects on timeout, naming the steps seen, the steps missing and the owner state', async () => {
    const owner = fakeOwner({ location: EExecutionLocation.Host, bound: true })
    const { wait } = birthWait({ owner, timeoutMs: 15 })
    wait.start()
    wait.step('flipOwnership')

    const failure = await wait.completion.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CommandWaitError)
    if (!(failure instanceof CommandWaitError)) return
    expect(failure.reason).toBe(ECommandWaitFailure.TimedOut)
    expect(failure.message).toContain('activate')
    expect(failure.message).toContain('location=host')
  })

  it('leaves no listener or timer behind after success, failure, timeout or disposal', async () => {
    const outcomes: Array<
      (args: { wait: ReturnType<typeof birthWait>['wait']; notices: ReturnType<typeof fakeNotices> }) => void
    > = [
      ({ wait }) => BIRTH_STEPS.forEach((step) => wait.step(step)),
      ({ notices }) =>
        notices.post(noticeAt({ key: 'container-switch', text: 'moving back to the host did not finish' })),
      () => undefined,
      ({ wait }) => wait.dispose(),
    ]

    for (const [index, outcome] of outcomes.entries()) {
      const owner = cloudOwner()
      const { wait, notices } = birthWait({ owner, timeoutMs: index === 2 ? 10 : 60_000 })
      wait.start()
      expect(owner.listeners.size).toBe(1)
      expect(notices.listeners.size).toBe(1)

      outcome({ wait, notices })
      await wait.completion.catch(() => undefined)

      expect(owner.listeners.size).toBe(0)
      expect(notices.listeners.size).toBe(0)
    }
  })

  it('rejects a disposed wait as cancelled instead of leaving the caller hanging', async () => {
    const { wait } = birthWait({ owner: cloudOwner() })
    wait.start()
    wait.dispose()

    const failure = await wait.completion.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(CommandWaitError)
    if (failure instanceof CommandWaitError) expect(failure.reason).toBe(ECommandWaitFailure.Cancelled)
  })
})

describe('move failure classification', () => {
  it('reads refusals and failed moves on the container notice keys as failures', () => {
    expect(moveFailureOf(noticeAt({ key: 'container-cloud', text: 'Vercel credentials are not set up' }))).toBeDefined()
    expect(
      moveFailureOf(noticeAt({ key: 'container-switch', text: 'moving back to the host did not finish — x' })),
    ).toBeDefined()
  })

  it('leaves other keys, non-warning tones and success-with-warning notices alone', () => {
    expect(moveFailureOf(noticeAt({ key: 'classifier-offline', text: 'classifier is offline' }))).toBeUndefined()
    expect(
      moveFailureOf(noticeAt({ key: 'container-cloud', text: 'moving to the cloud', tone: ENoticeTone.Info })),
    ).toBeUndefined()
    expect(
      moveFailureOf(
        noticeAt({
          key: 'container-switch',
          text: 'the session is home on the host, but reopening it here was incomplete',
        }),
      ),
    ).toBeUndefined()
  })
})
