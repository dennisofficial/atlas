export type WorktreeRecord = {
  path: string
  branch: string | null
  isMain: boolean
  bare: boolean
  detached: boolean
  prunable: boolean
}

export type WorktreeListing = { repository: string; worktrees: readonly WorktreeRecord[] }

export type WorktreeEntryInfo = {
  path: string
  branch: string
  base?: string | undefined
  adopted?: boolean | undefined
  staleBase?: boolean | undefined
}

export type WorktreeState = {
  isClean: boolean
  changedPaths: readonly string[]
  changedCount: number
  unpushedCommits: number
  upstream: string | undefined
  base: string | undefined
  behind: number | undefined
}

export type WorktreeRemoval = { branch: string | undefined; branchDeleted: boolean | undefined }

export type PodWorktrees = {
  list(args: { cwd: string }): Promise<WorktreeListing>
  create(args: { cwd: string; name: string }): Promise<WorktreeEntryInfo>
  inspect(args: { cwd: string; base?: string | undefined }): Promise<WorktreeState>
  remove(args: {
    cwd: string
    path: string
    branch?: string | undefined
    force: boolean
  }): Promise<WorktreeRemoval>
}

const noWorktrees = (): (() => never) => () => {
  throw new Error('this pod has no worktrees')
}

export const EMPTY_WORKTREES: PodWorktrees = Object.freeze({
  list: async () => noWorktrees()(),
  create: async () => noWorktrees()(),
  inspect: async () => noWorktrees()(),
  remove: async () => noWorktrees()(),
})
