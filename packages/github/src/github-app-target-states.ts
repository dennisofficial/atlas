import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubConfig, type GithubConfigValues } from './github-config'
import { GithubInstallationTokens } from './github-installation-tokens'
import { GithubSubscriptionTargetStates } from './github-subscription-target-states'

export const githubAppTargetStatesOf = (
  values: Pick<GithubConfigValues, 'appId' | 'appPrivateKey'>,
): GithubSubscriptionTargetStates => {
  const tokens = new GithubInstallationTokens(
    new GithubAppClient(new GithubConfig(values)),
    new GithubAppInstallationsService(),
  )
  return new GithubSubscriptionTargetStates({
    tokenFor: ({ repoFullName }) => tokens.tokenForRepo({ repoFullName }),
  })
}
