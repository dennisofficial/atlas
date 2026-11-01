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
  WAKE_FAILURE_BACKOFF_MS,
} from './github-sandbox-wake-linked'
import { LocalPodWakes } from './github-local-pod-wake'
import { GithubPrFanoutService } from './github-pr-fanout.service'
import { PARK_WAKE_WINDOW_MS } from './github-delivery-routing'
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
async function archivedThread(args: { threadId: string }): Promise<boolean> {
  const session = await sessionOfThread({ reader: db, threadId: args.threadId }).catch(() => null)
  return session?.archivedAt !== null && session?.archivedAt !== undefined
}

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
 * The wakeClaim CAS dedupes races between events and API instances before any Vercel call; the
 * claim reads as Resuming until serve's own mirror supersedes it. When the delivery carries the
 * event, the claim also appends it as a durable `pr-event` intent the booted pod pulls on hydrate.
 */
@Injectable()
export class GithubSandboxWakeService {
  private readonly logger = new Logger(GithubSandboxWakeService.name)
  private readonly debounce = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; target: WakeTarget; event: WakePrEvent | undefined }
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

  notifyEvent(args: WakeEventNotice, event?: WakePrEvent): void {
    this.track({
      inFlight: this.lookupsInFlight,
      work: this.wakeTargets(args, event).catch((failure: unknown) => {
        this.logger.warn(
          `sandbox wake for ${args.repoFullName}#${args.prNumber} (user ${args.userId}) failed: ${failureText(failure)}`,
        )
      }),
    })
  }

  async settle(): Promise<void> {
    await Promise.all([...this.lookupsInFlight])
    for (const { timer, target, event } of [...this.debounce.values()]) {
      clearTimeout(timer)
      this.debounce.delete(target.threadId)
      this.startBoot(target, event)
    }
    await Promise.all([...this.bootsInFlight])
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

  private startBoot(target: WakeTarget, event?: WakePrEvent): Promise<void> {
    const booted = this.bootParkedSandbox({ threadId: target.threadId }, event).catch(
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
    const subscribed = await sessionHoldsSubscription({
      threadIds: targets.map((target) => target.threadId),
      ...args,
    })
    const seen = new Set<string>()
    const immediateBoots: Promise<void>[] = []
    for (const target of targets) {
      if (!subscribed.has(target.threadId)) continue
      if (seen.has(target.threadId)) continue
      seen.add(target.threadId)
      const boot = this.debounceBoot(target, event)
      if (boot !== undefined) immediateBoots.push(boot)
    }
    await Promise.all(immediateBoots)
  }

  private debounceBoot(target: WakeTarget, event?: WakePrEvent): Promise<void> | undefined {
    if (this.inFlight.has(target.threadId)) {
      // A boot is already underway for this thread; its intent is still durable, so append it
      // even though the pod boot dedupes this event out.
      if (event !== undefined) void this.appendIntent({ threadId: target.threadId, event })
      return undefined
    }
    if (this.debounceMs === 0) return this.startBoot(target, event)
    const pending = this.debounce.get(target.threadId)
    if (pending !== undefined) {
      clearTimeout(pending.timer)
      this.debounce.delete(target.threadId)
    }
    const timer = setTimeout(() => {
      this.debounce.delete(target.threadId)
      this.startBoot(target, event)
    }, this.debounceMs)
    this.debounce.set(target.threadId, { timer, target, event })
    return undefined
  }

  /** Boot-failure retry, driven by the poll-sweep task: re-boots each parked sandbox whose last
   * wake failed past its backoff while its pod still holds an unconsumed wake intent. */
  async retryFailedWakes(): Promise<void> {
    for (const target of await failedWakeTargets()) {
      this.logger.log(
        `retrying the failed wake of sandbox ${target.sandbox.name} (thread ${target.threadId}) after backoff`,
      )
      this.startBoot(target)
    }
    await Promise.all([...this.bootsInFlight])
  }

  private async bootParkedSandbox(args: { threadId: string }, event?: WakePrEvent): Promise<void> {
    if (this.inFlight.has(args.threadId)) return
    this.inFlight.add(args.threadId)
    try {
      await this.claimAndBoot(args, event)
    } finally {
      this.inFlight.delete(args.threadId)
    }
  }

  private async claimAndBoot(args: { threadId: string }, event?: WakePrEvent): Promise<void> {
    const sessionId = await podSessionOf({ reader: db, threadId: args.threadId })
    const row = await db.orm.public.CloudSandbox.first({ sessionId })
    if (row === null || !wakeableOf(row)) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the row is no longer parked`)
      return
    }
    if (await archivedThread({ threadId: args.threadId })) {
      this.logger.log(`wake of thread ${args.threadId} skipped — the thread is archived`)
      return
    }
    // The intent is durable before the boot dedupe: append it regardless of whether this event
    // wins the claim, so a CAS loser still leaves its event for the pod to hydrate.
    if (event !== undefined) {
      await appendWakeIntent({ threadId: args.threadId, event, signals: this.signals })
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
