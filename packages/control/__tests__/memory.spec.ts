import { InMemoryControlStore } from '../src/testing/memory'
import {
  describeControlPlaneBlobs,
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlanePresence,
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
  nextHostId: async () => store.nextHostId(),
  holdPresence: async (hostId: number) => {
    store.markHostPresent(hostId)
    return async () => store.markHostAbsent(hostId)
  },
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)

describeControlPlanePresence({
  ...conformanceParams,
  holdShared: async () => async () => undefined,
})
