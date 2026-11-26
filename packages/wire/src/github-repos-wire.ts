import {
  gitBranchSchema,
  githubRepoSummarySchema,
  type GithubRepoSummary,
} from '@dltech/atlas-core'
import { z } from 'zod'

export { githubRepoSummarySchema, type GithubRepoSummary }

export const githubRepoListSchema = z.array(githubRepoSummarySchema)

export const githubBranchListSchema = z.array(gitBranchSchema)
