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
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneClaims(conformanceParams)
describeControlPlaneBlobs(conformanceParams)
describeControlPlaneWakes(conformanceParams)

describeControlPlanePresence({
  ...conformanceParams,
  nextHostId: async () => store.nextHostId(),
  holdPresence: async (hostId) => {
    store.markHostPresent(hostId)
    return async () => store.markHostAbsent(hostId)
  },
  holdShared: async () => async () => undefined,
})
