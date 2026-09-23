import { randomUUID } from 'node:crypto'
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { FactoryConnectionsService } from './connections/connections.service'
import { EFactoryConnectionProvider } from './factory.types'
import { GithubAppService } from './reply/github-app.service'

const STATE_TTL_MS = 10 * 60 * 1000

interface PendingInstall {
  organizationId: string
  expiresAt: number
}

@Injectable()
export class GithubInstallService {
  private readonly pending = new Map<string, PendingInstall>()

  constructor(
    private readonly connections: FactoryConnectionsService,
    private readonly githubApp: GithubAppService,
  ) {}

  async beginInstall(args: { organizationId: string }): Promise<string> {
    const slug = await this.githubApp.appSlug()
    this.sweepExpired()
    const state = randomUUID()
    this.pending.set(state, {
      organizationId: args.organizationId,
      expiresAt: Date.now() + STATE_TTL_MS,
    })
    return `https://github.com/apps/${slug}/installations/new?state=${state}`
  }

  async completeInstall(args: { installationId: string; state: string }): Promise<void> {
    const entry = this.pending.get(args.state)
    this.pending.delete(args.state)
    if (entry === undefined || entry.expiresAt < Date.now()) {
      throw new BadRequestException('unknown or expired github install state')
    }
    if (!/^\d+$/.test(args.installationId)) {
      throw new BadRequestException('installation_id must be numeric')
    }
    const existing = await this.connections.resolve({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: args.installationId,
    })
    if (existing !== null && existing.organizationId !== entry.organizationId) {
      throw new ConflictException(
        'this github installation is already connected to another organization',
      )
    }
    await this.githubApp.assertInstallation({ installationId: args.installationId })

    await this.connections.upsert({
      provider: EFactoryConnectionProvider.GitHub,
      externalAccountId: args.installationId,
      organizationId: entry.organizationId,
      status: 'active',
    })
  }

  private sweepExpired(): void {
    const now = Date.now()
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt < now) this.pending.delete(state)
    }
  }
}
