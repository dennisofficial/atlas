import { InMemoryControlStore } from '../src/testing/memory'
import {
  describeControlPlaneBlobs,
  describeControlPlaneChanges,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlanePresence,
  describeControlPlaneReads,
  describeControlPlaneSessions,
  describeControlPlaneWakes,
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
  nextHostId: async () => store.nextHostId(),
  holdPresence: async (hostId: number) => {
    store.markHostPresent(hostId)
    return async () => store.markHostAbsent(hostId)
  },
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneReads(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)
describeControlPlaneChanges(conformanceParams)

describeControlPlanePresence({
  ...conformanceParams,
  holdShared: async () => async () => undefined,
})
