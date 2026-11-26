import { db } from '@dltech/atlas-db'
import {
  jobsControlPlaneOf,
  podSleeperOf,
  readPodStopBusy,
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
      parked: async (args) => {
        const session = await plane.readSession(args)
        return { parkedAt: session?.podParkedAt ?? null }
      },
      turnRunning: async (args) => (await readPodStopBusy({ plane, session: args.session })).busy,
      failPark: (args) => plane.failPodPark(args),
      release: async (args) => {
        const revoked = await plane.revoke({
          sessionId: args.sessionId,
          wantsHolder: false,
          epoch: args.epoch,
        })
        return 'ok' in revoked && revoked.ok
      },
      sleep: (args) => sleeper.sleep(args),
      wait: (args) => new Promise((resolve) => setTimeout(resolve, args.ms)),
    },
  }
}
