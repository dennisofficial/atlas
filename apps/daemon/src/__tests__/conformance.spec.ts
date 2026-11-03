import { join } from 'node:path'

import { describeRealDaemonConformance } from '../testing'

describeRealDaemonConformance({ name: 'real-source', entry: join(import.meta.dir, '../index.ts') })
