import type { DaemonGroupFactory } from '../../engine'
import type { MemoryFileSystem } from '../memory-files'
import { fakeExecGroup } from './exec'
import { fakeFilesGroup } from './files'
import { fakeMcpGroup } from './mcp'

export const fakeDaemonGroups = (args: { fs: MemoryFileSystem }): readonly DaemonGroupFactory[] => [
  fakeExecGroup(args),
  fakeFilesGroup(args),
  fakeMcpGroup(),
]
