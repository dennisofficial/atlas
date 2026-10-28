import {
  EBootStep,
  EBootStepState,
  EPodState,
  EThreadStreamFrame,
  type PodStatus,
  type RecordedBootStep,
} from '@dltech/atlas-wire'

import type { PodApiClient } from './api-pod-client'
import { EPodBootFailure, notConfiguredOf, PodBootError } from './api-pod-errors'
import { cloudCall, toCloudError } from './api-trpc-client'
import { isCloudUnavailable } from './cloud-transport'
import { resolveSseClock, type SsePullRequestClock } from './sse-pull-request-clock'

export const BOOT_STEP_LABELS: Readonly<Record<EBootStep, string>> = {
  [EBootStep.Provision]: 'starting the pod',
  [EBootStep.Serve]: 'starting the session server',
  [EBootStep.Clone]: 'cloning the project',
  [EBootStep.Context]: 'loading context',
  [EBootStep.Settings]: 'applying settings',
  [EBootStep.Agent]: 'starting the agent',
}

export type PodWaitOptions = {
  timeoutMs: number
  pollMs: number
  clock?: SsePullRequestClock | undefined
  onStep?: ((label: string) => void) | undefined
  signal?: AbortSignal | undefined
}

export type PodWaitArgs = PodWaitOptions & {
  api: Pick<PodApiClient, 'threadPod' | 'threadEvents'>
  threadId: string
}

export enum EPodVerdict {
  Running = 'running',
  Failed = 'failed',
  Waiting = 'waiting',
}

export type PodVerdict =
  | { kind: EPodVerdict.Running }
  | { kind: EPodVerdict.Failed; error: Error }
  | { kind: EPodVerdict.Waiting }

const WAITING: PodVerdict = { kind: EPodVerdict.Waiting }

const failedStepOf = (step: RecordedBootStep): Error => {
  const reason = step.error ?? 'it reported an error'
  if (step.gap !== undefined) return notConfiguredOf({ error: reason, gap: step.gap })
  return new PodBootError({
    kind: EPodBootFailure.Failed,
    message: `the pod failed while ${BOOT_STEP_LABELS[step.step]}: ${reason}`,
  })
}

export const verdictOf = (status: PodStatus): PodVerdict => {
  if (status.state === EPodState.Running) return { kind: EPodVerdict.Running }
  const broken = status.steps.find((step) => step.state === EBootStepState.Error)
  if (broken !== undefined) return { kind: EPodVerdict.Failed, error: failedStepOf(broken) }
  if (status.state === EPodState.Failed) {
    return {
      kind: EPodVerdict.Failed,
      error: new PodBootError({
        kind: EPodBootFailure.Failed,
        message: 'the pod failed to start',
      }),
    }
  }
  return WAITING
}

export const stepLabelOf = (steps: readonly RecordedBootStep[]): string | undefined => {
  const current = steps.findLast((step) => step.state === EBootStepState.Running) ?? steps.at(-1)
  return current === undefined ? undefined : BOOT_STEP_LABELS[current.step]
}

export const waitForPodRunning = (args: PodWaitArgs): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const { threadId, pollMs } = args
    const clock = resolveSseClock(args.clock)
    const timers = new Set<ReturnType<typeof setTimeout>>()
    let subscription: { unsubscribe(): void } | undefined
    let settled = false
    let reading = false
    let reread = false
    let polling = false
    let streamGeneration = 0
    let lastLabel: string | undefined

    const finish = (failure: Error | undefined): void => {
      if (settled) return
      settled = true
      for (const timer of timers) clock.clearTimeoutFn(timer)
      timers.clear()
      args.signal?.removeEventListener('abort', handleAbort)
      subscription?.unsubscribe()
      if (failure === undefined) resolve()
      else reject(failure)
    }

    function handleAbort(): void {
      finish(
        new PodBootError({
          kind: EPodBootFailure.Cancelled,
          message: 'waiting for the pod was cancelled',
        }),
      )
    }

    const later = (delayMs: number, run: () => void): void => {
      if (settled) return
      const timer = clock.setTimeoutFn(() => {
        timers.delete(timer)
        if (!settled) run()
      }, delayMs)
      timers.add(timer)
    }

    const announce = (status: PodStatus): void => {
      const label = stepLabelOf(status.steps)
      if (label === undefined || label === lastLabel) return
      lastLabel = label
      args.onStep?.(label)
    }

    const readOnce = async (): Promise<void> => {
      const status = await cloudCall(args.api.threadPod.status.query({ threadId }))
      if (settled) return
      announce(status)
      const verdict = verdictOf(status)
      if (verdict.kind === EPodVerdict.Running) finish(undefined)
      if (verdict.kind === EPodVerdict.Failed) finish(verdict.error)
    }

    const refresh = async (): Promise<void> => {
      if (reading) {
        reread = true
        return
      }
      reading = true
      try {
        do {
          reread = false
          await readOnce()
        } while (reread && !settled)
      } catch (failure) {
        const cloudFailure = toCloudError(failure)
        if (isCloudUnavailable(cloudFailure)) later(pollMs, () => void refresh())
        else finish(cloudFailure)
      } finally {
        reading = false
      }
    }

    const poll = (): void => later(pollMs, () => void refresh().then(poll))

    const fallBackToPolling = (): void => {
      streamGeneration += 1
      subscription?.unsubscribe()
      subscription = undefined
      if (polling) return
      polling = true
      poll()
    }

    const endStream = (): void => {
      streamGeneration += 1
      subscription?.unsubscribe()
      subscription = undefined
      void refresh()
      later(pollMs, openStream)
    }

    function openStream(): void {
      if (settled || polling) return
      streamGeneration += 1
      const mine = streamGeneration
      const whileCurrent =
        <A extends unknown[]>(handler: (...handlerArgs: A) => void) =>
        (...handlerArgs: A): void => {
          if (!settled && mine === streamGeneration) handler(...handlerArgs)
        }
      try {
        subscription = args.api.threadEvents.stream.subscribe(
          { threadId },
          {
            onStarted: whileCurrent(() => void refresh()),
            onData: whileCurrent((frame) => {
              if (frame.type === EThreadStreamFrame.Pod) void refresh()
            }),
            onError: whileCurrent(fallBackToPolling),
            onComplete: whileCurrent(endStream),
            onStopped: whileCurrent(endStream),
          },
        )
      } catch {
        fallBackToPolling()
      }
    }

    if (args.signal?.aborted === true) return handleAbort()
    args.signal?.addEventListener('abort', handleAbort)
    later(args.timeoutMs, () =>
      finish(
        new PodBootError({
          kind: EPodBootFailure.TimedOut,
          message: `the pod did not become ready within ${Math.round(args.timeoutMs / 1000)}s`,
        }),
      ),
    )
    void refresh().then(openStream)
  })
