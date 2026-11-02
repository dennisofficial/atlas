import { useTestDatabase } from '@dltech/atlas-db/testing'

import { describeControlPlaneConformance } from '../src/testing/conformance'
import { PostgresControlStore } from '../src/postgres'

const testDb = useTestDatabase()

describeControlPlaneConformance({
  name: 'postgres',
  makeStore: () => new PostgresControlStore(testDb().db),
  reset: async () => {},
})
