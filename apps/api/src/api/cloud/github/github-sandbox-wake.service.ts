import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import { API_PROVISIONED_ENV } from '@dltech/atlas-wire'

import { db, type Row } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  wakeableOf,
  type SandboxLifecycleColumns,
} from '../../platform/sandboxes/sandbox-lifecycle'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
import { WAKE_DEBOUNCE, WAKE_DEBOUNCE_MS } from './github-sandbox-wake-debounce'
import { failureText, SANDBOX_WAKE_BOOT, type SandboxWakeBoot } from './github-sandbox-wake-boot'

export { WAKE_DEBOUNCE_MS }
export const WAKE_FAILURE_BACKOFF_MS = 5 * 60 * 1_000

export type {
  SandboxWakeBoot,
  WakeBootArgs,
  WakeBootResult,
} from './github-sandbox-wake-boot'

type WakeTarget = {
  threadId: string
  sandbox: SandboxLifecycleColumns & {
    name: string
    lastActivityAt: Date
    wakeFailedAt: Date | null
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
  private readonly debounce = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; target: WakeTarget }
  >()
  private readonly inFlight = new Set<string>()
  private readonly lookupsInFlight = new Set<Promise<void>>()
  private readonly bootsInFlight = new Set<Promise<void>>()

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    private readonly credentials: SandboxCredentials,
    @Inject(SANDBOX_WAKE_BOOT) private readonly bootAdapter: SandboxWakeBoot,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    @Inject(WAKE_DEBOUNCE) private readonly debounceMs: number,
  ) {}

  notifyEvent(args: { userId: string; repoFullName: string; prNumber: number }): void {
    this.track({
      inFlight: this.lookupsInFlight,
      work: this.wakeTargets(args).catch((failure: unknown) => {
        this.logger.warn(
          `sandbox wake for ${args.repoFullName}#${args.prNumber} (user ${args.userId}) failed: ${failureText(failure)}`,
        )
      }),
    })
  }

  /** For callers about to exit: boots every debounced target now and awaits all lookups and boots. Never throws. */
  async settle(): Promise<void> {
    await Promise.all([...this.lookupsInFlight])
    for (const { timer, target } of [...this.debounce.values()]) {
      clearTimeout(timer)
      this.debounce.delete(target.threadId)
      this.startBoot(target)
    }
    await Promise.all([...this.bootsInFlight])
  }

  private track(args: { inFlight: Set<Promise<void>>; work: Promise<void> }): Promise<void> {
    const tracked = args.work.finally(() => args.inFlight.delete(tracked))
    args.inFlight.add(tracked)
    this.background.keepAlive(tracked)
    return tracked
  }

  private startBoot(target: WakeTarget): Promise<void> {
    return this.track({
      inFlight: this.bootsInFlight,
      work: this.bootParkedSandbox({ threadId: target.threadId }).catch((failure: unknown) => {
        this.logger.warn(
          `wake boot of sandbox ${target.sandbox.name} (thread ${target.threadId}) failed: ${failureText(failure)}`,
        )
      }),
    })
  }

  private async wakeTargets(args: {
    userId: string
    repoFullName: string
    prNumber: number
  }): Promise<void> {
    const subscriptions = await db.orm.public.GithubSubscription.where({
      userId: args.userId,
      repoFullName: args.repoFullName,
      prNumber: args.prNumber,
    })
      .where((subscription) => subscription.threadId.isNotNull())
      .include('sandbox')
      .all()
    const wakeCutoff = new Date(Date.now() - PARK_WAKE_WINDOW_MS)
    const backoffCutoff = new Date(Date.now() - WAKE_FAILURE_BACKOFF_MS)
    const targets = subscriptions
      .filter(
        (subscription): subscription is typeof subscription & { threadId: string } =>
          subscription.threadId !== null,
      )
      .flatMap((subscription): WakeTarget[] =>
        subscription.sandbox === null
          ? []
          : [{ threadId: subscription.threadId, sandbox: subscription.sandbox }],
      )
      .filter(
        (target) =>
          wakeableOf(target.sandbox) &&
          target.sandbox.lastActivityAt.getTime() > wakeCutoff.getTime() &&
          (target.sandbox.wakeFailedAt === null ||
            target.sandbox.wakeFailedAt.getTime() < backoffCutoff.getTime()),
      )
    const seen = new Set<string>()
    const immediateBoots: Promise<void>[] = []
    for (const target of targets) {
      if (seen.has(target.threadId)) continue
      seen.add(target.threadId)
      const boot = this.debounceBoot(target)
      if (boot !== undefined) immediateBoots.push(boot)
    }
    await Promise.all(immediateBoots)
  }

  private debounceBoot(target: WakeTarget): Promise<void> | undefined {
    if (this.inFlight.has(target.threadId)) return undefined
    if (this.debounceMs === 0) return this.startBoot(target)
    const pending = this.debounce.get(target.threadId)
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      this.debounce.delete(target.threadId)
    }
    const timer = setTimeout(() => {
      this.debounce.delete(target.threadId)
      this.startBoot(target)
    }, this.debounceMs)
    this.debounce.set(target.threadId, { timer, target })
    return undefined
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
    const row = await db.orm.public.CloudSandbox.first({ threadId: args.threadId })
    if (row === null || !wakeableOf(row)) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the row is no longer parked`)
      return
    }
    const wakeClaim = new Date()
    const claimed = await db.orm.public.CloudSandbox.where({
      threadId: args.threadId,
      wakeClaim: row.wakeClaim,
      runtimeCheckpointRevision: row.runtimeCheckpointRevision,
      state: row.state,
    }).updateAndCount({ wakeClaim, updatedAt: wakeClaim })
    if (claimed === 0) {
      this.logger.log(
        `wake of thread ${args.threadId} lost its claim — the row moved underneath it`,
      )
      return
    }
    try {
      await this.bootClaimed({ row })
    } catch (failure) {
      await this.releaseClaim({ threadId: args.threadId, wakeClaim })
      throw failure
    }
  }

  private async bootClaimed(args: { row: Row<'CloudSandbox'> }): Promise<void> {
    const { row } = args
    const freshToken = randomBytes(32).toString('hex')
    const { ownerCredential, ...credentials } = await this.credentials.forThread({
      threadId: row.threadId,
    })
    const { serveUrl, created } = await this.bootAdapter.boot({
      credentials,
      ...(ownerCredential
        ? { injectVercelCredentials: false, environment: { [API_PROVISIONED_ENV]: '1' } }
        : {}),
      name: row.name,
      threadId: row.threadId,
      image: this.env.get('SANDBOX_IMAGE'),
      cloudUrl: this.env.get('ATLAS_CLOUD_URL') ?? 'https://api.byatlas.io',
      serveVersion: row.serveVersion ?? undefined,
      freshToken,
      resumeToken: this.unsealedToken(row),
      onFreshSandbox: () => this.adoptFreshSandbox({ threadId: row.threadId, token: freshToken }),
    })
    const at = new Date()
    await db.orm.public.CloudSandbox.where({ threadId: row.threadId }).update({
      state: ESandboxState.Running,
      serveUrl,
      wakeFailedAt: null,
      lastActivityAt: at,
      updatedAt: at,
    })
    this.logger.log(
      `woke sandbox ${row.name} for thread ${row.threadId} (${created ? 'created fresh' : 'resumed from snapshot'}) — serve at ${serveUrl}`,
    )
  }

  /** The prior sandbox's lifecycle record died with it; the fresh serve mirrors from revision 1. */
  private async adoptFreshSandbox(args: { threadId: string; token: string }): Promise<void> {
    await db.orm.public.CloudSandbox.where({ threadId: args.threadId }).update({
      tokenHash: hashSessionToken(args.token),
      sealedToken: this.cipher.encrypt(args.token),
      runtimeCheckpoint: null,
      runtimeCheckpointRevision: null,
      updatedAt: new Date(),
    })
  }

  private unsealedToken(
    row: Pick<Row<'CloudSandbox'>, 'name' | 'sealedToken'>,
  ): string | undefined {
    if (row.sealedToken === null) return undefined
    try {
      return this.cipher.decrypt(row.sealedToken)
    } catch (failure) {
      this.logger.warn(
        `the sealed token on sandbox ${row.name} does not decrypt: ${failureText(failure)}`,
      )
      return undefined
    }
  }

  private async releaseClaim(args: { threadId: string; wakeClaim: Date }): Promise<void> {
    const at = new Date()
    await db.orm.public.CloudSandbox.where({
      threadId: args.threadId,
      wakeClaim: args.wakeClaim,
    }).updateAndCount({ wakeClaim: null, wakeFailedAt: at, updatedAt: at })
  }
}
