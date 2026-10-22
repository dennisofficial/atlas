import { describe, expect, it } from 'bun:test'

import { githubBranchesPath, githubRepoListSchema } from '../web'

describe('github repos wire', () => {
  it('builds the branches path from owner/name', () => {
    expect(githubBranchesPath('dennisofficial/atlas')).toBe(
      '/v1/github/repos/dennisofficial/atlas/branches',
    )
  })

  it('parses a repo summary and rejects a bad full name', () => {
    const repo = {
      fullName: 'octocat/Hello-World',
      isPrivate: false,
      defaultBranch: 'main',
      pushedAt: null,
    }
    expect(githubRepoListSchema.safeParse([repo]).success).toBe(true)
    expect(githubRepoListSchema.safeParse([{ ...repo, fullName: 'nope' }]).success).toBe(false)
  })
})
