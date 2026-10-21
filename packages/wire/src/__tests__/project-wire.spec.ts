import { describe, expect, it } from 'vitest'

import {
  githubCloneUrlOf,
  gitBranchSchema,
  githubRepoSchema,
  MAX_ADDITIONAL_REPOS,
  MAX_PROJECT_NAME_LENGTH,
  projectRepoSchema,
  projectWorkspaceSchema,
} from '../project-wire'

describe('project wire', () => {
  it('accepts owner/repo and rejects anything else', () => {
    expect(githubRepoSchema.safeParse('octocat/Hello-World').success).toBe(true)
    expect(githubRepoSchema.safeParse('octocat/Hello.World_2').success).toBe(true)
    for (const bad of ['not a repo', 'octocat', 'a/b/c', '/repo', 'owner/', 'o/r;rm -rf']) {
      expect(githubRepoSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('rejects a repo segment made only of dots and accepts dotted names', () => {
    for (const bad of ['o/.', 'o/..', 'o/...']) {
      expect(githubRepoSchema.safeParse(bad).success).toBe(false)
    }
    for (const good of ['o/.github', 'o/a.b']) {
      expect(githubRepoSchema.safeParse(good).success).toBe(true)
    }
  })

  it('accepts ordinary branches and rejects a leading dash', () => {
    expect(gitBranchSchema.safeParse('release/1.0').success).toBe(true)
    expect(gitBranchSchema.safeParse('test-branch').success).toBe(true)
    expect(gitBranchSchema.safeParse('-branch').success).toBe(false)
    expect(gitBranchSchema.safeParse('--upload-pack=x').success).toBe(false)
    expect(gitBranchSchema.safeParse('has space').success).toBe(false)
  })

  it('makes a repo entry branch optional but validated', () => {
    expect(projectRepoSchema.safeParse({ repo: 'octocat/Spoon-Knife' }).success).toBe(true)
    expect(projectRepoSchema.safeParse({ repo: 'octocat/Spoon-Knife', branch: '-x' }).success).toBe(false)
  })

  it('parses a workspace with null repo, branch and token', () => {
    const parsed = projectWorkspaceSchema.safeParse({
      projectId: 'p',
      repo: null,
      baseBranch: null,
      additionalRepos: [],
      githubToken: null,
    })

    expect(parsed.success).toBe(true)
  })

  it('builds the https clone url and caps extras at ten', () => {
    expect(githubCloneUrlOf('octocat/Hello-World')).toBe('https://github.com/octocat/Hello-World.git')
    expect(MAX_ADDITIONAL_REPOS).toBe(10)
    expect(MAX_PROJECT_NAME_LENGTH).toBe(100)
  })
})
