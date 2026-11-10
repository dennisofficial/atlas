export enum EAppNav {
  Threads = 'threads',
  Routines = 'routines',
  Projects = 'projects',
}

export interface ShellDemoState {
  threadCardId?: string
  projectCardId?: string
  accountMenuOpen?: boolean
  archivedThreadIds?: string[]
  archivedBucketOpen?: boolean
  collapsed?: boolean
}
