import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { mintAppJwt } from './github-jwt'

const GITHUB_API = 'https://api.github.com'
const APP_JWT_REFRESH_MS = 8 * 60 * 1000
const DETAIL_CAP = 300

export type GithubFetch = typeof fetch

export class GithubAppNotInstalled extends BadGatewayException {
  constructor(args: { owner: string; repo: string }) {
    super(`the Atlas GitHub app is not installed on ${args.owner}/${args.repo}`)
    this.name = 'GithubAppNotInstalled'
  }
}

type AppConfig = { appId: string; privateKey: string }

type GithubAppRequestArgs = {
  method: 'GET' | 'POST'
  path: string
  body?: Record<string, unknown>
  onNotFound?: () => never
}

/** Low-level GitHub client: app JWT minting and the app-authenticated request plumbing. */
export class GithubApi {
  private jwt: { token: string; refreshAt: number } | null = null

  constructor(
    private readonly env: EnvService,
    private readonly fetchFn: GithubFetch = fetch,
  ) {}

  configured(): boolean {
    return this.readConfig() !== null
  }

  /** Minted per call on purpose: the installation token is the run-scoped credential. */
  async installationToken(args: { owner: string; repo: string }): Promise<string> {
    const installation = await this.request<{ id: number }>({
      method: 'GET',
      path: `/repos/${args.owner}/${args.repo}/installation`,
      onNotFound: () => {
        throw new GithubAppNotInstalled({ owner: args.owner, repo: args.repo })
      },
    })
    return this.mintInstallationToken({ installationId: installation.id })
  }

  private async mintInstallationToken(args: { installationId: number }): Promise<string> {
    const minted = await this.request<{ token: string }>({
      method: 'POST',
      path: `/app/installations/${args.installationId}/access_tokens`,
    })
    return minted.token
  }

  private async request<T>(args: GithubAppRequestArgs): Promise<T> {
    const response = await this.perform(args)
    return (await response.json()) as T
  }

  private requireConfig(): AppConfig {
    const config = this.readConfig()
    if (config === null) {
      throw new ServiceUnavailableException(
        'the Atlas GitHub app is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)',
      )
    }
    return config
  }

  private readConfig(): AppConfig | null {
    const appId = this.env.get('GITHUB_APP_ID')
    const privateKey = this.env.get('GITHUB_APP_PRIVATE_KEY')
    if (appId === undefined || privateKey === undefined) return null
    return { appId, privateKey }
  }

  private appJwt(): string {
    const now = Date.now()
    if (this.jwt !== null && now < this.jwt.refreshAt) return this.jwt.token
    const config = this.requireConfig()
    const token = mintAppJwt({
      appId: config.appId,
      privateKey: config.privateKey,
      nowSeconds: Math.floor(now / 1000),
    })
    this.jwt = { token, refreshAt: now + APP_JWT_REFRESH_MS }
    return token
  }

  private async perform(args: GithubAppRequestArgs): Promise<Response> {
    const response = await this.fetchFn(`${GITHUB_API}${args.path}`, {
      method: args.method,
      headers: {
        authorization: `Bearer ${this.appJwt()}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(args.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
    })

    if (response.status === 404 && args.onNotFound !== undefined) args.onNotFound()
    if (!response.ok) {
      const detail = (await response.text()).slice(0, DETAIL_CAP)
      throw new BadGatewayException(
        `github answered ${response.status} for ${args.method} ${args.path}: ${detail}`,
      )
    }
    return response
  }
}
