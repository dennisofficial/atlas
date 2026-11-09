import type { DaemonGroupFactory } from '../../engine'
import type { MemoryFileSystem } from '../memory-files'
import { fakeExecGroup } from './exec'
import { fakeFilesGroup } from './files'
import { fakeGitGroup } from './git'
import { fakeMcpGroup } from './mcp'
import { fakePreviewsGroup } from './previews'
import { fakeServicesGroup } from './services'
import { fakeTerminalGroup } from './terminal'
import { fakeShellsGroup } from './shells'

export const fakeDaemonGroups = (args: { fs: MemoryFileSystem }): readonly DaemonGroupFactory[] => [
  fakeExecGroup(args),
  fakeFilesGroup(args),
  fakeGitGroup(),
  fakeMcpGroup(),
  fakePreviewsGroup(),
  fakeServicesGroup(args),
  fakeTerminalGroup(),
  fakeShellsGroup(),
]
