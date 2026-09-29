import {
  checkoutKey,
  EForge,
  EPullRequestLookup,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from '../plugins/github/pure'
import type { CloudSession } from './cloud-session'
import { CloudError } from './cloud-transport'
import { runSseStream, SseRefused } from './sse-client'
import {
  PrSubscriptionClient,
  type SubscriptionHandle,
} from './pr-subscription-client'
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

export type SsePullRequestClock = {
  now?: () => number
  setIntervalFn?: typeof setInterval
  clearIntervalFn?: typeof clearInterval
  setTimeoutFn?: typeof setTimeout
  clearTimeoutFn?: typeof clearTimeout
}

/**
 * The push-fed pull request port. A read subscribes (idempotently) and answers from the
 * subscribe's catch-up pull; from then on the shared SSE stream feeds `onReading`, which the
 * plugin wires into the same readings store the `gh` poller writes. `pushes` is true, so the
 * service arms no poll timer — the only interval this port holds is the subscription
 * heartbeat, and the stream's own reconnect carries a catch-up resubscribe.
 *
 * Nothing throws out of `read`/`readLinked`: a refused stream (dead cloud session) reads as
 * retryable `Unavailable` and re-probes on the next read, so a recovered session self-heals rather
 * than pinning the last good frame; everything else is retryable too, and the last good frame stays
 * on screen through either, per the readings store's shown-vs-answers split.
 */
export class SsePullRequestPort extends PullRequestPort {
  readonly pushes = true

  private readonly client: PrSubscriptionClient
  private readonly book: SseSubscriptionBook
  private readonly clock: Required<SsePullRequestClock>

  private stream: AbortController | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private disposeTimer: ReturnType<typeof setTimeout> | null = null
  private sessionDead = false

  constructor(args: {
    session: CloudSession
    clientVersion: string
    onReading: (args: { key: string; reading: PullRequestReading }) => void
    clock?: SsePullRequestClock
  }) {
    super()
    this.clock = {
      now: args.clock?.now ?? Date.now,
      setIntervalFn: args.clock?.setIntervalFn ?? setInterval,
      clearIntervalFn: args.clock?.clearIntervalFn ?? clearInterval,
      setTimeoutFn: args.clock?.setTimeoutFn ?? setTimeout,
      clearTimeoutFn: args.clock?.clearTimeoutFn ?? clearTimeout,
    }
    this.client = new PrSubscriptionClient({
      session: args.session,
      clientVersion: args.clientVersion,
    })
    this.book = createSseSubscriptionBook({
      now: this.clock.now,
      onReading: (readingArgs) => args.onReading(readingArgs),
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
    if (this.disposeTimer !== null) {
      this.clock.clearTimeoutFn(this.disposeTimer)
      this.disposeTimer = null
    }
    this.stopHeartbeat()
    this.stream?.abort()
    this.stream = null

    const handles = this.book.handles()
    this.book.clear()
    for (const handle of handles) void this.client.unsubscribe({ id: handle.id }).catch(() => {})
  }

  private async subscribe(args: {
    key: string
    repoFullName: string
    by: { kind: 'branch'; branch: string } | { kind: 'number'; number: number }
  }): Promise<PullRequestReading> {
    // A held entry answers only while the stream is live; once it has died the held reading is
    // exactly the stale tally that must not be served again, so a dead session falls through to a
    // fresh subscribe — which doubles as the probe of whether the session recovered (token rotated,
    // network back) and as the catch-up REST fill the stream can no longer deliver. An Absent entry
    // is held too: it is a live branch subscription awaiting the discovery push, not a failed read.
    const held = this.book.holding({ key: args.key })
    if (held !== null && !this.sessionDead) return held.reading

    let outcome
    try {
      outcome = await this.client.subscribe({
        repoFullName: args.repoFullName,
        ...(args.by.kind === 'branch' ? { branch: args.by.branch } : { number: args.by.number }),
      })
    } catch (failure) {
      // A legacy server 404s a branch subscribe with no open PR. Holding nothing keeps every read
      // a fresh probe, and retryable keeps that probe on the backoff cadence rather than the
      // five-minute settled one — that re-subscribe is the only discovery path a legacy server has.
      if (failure instanceof CloudError && failure.status === 404 && args.by.kind === 'branch') {
        return unavailable(true)
      }
      if (failure instanceof SseRefused) this.sessionDead = true
      return unavailable(true)
    }

    this.sessionDead = false

    const handle: SubscriptionHandle = { id: outcome.id, repoFullName: args.repoFullName }
    const reading = this.book.recordSubscribe({
      key: args.key,
      handle,
      by: args.by,
      state: outcome.state,
    })
    this.ensureStream()
    this.startHeartbeat()
    return reading
  }

  private ensureStream(): void {
    if (this.stream !== null) return

    const controller = new AbortController()
    this.stream = controller

    void runSseStream({
      url: this.client.streamUrl(),
      token: this.client.token(),
      clientVersion: this.client.clientVersionHeader(),
      signal: controller.signal,
      handlers: {
        onFrame: (frame) => {
          if (frame.event !== 'pr-state') return
          this.book.applyFrame({ data: frame.data })
        },
        onDrop: () => {
          if (controller.signal.aborted) return
          this.stream = null
          this.book.markAllStale()
          void this.catchUp()
        },
      },
    }).catch((failure: unknown) => {
      if (failure instanceof SseRefused) {
        // Refused is a liveness fact, not a dead reading: mark stale (retryable) so the last good
        // tally stays shown while a later read re-probes, rather than freezing it as the answer.
        this.sessionDead = true
        this.book.markAllStale()
        this.stream = null
      }
    })
  }

  private async catchUp(): Promise<void> {
    for (const entry of this.book.entries()) {
      try {
        const outcome = await this.client.subscribe({
          repoFullName: entry.handle.repoFullName,
          ...(entry.by.kind === 'branch'
            ? { branch: entry.by.branch }
            : { number: entry.by.number }),
        })
        this.book.recordResubscribe({
          key: entry.key,
          handle: { id: outcome.id, repoFullName: entry.handle.repoFullName },
          state: outcome.state,
        })
      } catch (failure) {
        if (failure instanceof SseRefused) {
          this.sessionDead = true
          this.book.markAllStale()
          return
        }
      }
    }

    if (this.book.size() > 0) this.ensureStream()
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== null) return

    this.heartbeat = this.clock.setIntervalFn(() => {
      if (this.book.size() === 0) {
        this.stopHeartbeat()
        this.scheduleDispose()
        return
      }
      for (const entry of this.book.entries()) {
        void this.client.heartbeat({ id: entry.handle.id }).catch(() => {})
      }
    }, HEARTBEAT_MS)
    this.heartbeat.unref?.()
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return
    this.clock.clearIntervalFn(this.heartbeat)
    this.heartbeat = null
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
