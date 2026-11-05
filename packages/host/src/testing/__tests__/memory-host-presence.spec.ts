import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'

import { createMemoryHostPresence } from '../memory-host-presence'
import { describeHostPresence } from '../host-presence-suite'

describeHostPresence({
  name: 'in-memory',
  make: () => {
    const store = new InMemoryControlStore()
    const presence = createMemoryHostPresence({ store })
    return {
      presence,
      plane: new ControlPlane({ store }),
      lose: async () => presence.lose(),
    }
  },
})
