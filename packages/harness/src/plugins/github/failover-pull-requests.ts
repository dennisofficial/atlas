import type { LogPort } from '@dltech/atlas-core'

import {
  EFailoverDecision,
  EFailoverState,
  failoverDecision,
  isRealAnswer,
  probeDue,
  PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'

export { EFailoverState, PROBE_INTERVAL_MS } from './pure'

export class FailoverPullRequestPort extends PullRequestPort {
  private readonly primary: PullRequestPort & { dispose(): void }
  private readonly fallback: PullRequestPort
  private readonly onTransition: ((state: EFailoverState) => void) | undefined
  private readonly log: { port: LogPort } | undefined
  private readonly now: () => number
  private readonly listeners = new Set<() => void>()

  private state = EFailoverState.Realtime
  private lastProbeAt = 0
  private probing = false
  private disposed = false

  constructor(args: {
    primary: PullRequestPort & { dispose(): void }
    fallback: PullRequestPort
    onTransition?: (state: EFailoverState) => void
    log?: { port: LogPort }
    now?: () => number
  }) {
    super()
    this.primary = args.primary
    this.fallback = args.fallback
    this.onTransition = args.onTransition
    this.log = args.log
    this.now = args.now ?? Date.now
  }

  get pushes(): boolean {
    return this.state === EFailoverState.Realtime
  }

  read(request: { checkout: RepositoryCheckout }): Promise<PullRequestReading> {
    return this.answer({
      primary: () => this.primary.read(request),
      fallback: () => this.fallback.read(request),
    })
  }

  readLinked(args: { repo: string; number: number }): Promise<PullRequestReading> {
    return this.answer({
      primary: () => this.primary.readLinked(args),
      fallback: () => this.fallback.readLinked(args),
    })
  }

  override onPushesChanged(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  dispose(): void {
    this.disposed = true
    this.listeners.clear()
    this.primary.dispose()
  }

  private async answer(asks: {
    primary: () => Promise<PullRequestReading>
    fallback: () => Promise<PullRequestReading>
  }): Promise<PullRequestReading> {
    if (this.disposed) return asks.fallback()

    if (this.state === EFailoverState.Polling) {
      this.probeIfDue(asks.primary)
      return asks.fallback()
    }

    const reading = await asks.primary()
    const decision = failoverDecision({ state: this.state, reading })
    if (decision === EFailoverDecision.ReturnAsIs) return reading

    this.lastProbeAt = this.now()
    this.transition(EFailoverState.Polling)
    return asks.fallback()
  }

  private probeIfDue(ask: () => Promise<PullRequestReading>): void {
    if (this.probing || !probeDue({ lastProbeAt: this.lastProbeAt, now: this.now() })) return

    this.probing = true
    this.lastProbeAt = this.now()
    void ask()
      .then((reading) => {
        if (this.disposed || !isRealAnswer(reading)) return
        this.transition(EFailoverState.Realtime)
      })
      .catch(() => undefined)
      .finally(() => {
        this.probing = false
      })
  }

  private transition(next: EFailoverState): void {
    if (this.state === next) return

    this.state = next
    this.logTransition(next)
    this.onTransition?.(next)
    for (const listener of [...this.listeners]) listener()
  }

  private logTransition(next: EFailoverState): void {
    if (next === EFailoverState.Polling) {
      this.log?.port.warn({
        source: 'cloud.pull-requests',
        message: 'the cloud API is unreachable; polling gh until it answers',
      })
      return
    }

    this.log?.port.info({
      source: 'cloud.pull-requests',
      message: 'the cloud API answered again; realtime pull request tracking resumed',
    })
  }
}
