import { type DaemonGroupFactory, defineOp } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from '../deps'
import { readChangeSide } from './read'
import { scanChanges } from './scan'

export const changesGroup =
  (deps: DaemonOpsDeps): DaemonGroupFactory =>
  () => ({
    name: 'changes',
    ops: [
      defineOp({
        op: 'changes.scan',
        run: async ({ op }) => await scanChanges({ deps, op }),
      }),
      defineOp({
        op: 'changes.read',
        run: async ({ op }) => await readChangeSide({ deps, op }),
      }),
    ],
  })
