export enum EAppNav {
  Threads = 'threads',
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
