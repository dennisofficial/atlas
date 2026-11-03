import type { DaemonGroupFactory } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from './deps'
import { execGroup } from './exec'
import { filesGroup } from './files'

export const daemonGroups = (deps: DaemonOpsDeps): readonly DaemonGroupFactory[] => [
  execGroup(deps),
  filesGroup(deps),
]

export type { DaemonOpsDeps } from './deps'
