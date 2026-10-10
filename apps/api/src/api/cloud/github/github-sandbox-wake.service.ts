import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { driveNameFor, type VercelCredentials } from '@dltech/atlas-wire'

import { db } from '../../../db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import {
  failureText,
  SANDBOX_WAKE_BOOT,
  type SandboxWakeBoot,
} from './github-sandbox-wake-boot'

export const WAKE_DEBOUNCE_MS = 5_000
export const WAKE_FAILURE_BACKOFF_MS = 5 * 60 * 1_000
const SERVE_INSTALL_TIMEOUT_MS = 8_000
const RELEASE_REPOSITORY = 'dennisofficial/atlas'

export type {
  SandboxWakeBoot,
  WakeBootArgs,
  WakeBootResult,
} from './github-sandbox-wake-boot'

type WakeTarget = {
  threadId: string
  sandbox: {
    name: string
    state: string
    lastActivityAt: string
    driveName: string | null
    serveVersion: string | null
    wakeFailedAt: string | null
  }
}

/**
 * Wakes parked sandboxes when a PR/CI event targets their thread. Called from the mailbox after
 * the event row lands; resolves the thread through the subscription link, boots only parked
 * sandboxes inside the 24h wake window, and debounces per threadId so a check-run storm boots
 * once. Never throws into the delivery path — a failed wake is logged, the mailbox row stays.
 * A boot is claimed with a conditional Parked→Resuming updateMany before any Vercel call, so a
 * second event that lands mid-boot loses the race and retries instead of starting a second boot.
 */
@Injectable()
export class GithubSandboxWakeService {
  private readonly logger = new Logger(GithubSandboxWakeService.name)
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly inFlight = new Set<string>()

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    @Inject(SANDBOX_WAKE_BOOT) private readonly bootAdapter: SandboxWakeBoot,
  ) {}

  notifyEvent(args: { userId: string; repoFullName: string; prNumber: number }): void {
    void this.wakeTargets(args).catch((failure: unknown) => {
      this.logger.warn(
        `sandbox wake for ${args.repoFullName}#${args.prNumber} (user ${args.userId}) failed: ${failureText(failure)}`,
      )
    })
  }

  private async wakeTargets(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<void> {
    const subscriptions = await db.githubSubscription.findMany({
      where: {
        userId: args.userId,
        repoFullName: args.repoFullName,
        prNumber: args.prNumber,
        threadId: { not: null },
      },
      include: { sandbox: true },
    })
    const wakeCutoff = new Date(Date.now() - PARK_WAKE_WINDOW_MS).toISOString()
    const backoffCutoff = new Date(Date.now() - WAKE_FAILURE_BACKOFF_MS).toISOString()
    const targets = subscriptions
      .filter((subscription): subscription is typeof subscription & { threadId: string } => subscription.threadId !== null)
      .flatMap((subscription): WakeTarget[] =>
        subscription.sandbox === null
          ? []
          : [{ threadId: subscription.threadId, sandbox: subscription.sandbox }],
      )
      .filter(
        (target) =>
          target.sandbox.state === ESandboxState.Parked &&
          target.sandbox.lastActivityAt > wakeCutoff &&
          (target.sandbox.wakeFailedAt === null || target.sandbox.wakeFailedAt < backoffCutoff),
      )
    const seen = new Set<string>()
    for (const target of targets) {
      if (seen.has(target.threadId)) continue
      seen.add(target.threadId)
      this.debounceBoot(target)
    }
  }

  private debounceBoot(target: WakeTarget): void {
    if (this.inFlight.has(target.threadId)) return
    const pending = this.debounce.get(target.threadId)
    if (pending !== undefined) {
      clearTimeout(pending)
      this.debounce.delete(target.threadId)
    }
    const timer = setTimeout(() => {
      this.debounce.delete(target.threadId)
      void this.bootParkedSandbox({ threadId: target.threadId }).catch((failure: unknown) => {
        this.logger.warn(
          `wake boot of sandbox ${target.sandbox.name} (thread ${target.threadId}) failed: ${failureText(failure)}`,
        )
      })
    }, WAKE_DEBOUNCE_MS)
    this.debounce.set(target.threadId, timer)
  }

  private async bootParkedSandbox(args: { threadId: string }): Promise<void> {
    if (this.inFlight.has(args.threadId)) return
    this.inFlight.add(args.threadId)
    try {
      await this.claimAndBoot(args)
    } finally {
      this.inFlight.delete(args.threadId)
    }
  }

  private async claimAndBoot(args: { threadId: string }): Promise<void> {
    const claimed = await db.cloudSandbox.updateMany({
      where: { threadId: args.threadId, state: ESandboxState.Parked },
      data: { state: ESandboxState.Resuming, updatedAt: new Date().toISOString() },
    })
    if (claimed.count === 0) {
      this.logger.log(`wake of thread ${args.threadId} lost its claim — the row is no longer parked`)
      return
    }
    try {
      await this.bootClaimed(args)
    } catch (failure) {
      await this.releaseClaim(args)
      throw failure
    }
  }

  private async bootClaimed(args: { threadId: string }): Promise<void> {
    const row = await db.cloudSandbox.findUnique({ where: { threadId: args.threadId } })
    if (row === null) throw new Error(`sandbox row for thread ${args.threadId} vanished mid-wake`)
    const serveVersion = await this.validatedServeVersion({ pinned: row.serveVersion })
    const credentials = this.vercelCredentials()
    const token = randomBytes(32).toString('hex')
    const { serveUrl } = await this.bootAdapter.boot({
      credentials,
      name: row.name,
      driveName: row.driveName ?? driveNameFor({ threadId: args.threadId }),
      threadId: args.threadId,
      image: this.env.get('SANDBOX_IMAGE'),
      cloudUrl: this.env.get('ATLAS_CLOUD_URL') ?? 'https://api.byatlas.io',
      serveVersion,
      token,
    })
    await db.cloudSandbox.update({
      where: { threadId: args.threadId },
      data: {
        state: ESandboxState.Running,
        serveUrl,
        tokenHash: hashSessionToken(token),
        sealedToken: this.cipher.encrypt(token),
        wakeFailedAt: null,
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    this.logger.log(`woke sandbox ${row.name} for thread ${args.threadId} — serve at ${serveUrl}`)
  }

  private async releaseClaim(args: { threadId: string }): Promise<void> {
    await db.cloudSandbox.updateMany({
      where: { threadId: args.threadId, state: ESandboxState.Resuming },
      data: {
        state: ESandboxState.Parked,
        wakeFailedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
  }

  /**
   * The pinned serveVersion is only worth booting when its release artifact still exists — a
   * boot against a pruned release fails at install and leaves the thread wedged until the next
   * event. A missing artifact falls back to latest (undefined desiredVersion).
   */
  private async validatedServeVersion(args: { pinned: string | null }): Promise<string | undefined> {
    if (args.pinned === null) return undefined
    const tag = `tui-v${args.pinned.replace(/^tui-v/, '').replace(/^v/, '')}`
    try {
      const response = await fetch(
        `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/install.sh`,
        { method: 'HEAD', signal: AbortSignal.timeout(SERVE_INSTALL_TIMEOUT_MS) },
      )
      if (response.ok) return args.pinned
      this.logger.warn(
        `pinned serve ${args.pinned} has no release artifact (${response.status}) — waking with latest`,
      )
      return undefined
    } catch (failure) {
      this.logger.warn(
        `could not validate pinned serve ${args.pinned} — waking with latest: ${failureText(failure)}`,
      )
      return undefined
    }
  }

  private vercelCredentials(): VercelCredentials {
    const token = this.env.get('VERCEL_TOKEN')
    const teamId = this.env.get('VERCEL_TEAM_ID')
    const projectId = this.env.get('VERCEL_PROJECT_ID')
    if (token === undefined || teamId === undefined || projectId === undefined) {
      throw new Error('Atlas Cloud sandboxes are not configured on this deployment')
    }
    return { token, teamId, projectId }
  }
}
