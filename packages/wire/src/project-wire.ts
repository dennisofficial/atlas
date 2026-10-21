import { z } from 'zod'

import { EShipBehavior } from './web/project-settings-wire'

export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/
export const GIT_BRANCH_PATTERN = /^(?!-)[A-Za-z0-9._/-]+$/
export const MAX_ADDITIONAL_REPOS = 10
export const MAX_PROJECT_NAME_LENGTH = 100
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500

export const githubRepoSchema = z.string().regex(GITHUB_REPO_PATTERN)
export const gitBranchSchema = z.string().regex(GIT_BRANCH_PATTERN)

export const projectRepoSchema = z.object({
  repo: githubRepoSchema,
  branch: gitBranchSchema.optional(),
})
export type ProjectRepo = z.infer<typeof projectRepoSchema>

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repo: githubRepoSchema.nullable(),
  baseBranch: gitBranchSchema.nullable(),
  additionalRepos: z.array(projectRepoSchema),
  description: z.string().default(''),
  shipBehavior: z.enum(EShipBehavior).default(EShipBehavior.OpenPullRequest),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type Project = z.infer<typeof projectSchema>

export const projectWorkspaceSchema = z.object({
  projectId: z.string().min(1),
  repo: githubRepoSchema.nullable(),
  baseBranch: gitBranchSchema.nullable(),
  additionalRepos: z.array(projectRepoSchema),
  githubToken: z.string().nullable(),
})
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>

export const githubCloneUrlOf = (repo: string): string => `https://github.com/${repo}.git`
