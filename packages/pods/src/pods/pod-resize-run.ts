import type { ControlSessionRow } from '@dltech/atlas-control'
import {
  EPodResizeNotice,
  type PodBusy,
  type PodResizeNotice,
  type PodShape,
} from '@dltech/atlas-core'

import { AGENT37_RESIZE_BUDGET_MS } from '../sandbox/agent37/agent37-resize'
import type { PodResizeOutcome } from '../sandbox/sandbox-provider'
import {
  EPodResizeOutcome,
  type PodResizeOutput,
  type PodResizePayload,
} from '@dltech/atlas-jobs/pod-resize'
import {
  announceResize,
  POD_RESIZE_STARTED_WAIT_MS,
  type PodResizeInterruptDeps,
} from './pod-resize-interrupt'

export type PodResizeSession = Pick<
  ControlSessionRow,
  | 'sessionId'
  | 'podSessionId'
  | 'podSizeGeneration'
  | 'podDesiredVcpus'
  | 'podDesiredMemoryGb'
  | 'podDesiredDiskGb'
  | 'archivedAt'
>

export type PodPlacedTarget = { sessionId: string; archivedAt: string | null }

export type PodResizeLease = { live: boolean; epoch: number }

export type PodResizeDeps = PodResizeInterruptDeps & {
  session(args: { sessionId: string }): Promise<PodResizeSession | undefined>
  resize(args: {
    sandboxSessionId: string
    shape: PodShape
    diskGb?: number | undefined
  }): Promise<PodResizeOutcome>
  placed(args: { podSessionId: string }): Promise<readonly PodPlacedTarget[]>
  notice(args: { sessionId: string; notice: PodResizeNotice }): Promise<unknown>
  wake(args: { sessionId: string; epoch: number }): Promise<unknown>
  lease(args: { sessionId: string }): Promise<PodResizeLease>
  recordApplied(args: {
    sessionId: string
    vcpus: number
    memoryGb: number
    generation: number
  }): Promise<unknown>
  recordFailed(args: { sessionId: string; generation: number; error: string }): Promise<unknown>
  recordWaiting(args: { sessionId: string; generation: number; since: string }): Promise<boolean>
  claimWait(args: { sessionId: string; generation: number; since: string }): Promise<boolean>
  busy(args: { sessionId: string }): Promise<PodBusy>
  now(): string
}

export const NO_SANDBOX_TO_RESIZE = 'No sandbox to resize'

const POD_RESIZE_DURATION_MARGIN_MS = 5 * 60_000

export const POD_RESIZE_MAX_DURATION_SECONDS = Math.ceil(
  (POD_RESIZE_STARTED_WAIT_MS + AGENT37_RESIZE_BUDGET_MS + POD_RESIZE_DURATION_MARGIN_MS) / 1000,
)

export const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

export const runPodResize = async (args: {
  payload: PodResizePayload
  deps: PodResizeDeps
}): Promise<PodResizeOutput> => {
  const { payload, deps } = args
  const session = await deps.session({ sessionId: payload.sessionId })
  if (session === undefined || session.podSizeGeneration !== payload.generation) {
    return { outcome: EPodResizeOutcome.Superseded }
  }
  const held = await holdForIdle({ payload, deps })
  if (held !== undefined) return { outcome: held }
  const shape = {
    vcpus: session.podDesiredVcpus ?? payload.vcpus,
    memoryGb: session.podDesiredMemoryGb ?? payload.memoryGb,
  }
  const sandboxSessionId = session.podSessionId ?? session.sessionId
  const diskGb = session.podDesiredDiskGb ?? payload.diskGb
  const targets = await deps.placed({ podSessionId: sandboxSessionId })
  const leases = await leasesOf({
    deps,
    sessionIds: [...new Set([sandboxSessionId, ...targets.map((target) => target.sessionId)])],
  })
  const live = (sessionId: string): boolean => leases.get(sessionId)?.live === true
  await announceResize({
    deps,
    sessionIds: targets.map((target) => target.sessionId).filter(live),
    shape,
    generation: payload.generation,
  })
  const superseded = async (): Promise<boolean> =>
    (await deps.session({ sessionId: payload.sessionId }))?.podSizeGeneration !== payload.generation
  const notice = (args: { outcome: EPodResizeNotice; error?: string }): Promise<unknown[]> =>
    postNotices({
      deps,
      targets: targets.filter((target) => target.archivedAt === null),
      notice: { ...shape, generation: payload.generation, ...args },
    })
  let resized: PodResizeOutcome
  try {
    resized = await deps.resize({
      sandboxSessionId,
      shape,
      ...(diskGb === undefined ? {} : { diskGb }),
    })
  } catch (failure) {
    if (await superseded()) return { outcome: EPodResizeOutcome.Superseded }
    await notice({ outcome: EPodResizeNotice.Failed, error: failureText(failure) })
    throw failure
  }
  if (resized === 'absent') {
    // nothing will ever apply this size: say so rather than claim it was stored
    await deps.recordFailed({
      sessionId: sandboxSessionId,
      generation: payload.generation,
      error: NO_SANDBOX_TO_RESIZE,
    })
    if (await superseded()) return { outcome: EPodResizeOutcome.Superseded }
    await notice({ outcome: EPodResizeNotice.Failed, error: NO_SANDBOX_TO_RESIZE })
    return { outcome: EPodResizeOutcome.Failed }
  }
  // A restart has already recreated the container at the new shape, so the size is applied before
  // anything wakes the pod again: the re-wake below can fail, be claimed elsewhere, or never report
  // the instance's cpu, and the generation this resize was asked for is known here either way.
  if (resized === 'restarted' || resized === 'unchanged') {
    await deps.recordApplied({
      sessionId: sandboxSessionId,
      vcpus: shape.vcpus,
      memoryGb: shape.memoryGb,
      generation: payload.generation,
    })
  }
  if (await superseded()) return { outcome: EPodResizeOutcome.Superseded }
  await notice({ outcome: EPodResizeNotice.Applied })
  if (resized === 'unchanged') return { outcome: EPodResizeOutcome.Applied }
  if (resized === 'stored' && !live(sandboxSessionId)) {
    return { outcome: EPodResizeOutcome.Deferred }
  }
  if (session.archivedAt !== null || live(sandboxSessionId)) {
    return { outcome: EPodResizeOutcome.Applied }
  }
  await deps.wake({
    sessionId: sandboxSessionId,
    epoch: epochOf({ leases, sessionId: sandboxSessionId }),
  })
  return { outcome: EPodResizeOutcome.Applied }
}

const holdForIdle = async (args: {
  payload: PodResizePayload
  deps: PodResizeDeps
}): Promise<EPodResizeOutcome | undefined> => {
  const { payload, deps } = args
  const wait = { sessionId: payload.sessionId, generation: payload.generation }
  if (payload.waitedSince !== undefined) {
    const claimed = await deps.claimWait({ ...wait, since: payload.waitedSince })
    if (!claimed) return EPodResizeOutcome.Superseded
  }
  if (payload.whenIdle !== true) return undefined
  const busy = async (): Promise<boolean> =>
    (await deps.busy({ sessionId: payload.sessionId })).busy
  if (!(await busy())) return undefined
  const since = deps.now()
  if (!(await deps.recordWaiting({ ...wait, since }))) return EPodResizeOutcome.Superseded
  if (await busy()) return EPodResizeOutcome.Waiting
  const claimed = await deps.claimWait({ ...wait, since })
  return claimed ? undefined : EPodResizeOutcome.Superseded
}

const leasesOf = async (args: {
  deps: PodResizeDeps
  sessionIds: readonly string[]
}): Promise<Map<string, PodResizeLease>> => {
  const leases = new Map<string, PodResizeLease>()
  for (const sessionId of args.sessionIds) {
    leases.set(sessionId, await args.deps.lease({ sessionId }))
  }
  return leases
}

const epochOf = (args: {
  leases: ReadonlyMap<string, PodResizeLease>
  sessionId: string
}): number => args.leases.get(args.sessionId)?.epoch ?? 0

const postNotices = async (args: {
  deps: PodResizeDeps
  targets: readonly PodPlacedTarget[]
  notice: PodResizeNotice
}): Promise<unknown[]> => {
  const posted: unknown[] = []
  for (const target of args.targets) {
    posted.push(await args.deps.notice({ sessionId: target.sessionId, notice: args.notice }))
  }
  return posted
}
