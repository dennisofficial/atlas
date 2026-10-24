import { z } from 'zod'

import { gitBranchSchema, githubRepoSchema } from './project-wire'

export const githubRepoSummarySchema = z.object({
  fullName: githubRepoSchema,
  isPrivate: z.boolean(),
  defaultBranch: gitBranchSchema,
  pushedAt: z.string().nullable(),
})
export type GithubRepoSummary = z.infer<typeof githubRepoSummarySchema>

export const githubRepoListSchema = z.array(githubRepoSummarySchema)

export const githubBranchListSchema = z.array(gitBranchSchema)
