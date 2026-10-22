import type { GithubRepoSummary } from '@dltech/atlas-wire/web'

import { fetchGithub } from '@/features/settings/data/personal/github-api'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { fetchGithubRepos } from './data/github-repos-api'

async function loadConnectedRepos(): Promise<GithubRepoSummary[] | null> {
  const connection = await fetchGithub()
  if (!connection.connected) return null
  return fetchGithubRepos()
}

export const useGithubRepos = (): CloudQuery<GithubRepoSummary[] | null> =>
  useCloudQuery({ key: 'github-repos', load: loadConnectedRepos })
