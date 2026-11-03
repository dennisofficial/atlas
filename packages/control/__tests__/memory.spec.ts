import { InMemoryControlStore } from '../src/testing/memory'
import {
  describeControlPlaneConformance,
  describeControlPlaneSessions,
} from '../src/testing/conformance'

let store = new InMemoryControlStore()

const conformanceParams = {
  name: 'in-memory',
  makeStore: () => store,
  reset: async () => {
    store = new InMemoryControlStore()
  },
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
