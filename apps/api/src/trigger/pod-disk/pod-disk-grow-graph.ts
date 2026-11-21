import type { ControlPlane } from '@dltech/atlas-control'

import { readAgentHostEnv } from '../../agent/config/env'
import { liveAgent37Client } from '../../agent/sandbox/agent37/agent37-client'
import { AGENT37_MAX_DISK_GB, agent37DiskOf } from '../../agent/sandbox/agent37/agent37-disk'
import { recordSandboxRunClose } from '../../agent/sandbox/sandbox-runs'
import { readPodBusy } from '../../api/platform/control/pod-busy'
import {
  runPodDiskGrow,
  type PodDiskGrowDeps,
  type PodDiskGrowSummary,
} from '../../api/platform/control/pod-disk-grow-run'
import { triggerControlPlane } from '../control-plane'
import { triggerLog } from '../trigger-logger'

export type PodDiskGrowGraph = { run(): Promise<PodDiskGrowSummary> }

const NOTHING_TO_DO: PodDiskGrowSummary = { checked: 0, grown: 0, waiting: 0 }

const busyOf = async (args: {
  plane: ControlPlane
  podSessionId: string
}): Promise<boolean | undefined> => {
  const session = await args.plane.readSession({ sessionId: args.podSessionId })
  if (session === undefined) return undefined
  if ((await readPodBusy({ plane: args.plane, session })).busy) return true
  const peers = await args.plane.podPeersPlaced({
    podSessionId: args.podSessionId,
    excludeSessionId: session.sessionId,
  })
  return peers > 0
}

const depsOf = (args: {
  plane: ControlPlane
  disk: ReturnType<typeof agent37DiskOf>
}): PodDiskGrowDeps => ({
  pods: () => args.disk.runningPods(),
  busy: (busyArgs) => busyOf({ plane: args.plane, podSessionId: busyArgs.podSessionId }),
  closeRun: async (closeArgs) => {
    await recordSandboxRunClose({ sessionId: closeArgs.podSessionId, sandboxStopped: false })
  },
  grow: (growArgs) => args.disk.grow(growArgs),
  held: async (heldArgs) =>
    (await args.plane.currentLease({ sessionId: heldArgs.podSessionId })).live,
  rewake: async (rewakeArgs) => {
    await args.plane.revoke({ sessionId: rewakeArgs.podSessionId, wantsHolder: true })
  },
  log: (line) => triggerLog.log(line),
})

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
