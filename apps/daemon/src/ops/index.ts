import type { DaemonGroupFactory } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from './deps'
import { execGroup } from './exec'
import { filesGroup } from './files'
import { gitGroup } from './git'
import { mcpGroup } from './mcp'
import { previewsGroup } from './previews'
import { servicesGroup } from './services'
import { terminalGroup } from './terminal'
import { shellsGroup } from './shells'

export const daemonGroups = (deps: DaemonOpsDeps): readonly DaemonGroupFactory[] => [
  execGroup(deps),
  filesGroup(deps),
  gitGroup(deps),
  mcpGroup(deps),
  previewsGroup(deps),
  servicesGroup(deps),
  terminalGroup(deps),
  shellsGroup(deps),
]

export type { DaemonOpsDeps } from './deps'
