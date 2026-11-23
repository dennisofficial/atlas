import { Inject, Injectable, Logger } from '@nestjs/common'

import { db } from '@dltech/atlas-db'
import { EnvService } from '../../../_core/config/env/env.service'
import { BackgroundWork } from '../../../_core/ports/background-work'
import { SandboxCredentials } from '../../../_core/ports/sandbox-credentials'
import { SecretCipherService } from '../../../_lib/crypto/secret-cipher.service'
import {
  wakeableOf,
  type SandboxLifecycleColumns,
} from '../../platform/sandboxes/sandbox-lifecycle'
import { ThreadSignalsService } from '../../platform/sessions/thread-signals.service'
import {
  failedWakeTargets,
  linkedThreadsOf,
  owedWakeTargets,
  WAKE_FAILURE_BACKOFF_MS,
  type FailedWakeTarget,
} from './github-sandbox-wake-linked'
import { LocalPodWakes } from './github-local-pod-wake'
import { GithubPrFanoutService } from '@dltech/atlas-github'
import { PARK_WAKE_WINDOW_MS } from '@dltech/atlas-github'
import { podSessionOf, sessionOfThread } from '../../platform/sessions/session-of-thread'
import { WAKE_DEBOUNCE, WAKE_DEBOUNCE_MS } from './github-sandbox-wake-debounce'
import { sessionHoldsSubscription } from './github-sandbox-wake-subscribers'
import { failureText, SANDBOX_WAKE_BOOT, type SandboxWakeBoot } from './github-sandbox-wake-boot'
import {
  appendWakeIntent,
  type WakeEventNotice,
  type WakePrEvent,
} from './github-sandbox-wake-intent'
import { bootClaimedSandbox, type WakeLaunchDeps } from './github-sandbox-wake-launch'

export { WAKE_DEBOUNCE_MS }
export { WAKE_FAILURE_BACKOFF_MS }

export type { SandboxWakeBoot, WakeBootArgs, WakeBootResult } from './github-sandbox-wake-boot'
async function retiredThread(args: { threadId: string }): Promise<boolean> {
  const session = await sessionOfThread({ reader: db, threadId: args.threadId }).catch(() => null)
  if (session === null) return false
  return session.archivedAt !== null || session.deletedAt !== null
}

const subjectOf = (notice: WakeEventNotice): string =>
  notice.kind === 'workflow-run'
    ? `${notice.repoFullName} workflow run`
    : `${notice.repoFullName}#${notice.prNumber}`

type WakeTarget = {
  threadId: string
  sandbox: SandboxLifecycleColumns & {
    name: string
    lastActivityAt: Date
    wakeFailedAt: Date | null
  }
}

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
  private readonly localPods: LocalPodWakes

  constructor(
    private readonly env: EnvService,
    private readonly cipher: SecretCipherService,
    private readonly credentials: SandboxCredentials,
    @Inject(SANDBOX_WAKE_BOOT) private readonly bootAdapter: SandboxWakeBoot,
    @Inject(BackgroundWork) private readonly background: BackgroundWork,
    @Inject(WAKE_DEBOUNCE) private readonly debounceMs: number,
    private readonly signals: ThreadSignalsService,
    fanout: GithubPrFanoutService,
  ) {
    this.localPods = new LocalPodWakes(fanout)
  }

  notifyEvent(args: WakeEventNotice, event?: WakePrEvent): Promise<void> {
    const tracked = this.track({
      inFlight: this.lookupsInFlight,
      work: this.wakeTargets(args, event).catch((failure: unknown) => {
        this.logger.warn(
          `sandbox wake for ${subjectOf(args)} (user ${args.userId}) failed: ${failureText(failure)}`,
        )
        throw failure
      }),
    })
    tracked.catch(() => undefined)

    return tracked
  }

  async settle(): Promise<void> {
    await Promise.allSettled([...this.lookupsInFlight])
    for (const { timer, target } of [...this.debounce.values()]) {
      clearTimeout(timer)
      this.debounce.delete(target.threadId)
      this.startBoot(target)
    }
    await Promise.allSettled([...this.bootsInFlight])
  }

  private track(args: { inFlight: Set<Promise<void>>; work: Promise<void> }): Promise<void> {
    const tracked = args.work.finally(() => args.inFlight.delete(tracked))
    args.inFlight.add(tracked)
    this.background.keepAlive(tracked)
    return tracked
  }

  private appendIntent(args: { threadId: string; event: WakePrEvent }): Promise<void> {
    return appendWakeIntent({ threadId: args.threadId, event: args.event, signals: this.signals })
  }

  private startBoot(target: WakeTarget): Promise<void> {
    const booted = this.bootParkedSandbox({ threadId: target.threadId }).catch(
      (failure: unknown) => {
        this.logger.warn(
          `wake boot of sandbox ${target.sandbox.name} (thread ${target.threadId}) failed: ${failureText(failure)}`,
        )
      },
    )
    return this.track({ inFlight: this.bootsInFlight, work: booted })
  }

  private async wakeTargets(args: WakeEventNotice, event?: WakePrEvent): Promise<void> {
    const { subscriptions, sandboxes } = await linkedThreadsOf(args)
    await this.localPods.push({
      userId: args.userId,
      subscriptions,
      cloudThreadIds: new Set(sandboxes.keys()),
    })
    const wakeCutoff = Date.now() - PARK_WAKE_WINDOW_MS
    const backoffCutoff = Date.now() - WAKE_FAILURE_BACKOFF_MS
    const targets = subscriptions
      .flatMap((subscription): WakeTarget[] => {
        const sandbox = sandboxes.get(subscription.threadId)
        return sandbox === undefined ? [] : [{ threadId: subscription.threadId, sandbox }]
      })
      .filter(
        (target) =>
          wakeableOf(target.sandbox) &&
          target.sandbox.lastActivityAt.getTime() > wakeCutoff &&
          (target.sandbox.wakeFailedAt === null ||
            target.sandbox.wakeFailedAt.getTime() < backoffCutoff),
      )
    const subscribed =
      args.kind === 'workflow-run'
        ? new Set(targets.map((target) => target.threadId))
        : await sessionHoldsSubscription({
            threadIds: targets.map((target) => target.threadId),
            repoFullName: args.repoFullName,
            prNumber: args.prNumber,
          })
    const seen = new Set<string>()
    const immediateBoots: Promise<void>[] = []
    for (const target of targets) {
      if (!subscribed.has(target.threadId)) continue
      if (seen.has(target.threadId)) continue
      seen.add(target.threadId)
      if (event !== undefined) await this.appendIntent({ threadId: target.threadId, event })
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

  async retryFailedWakes(): Promise<void> {
    const targets = new Map<string, FailedWakeTarget>()
    for (const target of [...(await failedWakeTargets()), ...(await owedWakeTargets())]) {
      targets.set(target.threadId, target)
    }
    for (const target of targets.values()) {
      if (this.inFlight.has(target.threadId) || this.debounce.has(target.threadId)) continue
      this.logger.log(
        `retrying the owed wake of sandbox ${target.sandbox.name} (thread ${target.threadId})`,
      )
      this.startBoot(target)
    }
    await Promise.all([...this.bootsInFlight])
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
    const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null || !wakeableOf(row)) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the row is no longer parked`)
      return
    }
    if (await retiredThread({ threadId: args.threadId })) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the thread is archived or deleted`)
      return
    }
    const wakeClaim = new Date()
    const claimed = await db.orm.public.CloudSandbox.where({
      sessionId: row.sessionId,
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
    await this.signals.podChanged({ threadId: args.threadId })
    try {
      await bootClaimedSandbox(this.launchDeps(), { row, threadId: args.threadId })
    } catch (failure) {
      await this.releaseClaim({ threadId: args.threadId, sessionId: row.sessionId, wakeClaim })
      throw failure
    }
  }

  private launchDeps(): WakeLaunchDeps {
    return {
      env: this.env,
      cipher: this.cipher,
      credentials: this.credentials,
      bootAdapter: this.bootAdapter,
      signals: this.signals,
      logger: this.logger,
    }
  }

  private async releaseClaim(args: {
    threadId: string
    sessionId: string
    wakeClaim: Date
  }): Promise<void> {
    const at = new Date()
    await db.orm.public.CloudSandbox.where({
      sessionId: args.sessionId,
      wakeClaim: args.wakeClaim,
    }).updateAndCount({ wakeClaim: null, wakeFailedAt: at, updatedAt: at })
    await this.signals.podChanged({ threadId: args.threadId })
  }
}
