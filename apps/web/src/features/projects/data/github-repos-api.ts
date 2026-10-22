import {
  githubBranchesPath,
  githubBranchListSchema,
  GITHUB_REPOS_PATH,
  githubRepoListSchema,
} from '@dltech/atlas-wire/web'

import { cloudJson, EHttpMethod } from '@/lib/cloud-api'

export const fetchGithubRepos = () =>
  cloudJson({ method: EHttpMethod.Get, path: GITHUB_REPOS_PATH, schema: githubRepoListSchema })

export const fetchGithubBranches = (fullName: string) =>
  cloudJson({
    method: EHttpMethod.Get,
    path: githubBranchesPath(fullName),
    schema: githubBranchListSchema,
  })
