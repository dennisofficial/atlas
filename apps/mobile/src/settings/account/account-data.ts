import type { ApiClient } from '@dltech/atlas-api-router'
import {
  type IAuthAccountApi,
  type ISignInMethodIds,
  monthYear,
} from '@dltech/atlas-client/settings'

export type IAccountData = {
  name: string
  email: string
  githubLogin: string | null
  memberSince: string | null
  signInMethods: ISignInMethodIds
}

export const loadAccountData = async ({
  api,
  authApi,
}: {
  api: ApiClient
  authApi: IAuthAccountApi
}): Promise<IAccountData> => {
  const current = await authApi.getCurrentSession()
  const [github, signInMethods] = await Promise.all([
    api.github.get.query().catch(() => null),
    authApi.listSignInMethods(),
  ])
  return {
    name: current.user?.name ?? '',
    email: current.user?.email ?? '',
    githubLogin: github === null || !github.connected ? null : github.login,
    memberSince: current.user?.createdAt === undefined ? null : monthYear(current.user.createdAt),
    signInMethods,
  }
}
