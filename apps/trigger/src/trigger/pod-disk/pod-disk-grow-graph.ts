import type { ControlPlane } from '@dltech/atlas-control'
import { INBOX_KIND_EVENT, inboxEventPayloadOf } from '@dltech/atlas-core'
import {
  AGENT37_MAX_DISK_GB,
  agent37DiskOf,
  jobsControlPlaneOf,
  liveAgent37Client,
  POD_DISK_GROWN_LIFETIME_STEPS,
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
import { triggerLog } from '../trigger-logger'

export type PodDiskGrowGraph = { run(): Promise<PodDiskGrowSummary> }

const NOTHING_TO_DO: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0 }

const depsOf = (args: {
  plane: ControlPlane
  disk: ReturnType<typeof agent37DiskOf>
}): PodDiskSweepDeps => {
  const growDeps: PodDiskGrowDeps = {
    facts: async (factsArgs) => {
      const session = await args.plane.readSession({ sessionId: factsArgs.podSessionId })
      if (session === undefined) return undefined
      return await readPodRebootFacts({ plane: args.plane, session })
    },
    closeRun: async (closeArgs) => {
      await recordSandboxRunClose({ sessionId: closeArgs.podSessionId, sandboxStopped: true })
    },
    grow: (growArgs) => args.disk.grow(growArgs),
    recordDisk: async (recordArgs) => {
      await args.plane.recordPodDisk({
        sessionId: recordArgs.sessionId,
        diskGb: recordArgs.diskGb,
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
    log: (line) => triggerLog.log(line),
  }
  return { ...growDeps, pods: () => args.disk.runningPods() }
}

export function buildPodDiskGrowGraph(): PodDiskGrowGraph {
  const agent37 = readPodsEnv().agent37
  if (agent37 === null) return { run: async () => NOTHING_TO_DO }
  const plane = jobsControlPlaneOf({ db })
  const disk = agent37DiskOf({ client: liveAgent37Client({ apiKey: agent37.apiKey }) })
  return {
    run: async () =>
      await runPodDiskGrow({ deps: depsOf({ plane, disk }), maxGb: AGENT37_MAX_DISK_GB }),
  }
}
