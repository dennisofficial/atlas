export enum EAppNav {
  Threads = 'threads',
  Activity = 'activity',
  Projects = 'projects',
}

export interface ShellDemoState {
  threadCardId?: string
  projectCardId?: string
  accountMenuOpen?: boolean
}
