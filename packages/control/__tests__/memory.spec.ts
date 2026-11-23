import type { PrStateRow } from '../src/port'
import type { RoutineRow } from '../src/port'
import { InMemoryControlStore } from '../src/testing/memory'
import {
  describeControlPlaneBlobs,
  describeControlPlaneChanges,
  describeControlPlaneClaimCommands,
  describeControlPlaneClaimNext,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlanePeerMessages,
  describeControlPlanePeers,
  describeControlPlanePresence,
  describeControlPlaneReads,
  describeControlPlaneRoutines,
  describeControlPlaneSessionBuckets,
  describeControlPlaneSessionArchive,
  describeControlPlaneSessions,
  describeControlPlaneSpawnedArchive,
  describeControlPlaneSessionTitles,
  describeControlPlaneViews,
  describeControlPlaneWakes,
  describeControlPlaneWorktreeChanges,
} from '../src/testing/conformance'

let store = new InMemoryControlStore()

const conformanceParams = {
  name: 'in-memory',
  makeStore: () => store,
  reset: async () => {
    store = new InMemoryControlStore()
  },
  wakes: async (sessionId: string) => store.wakeCount(sessionId),
  changes: async (sessionId: string) => store.changesOf(sessionId),
  seedPrState: async (row: PrStateRow) => store.setPrState(row),
  nextHostId: async () => store.nextHostId(),
  holdPresence: async (hostId: number) => {
    store.markHostPresent(hostId)
    return async () => store.markHostAbsent(hostId)
  },
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneSessionBuckets(conformanceParams)
describeControlPlaneSessionArchive(conformanceParams)
describeControlPlaneSpawnedArchive(conformanceParams)
describeControlPlanePeers(conformanceParams)
describeControlPlanePeerMessages(conformanceParams)
describeControlPlaneSessionTitles(conformanceParams)
describeControlPlaneReads(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneClaimNext(conformanceParams)
describeControlPlaneClaimCommands(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)
describeControlPlaneChanges(conformanceParams)
describeControlPlaneViews(conformanceParams)
describeControlPlaneWorktreeChanges(conformanceParams)

describeControlPlaneRoutines({
  ...conformanceParams,
  seedRoutine: async (row: RoutineRow) => store.setRoutine(row),
})

describeControlPlanePresence({
  ...conformanceParams,
  holdShared: async () => async () => undefined,
})
