import { z } from 'zod'

export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/
export const GIT_BRANCH_PATTERN = /^(?!-)[A-Za-z0-9._/-]+$/

export const githubRepoSchema = z.string().regex(GITHUB_REPO_PATTERN)
export const gitBranchSchema = z.string().regex(GIT_BRANCH_PATTERN)

export enum ERepoTracking {
  App = 'app',
  User = 'user',
  Polled = 'polled',
}

export const githubRepoSummarySchema = z.object({
  fullName: githubRepoSchema,
  isPrivate: z.boolean(),
  defaultBranch: gitBranchSchema,
  pushedAt: z.string().nullable(),
})
export type GithubRepoSummary = z.infer<typeof githubRepoSummarySchema>

export enum ERepoTreeEntryKind {
  File = 'file',
  Folder = 'folder',
}

export const projectRepoTreeSchema = z.object({
  entries: z.array(z.object({ path: z.string(), kind: z.enum(ERepoTreeEntryKind) })),
  truncated: z.boolean(),
})
export type ProjectRepoTree = z.infer<typeof projectRepoTreeSchema>
