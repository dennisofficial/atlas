import type { DaemonGroupFactory } from '@dltech/atlas-protocol/engine'

import type { DaemonOpsDeps } from './deps'
import { changesGroup } from './changes'
import { execGroup } from './exec'
import { filesGroup } from './files'
import { gitGroup } from './git'
import { mcpGroup } from './mcp'
import { previewsGroup } from './previews'
import { servicesGroup } from './services'
import { terminalGroup } from './terminal'
import { shellsGroup } from './shells'
import { watchGroup } from './watch'

export const daemonGroups = (deps: DaemonOpsDeps): readonly DaemonGroupFactory[] => [
  changesGroup(deps),
  execGroup(deps),
  filesGroup(deps),
  gitGroup(deps),
  mcpGroup(deps),
  previewsGroup(deps),
  servicesGroup(deps),
  terminalGroup(deps),
  shellsGroup(deps),
  watchGroup,
]

export type { DaemonOpsDeps } from './deps'
