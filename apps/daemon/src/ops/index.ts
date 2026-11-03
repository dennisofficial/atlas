import type { DaemonGroupFactory } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from './deps'
import { execGroup } from './exec'
import { filesGroup } from './files'
import { mcpGroup } from './mcp'
import { shellsGroup } from './shells'

export const daemonGroups = (deps: DaemonOpsDeps): readonly DaemonGroupFactory[] => [
  execGroup(deps),
  filesGroup(deps),
  mcpGroup(deps),
  shellsGroup(deps),
]

export type { DaemonOpsDeps } from './deps'
