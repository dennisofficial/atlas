import { InMemoryControlStore } from '../src/memory'
import { describeControlPlaneConformance } from '../src/conformance'

let store = new InMemoryControlStore()

describeControlPlaneConformance({
  name: 'in-memory',
  makeStore: () => store,
  reset: async () => {
    store = new InMemoryControlStore()
  },
})
