import { createSign } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { EnvService } from '../../../_core/config/env/env.service'
import { EGithubCallSource } from './github-call-log'
import { githubFetch } from './github-fetch'
import { normalizedRepo } from './github-pr-identity'

const GITHUB_API = 'https://api.github.com'
const PAGE_SIZE = 100
const REQUEST_TIMEOUT_MS = 15_000
const JWT_BACKDATE_SECONDS = 60
const JWT_LIFETIME_SECONDS = 540

export type GithubAppInstallationSummary = {
  installationId: bigint
  accountLogin: string
  accountType: string
  suspendedAt: Date | null
}

type InstallationListItem = {
  id: number
  account: { login: string; type: string } | null
  suspended_at: string | null
}

const base64Url = (value: Buffer | string): string => Buffer.from(value).toString('base64url')

@Injectable()
export class GithubAppClient {
  constructor(private readonly env: EnvService) {}

  isConfigured(): boolean {
    const appId = this.env.get('GITHUB_APP_ID')
    const key = this.env.get('GITHUB_APP_PRIVATE_KEY')
    return appId !== undefined && appId.length > 0 && key !== undefined && key.length > 0
  }

  signJwt(args: { nowSeconds?: number } = {}): string {
    const appId = this.env.get('GITHUB_APP_ID')
    const key = this.env.get('GITHUB_APP_PRIVATE_KEY')
    if (appId === undefined || key === undefined) throw new Error('github app is not configured')
    const now = args.nowSeconds ?? Math.floor(Date.now() / 1_000)
    const unsigned = [
      base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })),
      base64Url(
        JSON.stringify({
          iat: now - JWT_BACKDATE_SECONDS,
          exp: now + JWT_LIFETIME_SECONDS,
          iss: appId,
        }),
      ),
    ].join('.')
    const signature = createSign('RSA-SHA256').update(unsigned).sign(key.replace(/\\n/g, '\n'))
    return `${unsigned}.${base64Url(signature)}`
  }

  async listInstallations(): Promise<GithubAppInstallationSummary[]> {
    const jwt = this.signJwt()
    const items = await this.paginate<InstallationListItem>({
      path: '/app/installations',
      token: jwt,
      pick: (body) => body as InstallationListItem[],
    })
    return items.map((item) => ({
      installationId: BigInt(item.id),
      accountLogin: item.account?.login ?? '',
      accountType: item.account?.type ?? '',
      suspendedAt: item.suspended_at === null ? null : new Date(item.suspended_at),
    }))
  }

  async installationRepos(args: { installationId: bigint }): Promise<string[]> {
    const response = await this.request({
      method: 'POST',
      path: `/app/installations/${args.installationId}/access_tokens`,
      token: this.signJwt(),
    })
    const { token } = (await response.json()) as { token: string }
    const repos = await this.paginate<{ full_name: string }>({
      path: '/installation/repositories',
      token,
      pick: (body) => (body as { repositories: Array<{ full_name: string }> }).repositories,
    })
    return repos.map((repo) => normalizedRepo(repo.full_name))
  }

  private async paginate<T>(args: {
    path: string
    token: string
    pick: (body: unknown) => T[]
  }): Promise<T[]> {
    const all: T[] = []
    for (let page = 1; ; page += 1) {
      const response = await this.request({
        method: 'GET',
        path: `${args.path}?per_page=${PAGE_SIZE}&page=${page}`,
        token: args.token,
      })
      const items = args.pick(await response.json())
      all.push(...items)
      if (items.length < PAGE_SIZE) return all
    }
  }

  private async request(args: {
    method: 'GET' | 'POST'
    path: string
    token: string
  }): Promise<Response> {
    const response = await githubFetch({
      source: EGithubCallSource.AppSync,
      url: `${GITHUB_API}${args.path}`,
      init: {
        method: args.method,
        headers: {
          authorization: `Bearer ${args.token}`,
          accept: 'application/vnd.github+json',
          'x-github-api-version': '2022-11-28',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      },
    })
    if (!response.ok) {
      throw new Error(
        `github answered ${response.status} for ${args.method} ${args.path.split('?')[0]}`,
      )
    }
    return response
  }
}
