import {
  ERepoTracking,
  GIT_BRANCH_PATTERN,
  GITHUB_REPO_PATTERN,
  gitBranchSchema,
  githubRepoSchema,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { EShipBehavior } from './web/project-settings-wire'

export { ERepoTracking, GIT_BRANCH_PATTERN, GITHUB_REPO_PATTERN, gitBranchSchema, githubRepoSchema }
export const MAX_ADDITIONAL_REPOS = 10
export const MAX_PROJECT_NAME_LENGTH = 100
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500

export const projectRepoSchema = z.object({
  repo: githubRepoSchema,
  branch: gitBranchSchema.optional(),
})
export type ProjectRepo = z.infer<typeof projectRepoSchema>

export const projectRepoTrackingSchema = projectRepoSchema.extend({
  tracking: z.enum(ERepoTracking),
})
export type ProjectRepoTracking = z.infer<typeof projectRepoTrackingSchema>

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  repo: githubRepoSchema.nullable(),
  baseBranch: gitBranchSchema.nullable(),
  additionalRepos: z.array(projectRepoSchema),
  groupId: z.string().nullable(),
  repos: z.array(projectRepoTrackingSchema).optional(),
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
  setupScript: z.string().nullish(),
})
export type ProjectWorkspace = z.infer<typeof projectWorkspaceSchema>

export const githubCloneUrlOf = (repo: string): string => `https://github.com/${repo}.git`

export const projectRepoInputSchema = z.strictObject({
  repo: githubRepoSchema,
  branch: gitBranchSchema.optional(),
})

export const projectSaveSchema = z.strictObject({
  name: z.string().min(1).max(MAX_PROJECT_NAME_LENGTH),
  repo: githubRepoSchema.nullable(),
  baseBranch: gitBranchSchema.nullable(),
  additionalRepos: z.array(projectRepoInputSchema).max(MAX_ADDITIONAL_REPOS),
  description: z.string().max(MAX_PROJECT_DESCRIPTION_LENGTH).optional(),
  shipBehavior: z.enum(EShipBehavior).optional(),
})
export type ProjectSave = z.infer<typeof projectSaveSchema>

export const projectIdInputSchema = z.strictObject({ projectId: z.string().min(1) })
export type ProjectIdInput = z.infer<typeof projectIdInputSchema>

export const projectUpdateSchema = projectSaveSchema.extend(projectIdInputSchema.shape)
export type ProjectUpdate = z.infer<typeof projectUpdateSchema>

export const projectListSchema = z.array(projectSchema)
