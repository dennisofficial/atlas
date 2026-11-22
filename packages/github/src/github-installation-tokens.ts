import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { githubLogOf } from './github-log'

const REFRESH_MARGIN_MS = 5 * 60 * 1_000

type CachedToken = { token: string; expiresAt: number }

export class GithubInstallationTokens {
  private readonly logger = githubLogOf(GithubInstallationTokens.name)
  private readonly held = new Map<string, CachedToken>()
  private readonly minting = new Map<string, Promise<string | undefined>>()

  constructor(
    private readonly client: GithubAppClient,
    private readonly installations: GithubAppInstallationsService,
  ) {}

  async tokenForRepo(args: { repoFullName: string }): Promise<string | undefined> {
    if (!this.client.isConfigured()) return undefined
    const installationId = await this.installations.installationForRepo({
      repoFullName: args.repoFullName,
    })
    return installationId === null ? undefined : this.tokenFor({ installationId })
  }

  async tokenForInstallation(args: { installationId: bigint }): Promise<string | undefined> {
    if (!this.client.isConfigured()) return undefined
    return this.tokenFor({ installationId: args.installationId })
  }

  private async tokenFor(args: { installationId: bigint }): Promise<string | undefined> {
    const key = String(args.installationId)
    const cached = this.held.get(key)
    if (cached !== undefined && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return cached.token
    }
    const inFlight = this.minting.get(key)
    if (inFlight !== undefined) return inFlight
    const minted = this.mint({ key, installationId: args.installationId })
    this.minting.set(key, minted)
    try {
      return await minted
    } finally {
      this.minting.delete(key)
    }
  }

  private async mint(args: { key: string; installationId: bigint }): Promise<string | undefined> {
    try {
      const jwt = await this.client.mintInstallationToken({
        installationId: args.installationId,
      })
      this.held.set(args.key, { token: jwt.token, expiresAt: jwt.expiresAt })
      return jwt.token
    } catch (failure) {
      this.held.delete(args.key)
      this.logger.warn(
        `github app installation token mint failed for installation ${args.key}: ${String(failure)}`,
      )
      return undefined
    }
  }
}
