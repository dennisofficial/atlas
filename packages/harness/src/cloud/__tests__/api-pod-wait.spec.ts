import { describe, expect, it } from 'bun:test'

import {
  EBootStep,
  EBootStepState,
  EPodState,
  EThreadStreamFrame,
  EVercelCredentialGap,
} from '@dltech/atlas-wire'

import { EPodBootFailure, PodBootError, PodNotConfiguredError } from '../api-pod-errors'
import { BOOT_STEP_LABELS, waitForPodRunning, type PodWaitOptions } from '../api-pod-wait'
import {
  cloudFailure,
  createFakePodApi,
  statusOf,
  stepOf,
  type FakePodApi,
} from './api-pod-fixture'
import { createFakeTimerClock } from './fake-timer-clock'

const settle = () => Bun.sleep(5)
const POLL_MS = 1_000
const TIMEOUT_MS = 60_000
const POD_FRAME = { type: EThreadStreamFrame.Pod } as const

const waiting = (fake: FakePodApi, options: Partial<PodWaitOptions> = {}) => {
  const timers = createFakeTimerClock()
  const outcome = waitForPodRunning({
    api: fake.api,
    threadId: 'thr_1',
    timeoutMs: TIMEOUT_MS,
    pollMs: POLL_MS,
    clock: timers.clock,
    ...options,
  }).then(
    () => 'running' as const,
    (failure: unknown) => failure,
  )
  return { timers, outcome }
}

const booting = statusOf(EPodState.Booting, [stepOf(EBootStep.Provision, EBootStepState.Running)])

describe('waitForPodRunning', () => {
  it('resolves on the first read when the pod already runs, without opening a stream', async () => {
    const fake = createFakePodApi({ statuses: [statusOf(EPodState.Running)] })

    const { outcome } = waiting(fake)

    expect(await outcome).toBe('running')
    expect(fake.streams).toHaveLength(0)
  })

  it('re-reads the status on each pod frame and resolves once running', async () => {
    const fake = createFakePodApi({ statuses: [booting, booting, statusOf(EPodState.Running)] })
    const { outcome } = waiting(fake)
    await settle()
    expect(fake.streams).toHaveLength(1)

    fake.streams[0]?.onData?.(POD_FRAME)
    await settle()
    fake.streams[0]?.onData?.(POD_FRAME)

    expect(await outcome).toBe('running')
    expect(fake.statusReads()).toBe(3)
    expect(fake.unsubscribed()).toBe(1)
  })

  it('reads the status again when the stream reports it started', async () => {
    const fake = createFakePodApi({ statuses: [booting, statusOf(EPodState.Running)] })
    const { outcome } = waiting(fake)
    await settle()

    fake.streams[0]?.onStarted?.()

    expect(await outcome).toBe('running')
  })

  it('ignores head and heartbeat frames', async () => {
    const fake = createFakePodApi({ statuses: [booting] })
    waiting(fake)
    await settle()
    const reads = fake.statusReads()

    fake.streams[0]?.onData?.({ type: EThreadStreamFrame.Heartbeat })
    fake.streams[0]?.onData?.({ type: EThreadStreamFrame.Head, head: 4 })
    await settle()

    expect(fake.statusReads()).toBe(reads)
  })

  it('fails on an error step in the latest attempt even while the state says booting', async () => {
    const broken = statusOf(EPodState.Booting, [
      stepOf(EBootStep.Provision, EBootStepState.Done),
      stepOf(EBootStep.Clone, EBootStepState.Error, { error: 'repository not found' }),
    ])
    const { outcome } = waiting(createFakePodApi({ statuses: [broken] }))

    const failure = await outcome

    expect(failure).toBeInstanceOf(PodBootError)
    expect(failure).toMatchObject({ kind: EPodBootFailure.Failed })
    expect(String(failure)).toContain('repository not found')
    expect(String(failure)).toContain(BOOT_STEP_LABELS[EBootStep.Clone])
  })

  it('fails with the credential gap when the error step carries one', async () => {
    const gapped = statusOf(EPodState.Failed, [
      stepOf(EBootStep.Provision, EBootStepState.Error, {
        error: 'no Vercel credentials',
        gap: EVercelCredentialGap.UserCredential,
      }),
    ])
    const { outcome } = waiting(createFakePodApi({ statuses: [gapped] }))

    const failure = await outcome

    expect(failure).toBeInstanceOf(PodNotConfiguredError)
    expect(failure).toMatchObject({ gap: EVercelCredentialGap.UserCredential })
  })

  it('fails on state failed with no step detail', async () => {
    const { outcome } = waiting(createFakePodApi({ statuses: [statusOf(EPodState.Failed)] }))

    expect(await outcome).toMatchObject({ kind: EPodBootFailure.Failed })
  })

  it('reports each boot-step label once, as the running step changes', async () => {
    const labels: string[] = []
    const serving = statusOf(EPodState.Booting, [
      stepOf(EBootStep.Provision, EBootStepState.Done),
      stepOf(EBootStep.Serve, EBootStepState.Running),
    ])
    const fake = createFakePodApi({
      statuses: [booting, booting, serving, statusOf(EPodState.Running)],
    })
    const { outcome } = waiting(fake, { onStep: (label) => labels.push(label) })
    await settle()
    for (let frame = 0; frame < 3; frame += 1) {
      fake.streams[0]?.onData?.(POD_FRAME)
      await settle()
    }

    expect(await outcome).toBe('running')
    expect(labels).toEqual([
      BOOT_STEP_LABELS[EBootStep.Provision],
      BOOT_STEP_LABELS[EBootStep.Serve],
    ])
  })

  it('times out at the deadline and unsubscribes', async () => {
    const fake = createFakePodApi({ statuses: [booting] })
    const { timers, outcome } = waiting(fake)
    await settle()

    await timers.advance(TIMEOUT_MS)

    expect(await outcome).toMatchObject({ kind: EPodBootFailure.TimedOut })
    expect(fake.unsubscribed()).toBe(1)
    expect(timers.pending()).toBe(0)
  })

  it('resnapshots when the stream closes', async () => {
    const fake = createFakePodApi({ statuses: [booting, statusOf(EPodState.Running)] })
    const { timers, outcome } = waiting(fake)
    await settle()

    fake.streams[0]?.onComplete?.()

    expect(await outcome).toBe('running')
    expect(fake.statusReads()).toBe(2)
    await timers.advance(POLL_MS)
    expect(fake.streams).toHaveLength(1)
  })

  it('reopens the stream after it closes while the pod is still booting', async () => {
    const fake = createFakePodApi({ statuses: [booting] })
    const { timers } = waiting(fake)
    await settle()

    fake.streams[0]?.onStopped?.()
    await settle()
    await timers.advance(POLL_MS)

    expect(fake.streams).toHaveLength(2)
    expect(fake.statusReads()).toBeGreaterThanOrEqual(2)
  })

  it('polls the status at the interval when the stream errors', async () => {
    const fake = createFakePodApi({ statuses: [booting, booting, statusOf(EPodState.Running)] })
    const { timers, outcome } = waiting(fake)
    await settle()

    fake.streams[0]?.onError?.(new Error('stream refused'))
    await timers.advance(POLL_MS)
    await timers.advance(POLL_MS)

    expect(await outcome).toBe('running')
    expect(fake.streams).toHaveLength(1)
  })

  it('polls when subscribing itself throws', async () => {
    const fake = createFakePodApi({ statuses: [booting, statusOf(EPodState.Running)] })
    fake.failStreamWith(new Error('no EventSource'))
    const { timers, outcome } = waiting(fake)
    await settle()

    await timers.advance(POLL_MS)

    expect(await outcome).toBe('running')
  })

  it('ignores callbacks from a stream it already replaced', async () => {
    const fake = createFakePodApi({ statuses: [booting] })
    const { timers } = waiting(fake)
    await settle()
    fake.streams[0]?.onStopped?.()
    await settle()
    await timers.advance(POLL_MS)
    const reads = fake.statusReads()

    fake.streams[0]?.onData?.(POD_FRAME)
    await settle()

    expect(fake.statusReads()).toBe(reads)
  })

  it('keeps waiting through a transient failure on the status read', async () => {
    const fake = createFakePodApi({
      statuses: [booting, new Error('socket reset'), statusOf(EPodState.Running)],
    })
    const { timers, outcome } = waiting(fake)
    await settle()
    fake.streams[0]?.onData?.(POD_FRAME)
    await settle()

    await timers.advance(POLL_MS)

    expect(await outcome).toBe('running')
  })

  it('fails on an unrecoverable api answer', async () => {
    const fake = createFakePodApi({ statuses: [booting, cloudFailure(404)] })
    const { outcome } = waiting(fake)
    await settle()

    fake.streams[0]?.onData?.(POD_FRAME)

    expect(await outcome).toMatchObject({ status: 404 })
  })

  it('rejects as cancelled when the signal aborts', async () => {
    const abort = new AbortController()
    const { outcome } = waiting(createFakePodApi({ statuses: [booting] }), { signal: abort.signal })
    await settle()

    abort.abort()

    expect(await outcome).toMatchObject({ kind: EPodBootFailure.Cancelled })
  })

  it('rejects at once when the signal is already aborted', async () => {
    const abort = new AbortController()
    abort.abort()
    const fake = createFakePodApi({ statuses: [booting] })

    const { outcome } = waiting(fake, { signal: abort.signal })

    expect(await outcome).toMatchObject({ kind: EPodBootFailure.Cancelled })
    expect(fake.statusReads()).toBe(0)
  })
})
