export type GithubConfigValues = {
  appId?: string | undefined
  appPrivateKey?: string | undefined
  appSlug?: string | undefined
  clientId?: string | undefined
  clientSecret?: string | undefined
  publicApiUrl?: string | undefined
}

export class GithubConfig {
  constructor(readonly values: GithubConfigValues) {}
}
