import type { ControlPlane } from '@dltech/atlas-control'
import { INBOX_KIND_EVENT, inboxEventPayloadOf } from '@dltech/atlas-core'
import {
  AGENT37_MAX_DISK_GB,
  agent37DiskOf,
  jobsControlPlaneOf,
  liveAgent37Client,
  POD_DISK_CEILING_LIFETIME_STEPS,
  POD_DISK_GROWN_LIFETIME_STEPS,
  podDiskCeilingNotice,
  podDiskGrownNotice,
  readPodRebootFacts,
  readPodsEnv,
  recordSandboxRunClose,
  runPodDiskGrow,
  type PodDiskGrowDeps,
  type PodDiskGrowSummary,
  type PodDiskSweepDeps,
} from '@dltech/atlas-pods'
import { db } from '@dltech/atlas-db'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import { serverObservability } from '@dltech/atlas-observability/node'
import { triggerLog } from '../trigger-logger'
import { capturePodDiskGrowStart } from './pod-disk-grow-analytics'

export type PodDiskGrowGraph = {
  analytics: ProductAnalytics
  run(): Promise<PodDiskGrowSummary>
}

const NOTHING_TO_DO: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0, nudged: 0 }

const versionOf = (env: Record<string, string | undefined>): string => {
  const version = env['ATLAS_APP_VERSION']
  return version === undefined || version === '' ? 'trigger' : version
}

const flushQuietly = async (analytics: ProductAnalytics): Promise<void> => {
  try {
    await analytics.flush()
  } catch {
    return
  }
}

const depsOf = (args: {
  plane: ControlPlane
  disk: ReturnType<typeof agent37DiskOf>
  analytics: ProductAnalytics
}): PodDiskSweepDeps => {
  const growDeps: PodDiskGrowDeps = {
    facts: async (factsArgs) => {
      const session = await args.plane.readSession({ sessionId: factsArgs.podSessionId })
      if (session === undefined) return undefined
      return await readPodRebootFacts({ plane: args.plane, session })
    },
    closeRun: async (closeArgs) => {
      await recordSandboxRunClose({ sessionId: closeArgs.podSessionId })
    },
    grow: (growArgs) => args.disk.grow(growArgs),
    recordDisk: async (recordArgs) => {
      await args.plane.recordPodDisk({
        sessionId: recordArgs.sessionId,
        diskGb: recordArgs.diskGb,
      })
    },
    started: async (startedArgs) => {
      await capturePodDiskGrowStart({
        analytics: args.analytics,
        plane: args.plane,
        sessionId: startedArgs.sessionId,
        diskGbFrom: startedArgs.diskGbFrom,
        diskGbTo: startedArgs.diskGbTo,
      })
    },
    notice: async (noticeArgs) => {
      await args.plane.post({
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
    ceilingNotice: async (ceilingArgs) => {
      await args.plane.post({
        sessionId: ceilingArgs.sessionId,
        kind: INBOX_KIND_EVENT,
        payload: inboxEventPayloadOf({
          event: {
            type: 'nudge',
            text: podDiskCeilingNotice({
              usedBytes: ceilingArgs.usedBytes,
              limitBytes: ceilingArgs.limitBytes,
              percent: ceilingArgs.percent,
            }),
            lifetimeSteps: POD_DISK_CEILING_LIFETIME_STEPS,
          },
        }),
      })
    },
    markNudged: (markArgs) => args.disk.markNudged(markArgs),
    log: (line) => triggerLog.log(line),
  }
  return { ...growDeps, pods: () => args.disk.runningPods() }
}

export function buildPodDiskGrowGraph(): PodDiskGrowGraph {
  const { analytics } = serverObservability({ version: versionOf(process.env), env: process.env })
  const agent37 = readPodsEnv().agent37
  if (agent37 === null) return { analytics, run: async () => NOTHING_TO_DO }
  const plane = jobsControlPlaneOf({ db })
  const disk = agent37DiskOf({ client: liveAgent37Client({ apiKey: agent37.apiKey }) })
  return {
    analytics,
    run: async () => {
      try {
        return await runPodDiskGrow({
          deps: depsOf({ plane, disk, analytics }),
          maxGb: AGENT37_MAX_DISK_GB,
        })
      } finally {
        await flushQuietly(analytics)
      }
    },
  }
}
