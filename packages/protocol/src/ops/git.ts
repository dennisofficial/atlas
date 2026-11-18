import { z } from 'zod'

import { okResultSchema } from './result'

const repoPathSchema = z.string().min(1)

export const gitBranchSchema = z
  .object({
    name: z.string().min(1),
    sha: z.string().min(1),
    pushRemote: z.string().min(1).nullable(),
  })
  .strict()

export const gitWorktreeSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().min(1).nullable(),
    sha: z.string().min(1),
    detached: z.boolean(),
  })
  .strict()

export const gitRemoteSchema = z
  .object({ name: z.string().min(1), url: z.string().min(1) })
  .strict()

export const branchSetSchema = z
  .object({
    repoPath: z.string().min(1),
    head: z.string().min(1).nullable(),
    branches: z.array(gitBranchSchema),
    worktrees: z.array(gitWorktreeSchema),
    remotes: z.array(gitRemoteSchema),
    checkouts: z.array(z.string().min(1)),
  })
  .strict()

export const gitRepoScanSchema = z.object({ repos: z.array(z.string().min(1)) }).strict()

export type GitBranch = z.infer<typeof gitBranchSchema>
export type GitWorktree = z.infer<typeof gitWorktreeSchema>
export type GitRemote = z.infer<typeof gitRemoteSchema>
export type BranchSet = z.infer<typeof branchSetSchema>
export type GitRepoScan = z.infer<typeof gitRepoScanSchema>

export const gitWatchOpSchema = z
  .object({ op: z.literal('git.watch'), repoPath: repoPathSchema })
  .strict()

export const gitUnwatchOpSchema = z
  .object({ op: z.literal('git.unwatch'), repoPath: repoPathSchema })
  .strict()

export const gitReadOpSchema = z
  .object({ op: z.literal('git.read'), repoPath: repoPathSchema })
  .strict()

export const gitDiscoverOpSchema = z
  .object({ op: z.literal('git.discover'), root: repoPathSchema })
  .strict()

export const gitOpSchemas = [
  gitWatchOpSchema,
  gitUnwatchOpSchema,
  gitReadOpSchema,
  gitDiscoverOpSchema,
] as const

export const gitResultSchemas = [
  okResultSchema({ op: 'git.watch', value: branchSetSchema }),
  okResultSchema({ op: 'git.unwatch', value: z.null() }),
  okResultSchema({ op: 'git.read', value: branchSetSchema }),
  okResultSchema({ op: 'git.discover', value: gitRepoScanSchema }),
] as const

export const gitBranchesEventSchema = z
  .object({ type: z.literal('git.branches'), set: branchSetSchema })
  .strict()

export const gitRepoFoundEventSchema = z
  .object({ type: z.literal('git.repo-found'), repoPath: z.string().min(1) })
  .strict()

export const gitEventSchemas = [gitBranchesEventSchema, gitRepoFoundEventSchema] as const

export type GitWatchOp = z.infer<typeof gitWatchOpSchema>
export type GitUnwatchOp = z.infer<typeof gitUnwatchOpSchema>
export type GitReadOp = z.infer<typeof gitReadOpSchema>
export type GitDiscoverOp = z.infer<typeof gitDiscoverOpSchema>
export type GitBranchesEvent = z.infer<typeof gitBranchesEventSchema>
export type GitRepoFoundEvent = z.infer<typeof gitRepoFoundEventSchema>
