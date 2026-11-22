import {
  INBOX_KIND_EVENT,
  inboxEventPayloadOf,
  podDiskGrowthOf,
  type PodRebootFacts,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { db } from '@dltech/atlas-db'
import {
  EPodDiskGrowOneOutcome,
  POD_DISK_GROW_ONE_TASK_ID,
  podDiskGrowOneIdempotencyKey,
  podDiskGrowOnePayloadSchema,
  type PodDiskGrowOneOutput,
  type PodDiskGrowOnePayload,
} from '@dltech/atlas-jobs/pod-disk-grow-one'
import {
  AGENT37_MAX_DISK_GB,
  EPodDiskGrowOutcome,
  agent37DiskOf,
  growPodDisk,
  POD_DISK_GROWN_LIFETIME_STEPS,
  jobsControlPlaneOf,
  liveAgent37Client,
  podDiskGrownNotice,
  readPodRebootFacts,
  readPodsEnv,
  recordSandboxRunClose,
  type PodDiskGrowDecision,
} from '@dltech/atlas-pods'
import { idempotencyKeys, tasks } from '@trigger.dev/sdk'
import { triggerLog } from '../trigger-logger'

export const POD_DISK_GROW_WAIT_SECONDS = 10
export const POD_DISK_GROW_MAX_WAITS = 360

export type PodDiskGrowOneDeps = {
  session(args: {
    sessionId: string
  }): Promise<{ sandboxInstanceId: string | null | undefined } | undefined>
  instance(args: { instanceId: string }): Promise<{ diskGb: number | undefined } | undefined>
  facts(args: { podSessionId: string }): Promise<PodRebootFacts | undefined>
  closeRun(args: { podSessionId: string }): Promise<void>
  grow(args: { instanceId: string; diskGb: number }): Promise<void>
  requeue(args: { payload: PodDiskGrowOnePayload; delaySeconds: number }): Promise<void>
  notice(args: { sessionId: string; diskGb: number }): Promise<void>
  log(line: string): void
}

const skipped = (reason: string): PodDiskGrowOneOutput => ({
  outcome: EPodDiskGrowOneOutcome.Skipped,
})

export const runPodDiskGrowOne = async (args: {
  payload: PodDiskGrowOnePayload
  deps: PodDiskGrowOneDeps
  maxGb: number
}): Promise<PodDiskGrowOneOutput> => {
  const { payload, deps } = args
  const reportedTargetGb = podDiskGrowthOf({
    usedBytes: payload.usedBytes,
    limitBytes: payload.limitBytes,
    maxGb: args.maxGb,
  })
  if (reportedTargetGb === undefined) {
    deps.log(`pod-disk-grow-one: ${payload.podSessionId} has no room to grow`)
    return skipped('nothing to grow')
  }
  const session = await deps.session({ sessionId: payload.podSessionId })
  const instanceId = session?.sandboxInstanceId
  if (instanceId === undefined || instanceId === null) {
    deps.log(`pod-disk-grow-one: no instance for ${payload.podSessionId}`)
    return skipped('no instance')
  }
  const instance = await deps.instance({ instanceId })
  if (instance === undefined) {
    deps.log(`pod-disk-grow-one: ${instanceId} is gone`)
    return skipped('no instance to grow')
  }
  if ((instance.diskGb ?? 0) >= reportedTargetGb) {
    deps.log(`pod-disk-grow-one: ${instanceId} already has ${instance.diskGb} GB`)
    return { outcome: EPodDiskGrowOneOutcome.Superseded }
  }
  const decision: PodDiskGrowDecision = await growPodDisk({
    deps: { facts: deps.facts, closeRun: deps.closeRun, grow: deps.grow, log: deps.log },
    pod: {
      podSessionId: payload.podSessionId,
      instanceId,
      usedBytes: payload.usedBytes,
      limitBytes: payload.limitBytes,
      sizeGb: instance.diskGb,
    },
    maxGb: args.maxGb,
  })
  if (decision.outcome === EPodDiskGrowOutcome.Waiting) {
    const waits = payload.waits ?? 0
    if (waits >= POD_DISK_GROW_MAX_WAITS) {
      deps.log(
        `pod-disk-grow-one: ${payload.podSessionId} waited ${waits} times, leaving it to the sweep`,
      )
      return { outcome: EPodDiskGrowOneOutcome.Waiting }
    }
    await deps.requeue({ payload, delaySeconds: POD_DISK_GROW_WAIT_SECONDS })
    deps.log(
      `pod-disk-grow-one: ${payload.podSessionId} waits ${POD_DISK_GROW_WAIT_SECONDS}s (${decision.reason ?? 'in use'})`,
    )
    return { outcome: EPodDiskGrowOneOutcome.Waiting }
  }
  if (decision.outcome !== EPodDiskGrowOutcome.Grown) {
    deps.log(`pod-disk-grow-one: left ${instanceId} alone: ${decision.reason ?? 'no growth'}`)
    return skipped(decision.reason ?? 'no growth')
  }
  const diskGb = decision.diskGb ?? reportedTargetGb
  await deps.notice({ sessionId: payload.podSessionId, diskGb })
  deps.log(`pod-disk-grow-one: grew ${instanceId} for ${payload.podSessionId} to ${diskGb} GB`)
  return { outcome: EPodDiskGrowOneOutcome.Grown, diskGb }
}

export type PodDiskGrowOneGraph = {
  run(payload: PodDiskGrowOnePayload): Promise<PodDiskGrowOneOutput>
}

export const requeuePodDiskGrowOne = async (args: {
  payload: PodDiskGrowOnePayload
  delaySeconds: number
}): Promise<void> => {
  const payload = podDiskGrowOnePayloadSchema.parse({
    ...args.payload,
    waits: (args.payload.waits ?? 0) + 1,
  })
  await tasks.trigger(POD_DISK_GROW_ONE_TASK_ID, payload, {
    idempotencyKey: await idempotencyKeys.create(
      podDiskGrowOneIdempotencyKey({
        payload,
        targetGb:
          podDiskGrowthOf({
            usedBytes: payload.usedBytes,
            limitBytes: payload.limitBytes,
            maxGb: AGENT37_MAX_DISK_GB,
          }) ?? 0,
      }),
      { scope: 'global' },
    ),
    delay: `${args.delaySeconds}s`,
  })
}

export function buildPodDiskGrowOneGraph(): PodDiskGrowOneGraph {
  const env = readPodsEnv()
  const agent37 = env.agent37
  if (agent37 === null) return { run: async () => skipped('agent37 is not configured') }
  const plane: ControlPlane = jobsControlPlaneOf({ db })
  const client = liveAgent37Client({ apiKey: agent37.apiKey })
  const disk = agent37DiskOf({ client })
  const deps: PodDiskGrowOneDeps = {
    session: async (sessionArgs) => await plane.readSession({ sessionId: sessionArgs.sessionId }),
    instance: async (instanceArgs) => {
      const instance = await client.get({ id: instanceArgs.instanceId })
      return { diskGb: instance.resources?.disk }
    },
    facts: async (factsArgs) => {
      const session = await plane.readSession({ sessionId: factsArgs.podSessionId })
      if (session === undefined) return undefined
      return await readPodRebootFacts({ plane, session })
    },
    closeRun: async (closeArgs) => {
      await recordSandboxRunClose({ sessionId: closeArgs.podSessionId, sandboxStopped: true })
    },
    grow: (growArgs) => disk.grow(growArgs),
    requeue: requeuePodDiskGrowOne,
    notice: async (noticeArgs) => {
      await plane.post({
        sessionId: noticeArgs.sessionId,
        kind: INBOX_KIND_EVENT,
        payload: inboxEventPayloadOf({
          event: {
            type: 'nudge',
            text: podDiskGrownNotice(noticeArgs.diskGb),
            lifetimeSteps: POD_DISK_GROWN_LIFETIME_STEPS,
          },
        }),
      })
    },
    log: (line) => triggerLog.log(line),
  }
  return {
    run: async (payload) => await runPodDiskGrowOne({ payload, deps, maxGb: AGENT37_MAX_DISK_GB }),
  }
}
