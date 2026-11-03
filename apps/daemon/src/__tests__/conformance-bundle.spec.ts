import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, it } from 'bun:test'

import { describeRealDaemonConformance } from '../testing'

const bundle = join(import.meta.dir, '../../bin/daemon.js')

if (existsSync(bundle)) {
  describeRealDaemonConformance({ name: 'real-bundle', entry: bundle })
} else {
  describe('daemon bundle conformance', () => {
    it.skip('runs when bin/daemon.js has been built', () => {})
  })
}
