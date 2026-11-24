import { db } from '@dltech/atlas-db'
import {
  jobsControlPlaneOf,
  podSleeperOf,
  readPodBusy,
  readPodsEnv,
  type PodSleepDeps,
} from '@dltech/atlas-pods'

export type PodSleepGraph = { deps: PodSleepDeps }

export function buildPodSleepGraph(): PodSleepGraph {
  const env = readPodsEnv()
  const plane = jobsControlPlaneOf({ db })
  const sleeper = podSleeperOf({ env, db })
  return {
    deps: {
      session: (args) => plane.readSession(args),
      power: async (args) => {
        const { lease, live } = await plane.currentLease(args)
        return { epoch: lease.epoch, wantsHolder: lease.wantsHolder, live }
      },
      busy: async (args) => (await readPodBusy({ plane, session: args.session })).busy,
      release: async (args) => {
        await plane.revoke({
          sessionId: args.sessionId,
          wantsHolder: false,
          epoch: args.epoch,
        })
      },
      sleep: (args) => sleeper.sleep(args),
      wait: (args) => new Promise((resolve) => setTimeout(resolve, args.ms)),
    },
  }
}
