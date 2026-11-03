import type { DaemonGroupFactory } from '../../engine'
import type { MemoryFileSystem } from '../memory-files'
import { fakeExecGroup } from './exec'
import { fakeFilesGroup } from './files'
import { fakeServicesGroup } from './services'

export const fakeDaemonGroups = (args: { fs: MemoryFileSystem }): readonly DaemonGroupFactory[] => [
  fakeExecGroup(args),
  fakeFilesGroup(args),
  fakeServicesGroup(args),
]
