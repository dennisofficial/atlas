import { db } from '@dltech/atlas-db'

import { subscriptionLiveWhere } from './github-delivery-routing'
import type { GithubInstallationTokens } from './github-installation-tokens'
import { repoPattern } from './github-pr-identity'
import type { GithubService } from './github.service'

type FillTokenRequest = { repoFullName: string; installationId: bigint | undefined }

export const findFillToken = async (
  args: FillTokenRequest & {
    appToken: (request: FillTokenRequest) => Promise<string | undefined>
    findToken: (args: { userId: string }) => Promise<string | undefined>
  },
): Promise<string | undefined> => {
  const appToken = await args.appToken(args)
  if (appToken !== undefined) return appToken

  const hook = await db.orm.public.GithubRepoHook.where((hook) =>
    hook.repoFullName.ilike(repoPattern(args.repoFullName)),
  ).first()
  if (hook !== null) {
    const createdByToken = await args.findToken({ userId: hook.createdBy })
    if (createdByToken !== undefined) return createdByToken
  }

  const subscribers = await db.orm.public.GithubSubscription.where((subscription) =>
    subscription.repoFullName.ilike(repoPattern(args.repoFullName)),
  )
    .where(subscriptionLiveWhere({ now: new Date() }))
    .all()
  for (const subscriber of subscribers) {
    const token = await args.findToken({ userId: subscriber.userId })
    if (token !== undefined) return token
  }

  return undefined
}

export class GithubFillTokens {
  constructor(
    private readonly deps: {
      github: Pick<GithubService, 'findToken'>
      appTokens?:
        | Pick<GithubInstallationTokens, 'tokenForRepo' | 'tokenForInstallation'>
        | undefined
    },
  ) {}

  find(args: FillTokenRequest): Promise<string | undefined> {
    return findFillToken({
      ...args,
      appToken: (request) => this.appToken(request),
      findToken: (request) => this.deps.github.findToken(request),
    })
  }

  private appToken(args: FillTokenRequest): Promise<string | undefined> {
    const appTokens = this.deps.appTokens
    if (appTokens === undefined) return Promise.resolve(undefined)

    return args.installationId === undefined
      ? appTokens.tokenForRepo({ repoFullName: args.repoFullName })
      : appTokens.tokenForInstallation({ installationId: args.installationId })
  }
}
