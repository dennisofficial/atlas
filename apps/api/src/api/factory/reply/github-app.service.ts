import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { mintAppJwt } from './github-jwt'

const GITHUB_API = 'https://api.github.com'
const APP_JWT_REFRESH_MS = 8 * 60 * 1000
const DETAIL_CAP = 300

class BranchNotOnRemote extends Error {}

export type GithubFetch = typeof fetch

export class GithubAppNotInstalled extends BadGatewayException {
  constructor(args: { owner: string; repo: string }) {
    super(`the factory github app is not installed on ${args.owner}/${args.repo}`)
    this.name = 'GithubAppNotInstalled'
  }
}

type AppConfig = { appId: string; privateKey: string }

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

@Injectable()
export class GithubAppService {
  private readonly logger = new Logger(GithubAppService.name)
  private readonly fetchFn: GithubFetch
  private jwt: { token: string; refreshAt: number } | null = null
  private bot: Promise<string | null> | null = null

  constructor(private readonly env: EnvService, fetchFn?: GithubFetch) {
    this.fetchFn = fetchFn ?? fetch
  }

  configured(): boolean {
    return this.readConfig() !== null
  }

  /** Offline echo check: the webhook payload names the app that wrote the comment. */
  ownsAppId(id: number | undefined): boolean {
    if (id === undefined) return false
    return this.env.get('GITHUB_APP_ID') === String(id)
  }

  /**
   * The login our own comments arrive under on webhooks (`<slug>[bot]`); null when the app is not
   * configured, so ingress simply never filters. Cached per process; failures do not cache.
   */
  botLogin(): Promise<string | null> {
    this.bot ??= this.readBotLogin().catch((failure: unknown) => {
      this.bot = null
      this.logger.warn(`could not resolve the factory app bot login: ${messageOf(failure)}`)
      return null
    })
    return this.bot
  }

  /** Minted per call on purpose: the installation token is the run-scoped credential. */
  async installationToken(args: { owner: string; repo: string }): Promise<string> {
    const installation = await this.request<{ id: number }>({
      method: 'GET',
      path: `/repos/${args.owner}/${args.repo}/installation`,
      as: 'app',
      onNotFound: () => {
        throw new GithubAppNotInstalled({ owner: args.owner, repo: args.repo })
      },
    })
    const minted = await this.request<{ token: string }>({
      method: 'POST',
      path: `/app/installations/${installation.id}/access_tokens`,
      as: 'app',
    })
    return minted.token
  }

  /** Null when the branch is not on the remote — the delivery gate's "pushed" check. */
  async branchHead(args: { owner: string; repo: string; branch: string }): Promise<string | null> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    try {
      const branch = await this.request<{ commit: { sha: string } }>({
        method: 'GET',
        path: `/repos/${args.owner}/${args.repo}/branches/${encodeURIComponent(args.branch)}`,
        as: 'installation',
        token,
        onNotFound: () => {
          throw new BranchNotOnRemote()
        },
      })
      return branch.commit.sha
    } catch (failure) {
      if (failure instanceof BranchNotOnRemote) return null
      throw failure
    }
  }

  async createComment(args: {
    owner: string
    repo: string
    issueNumber: number
    body: string
  }): Promise<{ url: string }> {
    const token = await this.installationToken({ owner: args.owner, repo: args.repo })
    const comment = await this.request<{ html_url: string }>({
      method: 'POST',
      path: `/repos/${args.owner}/${args.repo}/issues/${args.issueNumber}/comments`,
      as: 'installation',
      token,
      body: { body: args.body },
    })
    return { url: comment.html_url }
  }

  private readConfig(): AppConfig | null {
    const appId = this.env.get('GITHUB_APP_ID')
    const privateKey = this.env.get('GITHUB_APP_PRIVATE_KEY')
    if (appId === undefined || privateKey === undefined) return null
    return { appId, privateKey }
  }

  private requireConfig(): AppConfig {
    const config = this.readConfig()
    if (config === null) {
      throw new ServiceUnavailableException(
        'the factory github app is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)',
      )
    }
    return config
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

  private async readBotLogin(): Promise<string | null> {
    if (!this.configured()) return null
    const app = await this.request<{ slug: string }>({ method: 'GET', path: '/app', as: 'app' })
    return `${app.slug}[bot]`.toLowerCase()
  }

  private async request<T>(
    args: {
      method: 'GET' | 'POST'
      path: string
      body?: Record<string, unknown>
      onNotFound?: () => never
    } & ({ as: 'app' } | { as: 'installation'; token: string }),
  ): Promise<T> {
    const authorization =
      args.as === 'app' ? `Bearer ${this.appJwt()}` : `Bearer ${args.token}`
    const response = await this.fetchFn(`${GITHUB_API}${args.path}`, {
      method: args.method,
      headers: {
        authorization,
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
    return (await response.json()) as T
  }
}
