import type { ControlPlane } from '@dltech/atlas-control'

import { readAgentHostEnv } from '../../agent/config/env'
import { liveAgent37Client } from '../../agent/sandbox/agent37/agent37-client'
import { AGENT37_MAX_DISK_GB, agent37DiskOf } from '../../agent/sandbox/agent37/agent37-disk'
import { recordSandboxRunClose } from '../../agent/sandbox/sandbox-runs'
import { readPodRebootFacts } from '../../api/platform/control/pod-busy'
import {
  runPodDiskGrow,
  type PodDiskGrowDeps,
  type PodDiskSweepDeps,
  type PodDiskGrowSummary,
} from '../../api/platform/control/pod-disk-grow-run'
import { triggerControlPlane } from '../control-plane'
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
    log: (line) => triggerLog.log(line),
  }
  return { ...growDeps, pods: () => args.disk.runningPods() }
}

export function buildPodDiskGrowGraph(): PodDiskGrowGraph {
  const agent37 = readAgentHostEnv().agent37
  if (agent37 === null) return { run: async () => NOTHING_TO_DO }
  const plane = triggerControlPlane()
  const disk = agent37DiskOf({ client: liveAgent37Client({ apiKey: agent37.apiKey }) })
  return {
    run: async () =>
      await runPodDiskGrow({ deps: depsOf({ plane, disk }), maxGb: AGENT37_MAX_DISK_GB }),
  }
}
