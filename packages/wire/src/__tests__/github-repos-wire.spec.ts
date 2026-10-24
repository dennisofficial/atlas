import { describe, expect, it } from 'bun:test'

import { githubRepoListSchema } from '../web'

describe('github repos wire', () => {
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
