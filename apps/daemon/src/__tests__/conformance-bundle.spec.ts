import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'

import { describe, it } from 'bun:test'

import { describeRealDaemonConformance } from '../testing'

const bundle = join(import.meta.dir, '../../bin/daemon.js')

const bundleBuilt = (): boolean => {
  try {
    accessSync(bundle, constants.R_OK)
    return true
  } catch {
    return false
  }
}

if (bundleBuilt()) {
  describeRealDaemonConformance({ entry: bundle })
} else {
  describe('daemon bundle conformance', () => {
    it.skip('runs when bin/daemon.js has been built', () => {})
  })
}
