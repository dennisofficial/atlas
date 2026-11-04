import { useTestDatabase } from '@dltech/atlas-db/testing'

import {
  describeControlPlaneClaims,
  describeControlPlaneConformance,
  describeControlPlaneSessions,
} from '../src/testing/conformance'
import { PostgresControlStore } from '../src/postgres'

const testDb = useTestDatabase()

const conformanceParams = {
  name: 'postgres',
  makeStore: () => new PostgresControlStore(testDb().db),
  reset: async () => {},
}

describeControlPlaneConformance(conformanceParams)
describeControlPlaneSessions(conformanceParams)
describeControlPlaneClaims(conformanceParams)
