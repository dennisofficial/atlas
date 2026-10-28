import { listSignInMethods, type SignInMethodIds } from '@/lib/auth-accounts'

import { fetchGithub, githubLoginOf } from './github-api'
import { fetchCurrentSession } from './auth-session-api'
import { monthYear } from './relative-time'

export type AccountData = {
  name: string
  email: string
  githubLogin: string | null
  memberSince: string | null
  signInMethods: SignInMethodIds
}

export const memberSinceOf = (createdAt: string | undefined): string | null =>
  createdAt === undefined ? null : monthYear(createdAt)

export async function fetchAccountData(): Promise<AccountData> {
  const [current, github, signInMethods] = await Promise.all([
    fetchCurrentSession(),
    fetchGithub().catch(() => ({ connected: false as const })),
    listSignInMethods(),
  ])
  return {
    name: current.user?.name ?? '',
    email: current.user?.email ?? '',
    githubLogin: githubLoginOf(github),
    memberSince: memberSinceOf(current.user?.createdAt),
    signInMethods,
  }
}
