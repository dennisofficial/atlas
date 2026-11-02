import { Injectable, Logger } from '@nestjs/common'
import { GithubAppClient } from './github-app-client'
import { GithubAppInstallationsService } from './github-app-installations.service'
import { GithubAppSyncGate } from './github-app-sync-gate'

const PERIODIC_SYNC_KEY = 'periodic'
const PERIODIC_SYNC_INTERVAL_MS = 15 * 60 * 1_000
const UNKNOWN_INSTALLATION_DEBOUNCE_MS = 5 * 60 * 1_000

@Injectable()
export class GithubAppSyncService {
  private readonly logger = new Logger(GithubAppSyncService.name)

  constructor(
    private readonly client: GithubAppClient,
    private readonly installations: GithubAppInstallationsService,
    private readonly gate: GithubAppSyncGate,
  ) {}

  async syncFromGithub(): Promise<void> {
    if (!this.client.isConfigured()) return
    const listed = await this.client.listInstallations()
    for (const installation of listed) {
      const repos =
        installation.suspendedAt === null
          ? await this.client.installationRepos({
              installationId: installation.installationId,
            })
          : await this.installations.heldRepos({
              installationId: installation.installationId,
            })
      await this.installations.upsert({ ...installation, repos })
    }
    await this.installations.retainOnly({
      installationIds: listed.map((installation) => installation.installationId),
    })
  }

  async syncIfDue(): Promise<void> {
    await this.syncGated({
      key: PERIODIC_SYNC_KEY,
      ttlMs: PERIODIC_SYNC_INTERVAL_MS,
    })
  }

  async syncNow(): Promise<void> {
    await this.syncFromGithub().catch((failure: unknown) => {
      this.logger.warn(`github app sync failed: ${String(failure)}`)
    })
  }

  async syncUnknownInstallation(args: { installationId: number }): Promise<void> {
    const known = await this.installations.read({
      installationId: BigInt(args.installationId),
    })
    if (known !== null) return
    await this.syncGated({
      key: `unknown:${args.installationId}`,
      ttlMs: UNKNOWN_INSTALLATION_DEBOUNCE_MS,
    })
  }

  private async syncGated(args: { key: string; ttlMs: number }): Promise<void> {
    try {
      if (!this.client.isConfigured()) return
      if (!(await this.gate.claim(args))) return
    } catch (failure) {
      this.logger.warn(`github app sync gate unavailable: ${String(failure)}`)
      return
    }
    try {
      await this.syncFromGithub()
    } catch (failure) {
      await this.gate.release({ key: args.key }).catch(() => undefined)
      this.logger.warn(`github app sync failed: ${String(failure)}`)
    }
  }
}
