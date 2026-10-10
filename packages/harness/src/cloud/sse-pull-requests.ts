import {
  checkoutKey,
  EForge,
  EPullRequestLookup,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../plugins/github/pure'
import type { CloudSession } from './cloud-session'
import { CloudError, type TransportRetryLog } from './cloud-transport'
import { deliverPrEvent, type PrEventFrame } from './pr-event-frame'
import { runSseStream, SseRefused } from './sse-client'
import {
  PrSubscriptionClient,
  type SubscriptionHandle,
} from './pr-subscription-client'
import { createHeartbeatLoop, type HeartbeatLoop } from './sse-heartbeat-loop'
import { resolveSseClock, type SsePullRequestClock } from './sse-pull-request-clock'
import {
  createSseSubscriptionBook,
  type SseSubscriptionBook,
} from './sse-pull-request-book'

const GITHUB_HOST = 'github.com'

const HEARTBEAT_MS = 60_000
const DISPOSE_GRACE_MS = 2_000

const unavailable = (retryable: boolean): PullRequestReading => ({
  lookup: EPullRequestLookup.Unavailable,
  retryable,
})

export class SsePullRequestPort extends PullRequestPort {
  readonly pushes = true

  private readonly client: PrSubscriptionClient
  private readonly book: SseSubscriptionBook
  private readonly clock: Required<SsePullRequestClock>

  private stream: AbortController | null = null
  private readonly heartbeat: HeartbeatLoop
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private sessionDead = false
  private readonly silenceTimeoutMs: number | undefined
  private readonly log: TransportRetryLog | undefined
  private readonly onPrEvent: ((frame: PrEventFrame) => void) | undefined
  private catchingUp: { generation: number; pending: Promise<void> } | null = null
  private generation = 0
  private disposed = false

  constructor(args: {
    session: CloudSession
    clientVersion: string
    onReading: (args: { key: string; reading: PullRequestReading }) => void
    onPrEvent?: (frame: PrEventFrame) => void
    clock?: SsePullRequestClock
    silenceTimeoutMs?: number
    log?: TransportRetryLog
  }) {
    super()
    this.log = args.log
    this.onPrEvent = args.onPrEvent
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
    if (held !== null && !this.sessionDead) {
      this.ensureStream()
      return held.reading
    }

    let outcome
    try {
      outcome = await this.client.subscribe({
        repoFullName: args.repoFullName,
        ...(args.by.kind === 'branch' ? { branch: args.by.branch } : { number: args.by.number }),
      })
    } catch (failure) {
      if (failure instanceof CloudError && failure.status === 404 && args.by.kind === 'branch') {
        return unavailable(true)
      }
      if (failure instanceof CloudError && (failure.status === 401 || failure.status === 403)) {
        this.noteSessionDead()
        this.book.markAllStale()
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
    })
    this.ensureStream()
    this.heartbeat.start()
    return reading
  }

  private ensureStream(): void {
    if (this.disposed || this.stream !== null) return

    const controller = new AbortController()
    this.stream = controller

    void runSseStream({
      url: this.client.streamUrl(),
      token: this.client.token(),
      clientVersion: this.client.clientVersionHeader(),
      signal: controller.signal,
      ...(this.silenceTimeoutMs === undefined ? {} : { silenceTimeoutMs: this.silenceTimeoutMs }),
      handlers: {
        onOpen: () => {
          this.generation += 1
          return this.catchUp({ controller, generation: this.generation })
        },
        onFrame: (frame) => {
          if (frame.event === 'pr-event') {
            deliverPrEvent({ data: frame.data, onPrEvent: this.onPrEvent, log: this.log })
            return
          }
          if (frame.event !== 'pr-state') return
          this.book.applyFrame({ data: frame.data })
        },
        onDrop: () => {
          if (controller.signal.aborted) return
          this.generation += 1
          this.book.markAllStale()
        },
      },
    }).catch((failure: unknown) => {
      if (controller.signal.aborted || this.stream !== controller) return
      if (failure instanceof SseRefused) {
        this.noteSessionDead()
        this.heartbeat.stop()
      }
      this.book.markAllStale()
    }).finally(() => {
      if (this.stream === controller) this.stream = null
    })
  }

  private catchUp(args: { controller: AbortController; generation: number }): Promise<void> {
    if (this.catchingUp?.generation === args.generation) return this.catchingUp.pending
    const pending = this.refreshSubscriptions(args).finally(() => {
      if (this.catchingUp?.pending === pending) this.catchingUp = null
    })
    this.catchingUp = { generation: args.generation, pending }
    return pending
  }

  private async refreshSubscriptions({ controller, generation }: {
    controller: AbortController
    generation: number
  }): Promise<void> {
    for (const entry of this.book.entries()) {
      if (controller.signal.aborted || generation !== this.generation) return
      try {
        const outcome = await this.client.subscribe({
          repoFullName: entry.handle.repoFullName,
          ...(entry.by.kind === 'branch'
            ? { branch: entry.by.branch }
            : { number: entry.by.number }),
        })
        if (controller.signal.aborted || generation !== this.generation) return
        this.book.recordResubscribe({
          key: entry.key,
          handle: { id: outcome.id, repoFullName: entry.handle.repoFullName },
          state: outcome.state,
        })
      } catch (failure) {
        if (controller.signal.aborted || generation !== this.generation) return
        if (failure instanceof CloudError && (failure.status === 401 || failure.status === 403)) {
          throw new SseRefused(failure.status)
        }
        throw failure
      }
    }
    this.noteSessionAlive()
  }

  private catchUpFromHeartbeat(): void {
    const controller = this.stream
    if (controller === null || controller.signal.aborted) return
    const generation = this.generation
    void this.catchUp({ controller, generation }).catch((failure: unknown) => {
      if (!(failure instanceof SseRefused) || this.stream !== controller || generation !== this.generation) return
      this.noteSessionDead()
      this.book.markAllStale()
      this.heartbeat.stop()
      controller.abort()
      this.stream = null
    })
  }

  private noteSessionDead(): void {
    if (this.sessionDead) return
    this.sessionDead = true
    this.log?.port.warn({
      source: 'cloud.pull-requests',
      message: 'the cloud API rejected the pull request session; realtime tracking is dead until it answers again',
    })
  }

  private noteSessionAlive(): void {
    if (!this.sessionDead) return
    this.sessionDead = false
    this.log?.port.info({
      source: 'cloud.pull-requests',
      message: 'the cloud API accepts the pull request session again; realtime tracking resumed',
    })
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

const repoFullNameOf = (repo: string): string | null => {
  const [host, owner, name, ...extra] = repo.split('/')
  if (extra.length > 0 || host !== GITHUB_HOST || owner === undefined || name === undefined) {
    return null
  }
  return `${owner}/${name}`
}
