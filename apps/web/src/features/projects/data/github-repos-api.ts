import { api, cloudCall } from '@/lib/api-client'

export const fetchGithubRepos = () => cloudCall(api.githubRepos.list.query())

export const fetchGithubBranches = (fullName: string) => {
  const [owner = '', repo = ''] = fullName.split('/')
  return cloudCall(api.githubRepos.branches.query({ owner, repo }))
}
