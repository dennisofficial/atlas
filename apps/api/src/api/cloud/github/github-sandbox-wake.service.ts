import { Inject, Injectable, Logger } from '@nestjs/common'
import { randomBytes } from 'node:crypto'

import {
  attachLagRetry,
  imageOptimizeRetry,
  createServeLauncher,
  driveNameFor,
  ensureDrive,
  isSandboxMissing,
  liveDriveSdk,
  liveSdk,
  mountWithRetries,
  routedUrlWithRetries,
  SANDBOX_QUICK_TIMEOUT_MS,
  waitForDriveDetached,
  type VercelCredentials,
} from '@dltech/atlas-wire'

import { db } from '../../../db'
import { EnvService } from '../../../_core/config/env/env.service'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import { hashSessionToken } from '../../platform/sandboxes/sandbox-tokens'
import { ESandboxState } from '../../platform/sandboxes/sandboxes.types'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'

export const WAKE_DEBOUNCE_MS = 5_000

export type WakeBootArgs = {
  credentials: VercelCredentials
  name: string
  driveName: string
  threadId: string
  image: string
  cloudUrl: string
  serveVersion: string | undefined
  token: string
}

export type WakeBootResult = { serveUrl: string }

export interface SandboxWakeBoot {
  boot(args: WakeBootArgs): Promise<WakeBootResult>
}

export const SANDBOX_WAKE_BOOT = Symbol('SANDBOX_WAKE_BOOT')

export const sandboxWakeBootProvider = {
  provide: SANDBOX_WAKE_BOOT,
  useFactory: (): SandboxWakeBoot =>
    new VercelSandboxWakeBoot((line) => new Logger('VercelSandboxWakeBoot').log(line)),
}

type WakeTarget = {
  threadId: string
  sandbox: {
    name: string
    state: string
    lastActivityAt: string
    driveName: string | null
    serveVersion: string | null
  }
}

/**
 * Recreates a parked sandbox and boots its serve: the stopped Vercel sandbox is deleted, the
 * thread's drive remounts on a fresh container, and serve comes up under a freshly minted token.
 * The row's sealedToken died at park, so the wake mints a new one and seals it onto the row —
 * the session's reconnect path verifies the same token the boot wrote into the sandbox.
 */
class VercelSandboxWakeBoot implements SandboxWakeBoot {
  constructor(private readonly log: (line: string) => void) {}

  async boot(args: WakeBootArgs): Promise<WakeBootResult> {
    const stale = await liveSdk
      .get({
        ...args.credentials,
        name: args.name,
        resume: false,
        signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS),
      })
      .catch((failure: unknown) => (isSandboxMissing(failure) ? undefined : Promise.reject(failure)))
    if (stale !== undefined) {
      await stale.delete({ signal: AbortSignal.timeout(SANDBOX_QUICK_TIMEOUT_MS) })
      this.log(`wake deleted parked sandbox ${args.name} before recreating it`)
    }
    await waitForDriveDetached({
      sdk: liveDriveSdk,
      credentials: args.credentials,
      name: args.driveName,
      retry: attachLagRetry,
    })
    const drive = await ensureDrive({
      sdk: liveDriveSdk,
      credentials: args.credentials,
      name: args.driveName,
      driveExisted: true,
    })
    const sandbox = await mountWithRetries({
      sdk: liveSdk,
      cloudUrl: args.cloudUrl,
      retry: attachLagRetry,
      imageOptimize: imageOptimizeRetry,
      log: this.log,
      credentials: args.credentials,
      name: args.name,
      image: args.image,
      drive,
      driveName: args.driveName,
      threadId: args.threadId,
      token: args.token,
      onCreate: () => Promise.resolve(),
    })
    const launch = createServeLauncher({ log: this.log })
    await launch({
      sandbox,
      token: args.token,
      cloudUrl: args.cloudUrl,
      desiredVersion: args.serveVersion,
    })
    return { serveUrl: await routedUrlWithRetries(sandbox) }
  }
}

/**
 * Wakes parked sandboxes when a PR/CI event targets their thread. Called from the mailbox after
 * the event row lands; resolves the thread through the subscription link, boots only parked
 * sandboxes inside the 24h wake window, and debounces per threadId so a check-run storm boots
 * once. Never throws into the delivery path — a failed wake is logged, the mailbox row stays.
 */
@Injectable()
export class GithubSandboxWakeService {
  private readonly logger = new Logger(GithubSandboxWakeService.name)
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    @Inject(SANDBOX_WAKE_BOOT) private readonly bootAdapter: SandboxWakeBoot,
  ) {}

  notifyEvent(args: { userId: string; repoFullName: string; prNumber: number }): void {
    void this.wakeTargets(args).catch((failure: unknown) => {
      const message = failure instanceof Error ? failure.message : String(failure)
      this.logger.warn(
        `sandbox wake for ${args.repoFullName}#${args.prNumber} (user ${args.userId}) failed: ${message}`,
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
          target.sandbox.lastActivityAt > wakeCutoff,
      )
    const seen = new Set<string>()
    for (const target of targets) {
      if (seen.has(target.threadId)) continue
      seen.add(target.threadId)
      this.debounceBoot(target)
    }
  }

  private debounceBoot(target: WakeTarget): void {
    const pending = this.debounce.get(target.threadId)
    if (pending !== undefined) {
      clearTimeout(pending)
      this.debounce.delete(target.threadId)
    }
    const timer = setTimeout(() => {
      this.debounce.delete(target.threadId)
      void this.bootParkedSandbox(target).catch((failure: unknown) => {
        const message = failure instanceof Error ? failure.message : String(failure)
        this.logger.warn(
          `wake boot of sandbox ${target.sandbox.name} (thread ${target.threadId}) failed: ${message}`,
        )
      })
    }, WAKE_DEBOUNCE_MS)
    this.debounce.set(target.threadId, timer)
  }

  private async bootParkedSandbox(target: WakeTarget): Promise<void> {
    const credentials = this.vercelCredentials()
    const token = randomBytes(32).toString('hex')
    const { serveUrl } = await this.bootAdapter.boot({
      credentials,
      name: target.sandbox.name,
      driveName: target.sandbox.driveName ?? driveNameFor({ threadId: target.threadId }),
      threadId: target.threadId,
      image: this.env.get('SANDBOX_IMAGE'),
      cloudUrl: this.env.get('ATLAS_CLOUD_URL') ?? 'https://api.byatlas.io',
      serveVersion: target.sandbox.serveVersion ?? undefined,
      token,
    })
    await db.cloudSandbox.update({
      where: { threadId: target.threadId },
      data: {
        state: ESandboxState.Running,
        serveUrl,
        tokenHash: hashSessionToken(token),
        sealedToken: this.cipher.encrypt(token),
        lastActivityAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    })
    this.logger.log(
      `woke sandbox ${target.sandbox.name} for thread ${target.threadId} — serve at ${serveUrl}`,
    )
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
