import type { RestoredWorkspace, WorkspaceManifest, WorkspaceTree } from './manifest'
import type { Journal } from './restore-files'

export enum EWorkspaceRestoreMode {
  Cloud = 'cloud',
  Host = 'host',
}

export enum ETreeAction {
  InPlace = 'in-place',
  Create = 'create',
  Reuse = 'reuse',
}

export type RestoreArgs = {
  archivePath: string
  destination: string
  mode: EWorkspaceRestoreMode
  suffix?: (() => string) | undefined
  beforeSweep?: ((path: string) => Promise<void>) | undefined
}

export type IncomingRef = { ref: string; sha: string; symref: string }

export type PlannedTree = {
  tree: WorkspaceTree
  path: string
  action: ETreeAction
  suffix: string | null
}

export type DestinationPlan = {
  anchor: string
  fresh: boolean
  repoCwd: string
  registered: string[]
  trees: PlannedTree[]
}

export type WorkspaceRestoration = {
  restored: RestoredWorkspace
  commit: () => Promise<void>
  rollback: () => Promise<void>
}

export type RestoreContext = {
  extracted: string
  manifest: WorkspaceManifest
  plan: DestinationPlan
  journal: Journal
  suffix: () => string
  commonDir: string
  beforeSweep: ((path: string) => Promise<void>) | undefined
}

export type TreeOutcome = {
  planned: PlannedTree
  branch: string | null
  renamedFrom: string | null
}
