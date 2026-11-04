import { z } from 'zod'

const GITHUB_REPO_PATTERN = /^[A-Za-z0-9-]+\/(?!\.+$)[A-Za-z0-9_.-]+$/
const GIT_BRANCH_PATTERN = /^(?!-)[A-Za-z0-9._/-]+$/

export const projectRepoSchema = z.object({
  repo: z.string().regex(GITHUB_REPO_PATTERN),
  branch: z.string().regex(GIT_BRANCH_PATTERN).optional(),
})

export const githubCloneUrlOf = (repo: string): string => `https://github.com/${repo}.git`
