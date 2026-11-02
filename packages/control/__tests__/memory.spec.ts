import { InMemoryControlStore } from '../src/testing/memory'
import { describeControlPlaneConformance } from '../src/testing/conformance'

let store = new InMemoryControlStore()

describeControlPlaneConformance({
  name: 'in-memory',
  makeStore: () => store,
  reset: async () => {
    store = new InMemoryControlStore()
  },
})
