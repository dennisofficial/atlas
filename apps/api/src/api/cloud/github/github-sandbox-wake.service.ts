import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { isDevServeVersion, type VercelCredentials } from '@dltech/atlas-wire'

import { db } from '../../../db'
import { Prisma } from '../../../generated/prisma/client'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { wakeableOf, type SandboxLifecycleColumns } from '../../platform/sandboxes/sandbox-lifecycle'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import type { CloudSandboxModel } from '../../../db'
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
  sandbox: SandboxLifecycleColumns & {
    name: string
    lastActivityAt: string
    wakeFailedAt: string | null
  }
}

/**
 * Wakes parked sandboxes when a PR/CI event targets their thread. Called from the mailbox after
 * the event row lands; resolves the thread through the subscription link, boots only parked
 * sandboxes inside the 24h wake window, and debounces per threadId so a check-run storm boots
 * once. Never throws into the delivery path — a failed wake is logged, the mailbox row stays.
 * A boot is claimed by compare-and-swapping the row's `wakeClaim` against the parked row it read,
 * before any Vercel call, so a second event — or a second API instance — loses the race instead
 * of starting a second boot. The claim reads as Resuming until serve's own mirror supersedes it.
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
          wakeableOf(target.sandbox) &&
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
    const row = await db.cloudSandbox.findUnique({ where: { threadId: args.threadId } })
    if (row === null || !wakeableOf(row)) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the row is no longer parked`)
      return
    }
    const wakeClaim = new Date().toISOString()
    const claimed = await db.cloudSandbox.updateMany({
      where: {
        threadId: args.threadId,
        wakeClaim: row.wakeClaim,
        runtimeCheckpointRevision: row.runtimeCheckpointRevision,
        state: row.state,
      },
      data: { wakeClaim, updatedAt: wakeClaim },
    })
    if (claimed.count === 0) {
      this.logger.log(`wake of thread ${args.threadId} lost its claim — the row moved underneath it`)
      return
    }
    try {
      await this.bootClaimed({ row })
    } catch (failure) {
      await this.releaseClaim({ threadId: args.threadId, wakeClaim })
      throw failure
    }
  }

  private async bootClaimed(args: { row: CloudSandboxModel }): Promise<void> {
    const { row } = args
    const serveVersion = await this.validatedServeVersion({ pinned: row.serveVersion })
    const freshToken = randomBytes(32).toString('hex')
    const { serveUrl, created } = await this.bootAdapter.boot({
      credentials: this.vercelCredentials(),
      name: row.name,
      threadId: row.threadId,
      image: this.env.get('SANDBOX_IMAGE'),
      cloudUrl: this.env.get('ATLAS_CLOUD_URL') ?? 'https://api.byatlas.io',
      serveVersion,
      freshToken,
      resumeToken: this.unsealedToken(row),
      onFreshSandbox: () => this.adoptFreshSandbox({ threadId: row.threadId, token: freshToken }),
    })
    const at = new Date().toISOString()
    await db.cloudSandbox.update({
      where: { threadId: row.threadId },
      data: {
        state: ESandboxState.Running,
        serveUrl,
        wakeFailedAt: null,
        lastActivityAt: at,
        updatedAt: at,
      },
    })
    this.logger.log(
      `woke sandbox ${row.name} for thread ${row.threadId} (${created ? 'created fresh' : 'resumed from snapshot'}) — serve at ${serveUrl}`,
    )
  }

  /** The prior sandbox's lifecycle record died with it; the fresh serve mirrors from revision 1. */
  private async adoptFreshSandbox(args: { threadId: string; token: string }): Promise<void> {
    await db.cloudSandbox.update({
      where: { threadId: args.threadId },
      data: {
        tokenHash: hashSessionToken(args.token),
        sealedToken: this.cipher.encrypt(args.token),
        runtimeCheckpoint: Prisma.DbNull,
        runtimeCheckpointRevision: null,
        updatedAt: new Date().toISOString(),
      },
    })
  }

  private unsealedToken(row: Pick<CloudSandboxModel, 'name' | 'sealedToken'>): string | undefined {
    if (row.sealedToken === null) return undefined
    try {
      return this.cipher.decrypt(row.sealedToken)
    } catch (failure) {
      this.logger.warn(`the sealed token on sandbox ${row.name} does not decrypt: ${failureText(failure)}`)
      return undefined
    }
  }

  private async releaseClaim(args: { threadId: string; wakeClaim: string }): Promise<void> {
    const at = new Date().toISOString()
    await db.cloudSandbox.updateMany({
      where: { threadId: args.threadId, wakeClaim: args.wakeClaim },
      data: { wakeClaim: null, wakeFailedAt: at, updatedAt: at },
    })
  }

  /**
   * The wake boots the client's pinned version exactly, never latest: booting latest would
   * manufacture the version drift drain-and-swap exists to correct. A pruned or unreachable
   * release artifact fails the wake into backoff. A dev pin has no release artifact and passes
   * through unchecked: only its snapshot's binary can satisfy it, so a stamp mismatch fails the
   * wake in the launcher. Only a row no client ever pinned boots latest.
   */
  private async validatedServeVersion(args: { pinned: string | null }): Promise<string | undefined> {
    if (args.pinned === null) return undefined
    if (isDevServeVersion(args.pinned)) return args.pinned
    const tag = `tui-v${args.pinned.replace(/^tui-v/, '').replace(/^v/, '')}`
    const response = await fetch(
      `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/install.sh`,
      { method: 'HEAD', signal: AbortSignal.timeout(SERVE_INSTALL_TIMEOUT_MS) },
    ).catch((failure: unknown) => {
      throw new Error(`could not validate pinned serve ${args.pinned}: ${failureText(failure)}`)
    })
    if (!response.ok) {
      throw new Error(`pinned serve ${args.pinned} has no release artifact (${response.status})`)
    }
    return args.pinned
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
