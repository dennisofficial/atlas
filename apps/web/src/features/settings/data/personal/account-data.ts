import { listOrganizations, type Organization } from '@/lib/organization-api'

import { fetchGithub, githubLoginOf } from './github-api'
import { fetchCurrentSession } from './auth-session-api'
import { monthYear } from './relative-time'

export type AccountData = {
  name: string
  email: string
  githubLogin: string | null
  memberSince: string | null
  workspaces: Organization[]
}

export const memberSinceOf = (createdAt: string | undefined): string | null =>
  createdAt === undefined ? null : monthYear(createdAt)

export async function fetchAccountData(): Promise<AccountData> {
  const [current, github, workspaces] = await Promise.all([
    fetchCurrentSession(),
    fetchGithub().catch(() => ({ connected: false as const })),
    listOrganizations(),
  ])
  return {
    name: current.user?.name ?? '',
    email: current.user?.email ?? '',
    githubLogin: githubLoginOf(github),
    memberSince: memberSinceOf(current.user?.createdAt),
    workspaces,
  }
}
