import {
  checkoutKey,
  EForge,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../plugins/github/pure'
import { EGithubPrStreamFrame } from '@dltech/atlas-wire'

import type { CloudSession } from './cloud-session'
import { CloudError, type TransportRetryLog } from './cloud-transport'
import { deliverPrEvent, type PrEventFrame } from './pr-event-frame'
import { runSseStream, SseRefused } from './sse-client'
import { PrSubscriptionClient, type SubscriptionHandle } from './pr-subscription-client'
import {
  createAppInstallRaiser,
  type AppInstallRaiser,
  type AppInstallRecommended,
} from './app-install-recommendation'
import { createHeartbeatLoop, type HeartbeatLoop } from './sse-heartbeat-loop'
import { resolveSseClock, type SsePullRequestClock } from './sse-pull-request-clock'
import { createRecovery, type Recovery } from './sse-recovery'
import { refreshSubscriptions } from './sse-catch-up'
import { createSseSubscriptionBook, type SseSubscriptionBook } from './sse-pull-request-book'
import {
  GITHUB_HOST,
  repoFullNameOf,
  subscribeTargetOf,
  unavailable,
} from './sse-pull-request-readings'
import { createSessionHealth, type SessionHealth } from './sse-session-health'

const HEARTBEAT_MS = 60_000
const DISPOSE_GRACE_MS = 2_000

export class SsePullRequestPort extends PullRequestPort {
  readonly pushes = true

  private readonly client: PrSubscriptionClient
  private readonly book: SseSubscriptionBook
  private readonly clock: Required<SsePullRequestClock>

  private stream: AbortController | null = null
  private readonly heartbeat: HeartbeatLoop
  private readonly recovery: Recovery
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly health: SessionHealth
  private readonly silenceTimeoutMs: number | undefined
  private readonly log: TransportRetryLog | undefined
  private readonly onPrEvent: ((frame: PrEventFrame) => void) | undefined
  private readonly raiseAppInstall: AppInstallRaiser
  private catchingUp: { generation: number; pending: Promise<void> } | null = null
  private generation = 0
  private disposed = false

  constructor(args: {
    session: CloudSession
    clientVersion: string
    onReading: (args: { key: string; reading: PullRequestReading }) => void
    onPrEvent?: (frame: PrEventFrame) => void
    onAppInstallRecommended?: AppInstallRecommended
    clock?: SsePullRequestClock
    silenceTimeoutMs?: number
    log?: TransportRetryLog
  }) {
    super()
    this.log = args.log
    this.health = createSessionHealth({ log: args.log })
    this.onPrEvent = args.onPrEvent
    this.raiseAppInstall = createAppInstallRaiser({
      onRecommended: args.onAppInstallRecommended,
      log: args.log,
    })
    this.silenceTimeoutMs = args.silenceTimeoutMs
    this.clock = resolveSseClock(args.clock)
    this.client = new PrSubscriptionClient({
      session: args.session,
      clientVersion: args.clientVersion,
      ...(args.log === undefined ? {} : { log: args.log }),
    })
    this.book = createSseSubscriptionBook({
      now: this.clock.now,
      onReading: (readingArgs) => args.onReading(readingArgs),
    })
    this.recovery = createRecovery({
      clock: this.clock,
      attempt: () => this.recoverSession(),
    })
    this.heartbeat = createHeartbeatLoop({
      intervalMs: HEARTBEAT_MS,
      clock: this.clock,
      book: this.book,
      beat: (beatArgs) => this.client.heartbeat(beatArgs),
      onEmpty: () => this.scheduleDispose(),
      onNeedsCatchUp: () => this.catchUpFromHeartbeat(),
    })
  }

  async read({ checkout }: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    if (checkout.forge !== EForge.GitHub || checkout.remote.host !== GITHUB_HOST) {
      return unavailable(false)
    }

    return this.subscribe({
      key: checkoutKey(checkout),
      repoFullName: `${checkout.remote.owner}/${checkout.remote.repo}`,
      by: { kind: 'branch', branch: checkout.branch },
    })
  }

  async readLinked(args: { repo: string; number: number }): Promise<PullRequestReading> {
    const repoFullName = repoFullNameOf(args.repo)
    if (repoFullName === null) return unavailable(false)

    return this.subscribe({
      key: `${args.repo}#${args.number}`,
      repoFullName,
      by: { kind: 'number', number: args.number },
    })
  }

  dispose(): void {
    this.disposed = true
    this.generation += 1
    if (this.disposeTimer !== null) {
      this.clock.clearTimeoutFn(this.disposeTimer)
      this.disposeTimer = null
    }
    this.recovery.reset()
    this.heartbeat.stop()
    this.stream?.abort()
    this.stream = null
    this.book.clear()
  }

  private async subscribe(args: {
    key: string
    repoFullName: string
    by: { kind: 'branch'; branch: string } | { kind: 'number'; number: number }
  }): Promise<PullRequestReading> {
    if (this.disposed) return unavailable(false)
    const held = this.book.holding({ key: args.key })
    if (held !== null && !this.health.isDead()) {
      this.ensureStream()
      return held.reading
    }

    let outcome
    try {
      outcome = await this.client.subscribe(
        subscribeTargetOf({ repoFullName: args.repoFullName, by: args.by }),
      )
    } catch (failure) {
      if (failure instanceof CloudError && failure.status === 404 && args.by.kind === 'branch') {
        return unavailable(true)
      }
      if (failure instanceof CloudError && (failure.status === 401 || failure.status === 403)) {
        this.noteSessionRefused()
      }
      return unavailable(true)
    }

    if (this.disposed) return unavailable(false)
    this.noteSessionAlive()

    const handle: SubscriptionHandle = { id: outcome.id, repoFullName: args.repoFullName }
    const reading = this.book.recordSubscribe({
      key: args.key,
      handle,
      by: args.by,
      state: outcome.state,
      pollBacked: outcome.pollBacked,
    })
    this.raiseAppInstall(outcome)
    this.ensureStream()
    this.heartbeat.start()
    return reading
  }

  private ensureStream(): void {
    if (this.disposed || this.stream !== null) return

    const controller = new AbortController()
    this.stream = controller

    void runSseStream({
      ...this.client.streamEndpoint(),
      signal: controller.signal,
      ...(this.silenceTimeoutMs === undefined ? {} : { silenceTimeoutMs: this.silenceTimeoutMs }),
      handlers: {
        onOpen: () => {
          this.generation += 1
          return this.catchUp({ controller, generation: this.generation })
        },
        onFrame: (frame) => {
          if (frame.type === EGithubPrStreamFrame.PrEvent) {
            deliverPrEvent({ event: frame.event, onPrEvent: this.onPrEvent, log: this.log })
            return
          }
          this.book.applyFrame({ state: frame.state })
        },
        onDrop: () => {
          if (controller.signal.aborted) return
          this.generation += 1
          this.book.markAllStale()
        },
      },
    })
      .catch((failure: unknown) => {
        if (controller.signal.aborted || this.stream !== controller) return
        if (failure instanceof SseRefused) {
          this.noteSessionRefused()
          return
        }
        this.book.markAllStale()
      })
      .finally(() => {
        if (this.stream === controller) this.stream = null
      })
  }

  private catchUp(args: { controller: AbortController; generation: number }): Promise<void> {
    if (this.catchingUp?.generation === args.generation) return this.catchingUp.pending
    const pending = refreshSubscriptions({
      controller: args.controller,
      generation: args.generation,
      currentGeneration: () => this.generation,
      book: this.book,
      client: this.client,
      raiseAppInstall: this.raiseAppInstall,
      noteAlive: () => this.noteSessionAlive(),
    }).finally(() => {
      if (this.catchingUp?.pending === pending) this.catchingUp = null
    })
    this.catchingUp = { generation: args.generation, pending }
    return pending
  }

  private catchUpFromHeartbeat(): void {
    const controller = this.stream
    if (controller === null || controller.signal.aborted) return
    const generation = this.generation
    void this.catchUp({ controller, generation }).catch((failure: unknown) => {
      if (
        !(failure instanceof SseRefused) ||
        this.stream !== controller ||
        generation !== this.generation
      )
        return
      controller.abort()
      this.stream = null
      this.noteSessionRefused()
    })
  }

  private noteSessionRefused(): void {
    this.health.noteDead()
    this.heartbeat.stop()
    this.book.markAllStale()
    this.recovery.schedule()
  }

  private recoverSession(): void {
    if (this.disposed || this.book.size() === 0) return
    this.ensureStream()
    this.heartbeat.start()
  }

  private noteSessionAlive(): void {
    this.recovery.reset()
    this.health.noteAlive()
  }

  private scheduleDispose(): void {
    if (this.disposeTimer !== null) return

    this.disposeTimer = this.clock.setTimeoutFn(() => {
      this.disposeTimer = null
      if (this.book.size() > 0) return
      this.stream?.abort()
      this.stream = null
    }, DISPOSE_GRACE_MS)
    this.disposeTimer.unref?.()
  }
}
