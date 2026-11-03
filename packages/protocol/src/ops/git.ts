import { z } from 'zod'

import { okResultSchema } from './result'

const repoPathSchema = z.string().min(1)

export const gitBranchSchema = z
  .object({ name: z.string().min(1), sha: z.string().min(1) })
  .strict()

export const gitWorktreeSchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().min(1).nullable(),
    sha: z.string().min(1),
    detached: z.boolean(),
  })
  .strict()

export const branchSetSchema = z
  .object({
    repoPath: z.string().min(1),
    head: z.string().min(1).nullable(),
    branches: z.array(gitBranchSchema),
    worktrees: z.array(gitWorktreeSchema),
  })
  .strict()

export type GitBranch = z.infer<typeof gitBranchSchema>
export type GitWorktree = z.infer<typeof gitWorktreeSchema>
export type BranchSet = z.infer<typeof branchSetSchema>

export const gitWatchOpSchema = z
  .object({ op: z.literal('git.watch'), repoPath: repoPathSchema })
  .strict()

export const gitUnwatchOpSchema = z
  .object({ op: z.literal('git.unwatch'), repoPath: repoPathSchema })
  .strict()

export const gitReadOpSchema = z
  .object({ op: z.literal('git.read'), repoPath: repoPathSchema })
  .strict()

export const gitOpSchemas = [gitWatchOpSchema, gitUnwatchOpSchema, gitReadOpSchema] as const

export const gitResultSchemas = [
  okResultSchema({ op: 'git.watch', value: branchSetSchema }),
  okResultSchema({ op: 'git.unwatch', value: z.null() }),
  okResultSchema({ op: 'git.read', value: branchSetSchema }),
] as const

export const gitBranchesEventSchema = z
  .object({ type: z.literal('git.branches'), set: branchSetSchema })
  .strict()

export const gitEventSchemas = [gitBranchesEventSchema] as const

export type GitWatchOp = z.infer<typeof gitWatchOpSchema>
export type GitUnwatchOp = z.infer<typeof gitUnwatchOpSchema>
export type GitReadOp = z.infer<typeof gitReadOpSchema>
export type GitBranchesEvent = z.infer<typeof gitBranchesEventSchema>
