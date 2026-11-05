import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { HostPresence, HostTimers } from './ports'

const REGISTER_RETRY_BASE_MS = 250
const REGISTER_RETRY_CAP_MS = 5_000

export class HolderPresence {
  private hostId: number | undefined
  private unsubscribe: (() => void) | undefined
  private retryTimer: unknown
  private failures = 0
  private stopped = false

  constructor(
    private readonly args: {
      presence: HostPresence
      timers: HostTimers
      log: LogPort | undefined
      onLost(hostId: number): void
      onRegistered(): void
    },
  ) {}

  current(): number | undefined {
    return this.hostId
  }

  async start(): Promise<void> {
    this.unsubscribe = this.args.presence.onLost((hostId) => this.handleLost(hostId))
    this.hostId = await this.args.presence.register()
  }

  stop(): void {
    this.stopped = true
    this.unsubscribe?.()
    this.cancelRetry()
  }

  async abandon(): Promise<void> {
    if (this.hostId === undefined) return
    await this.args.presence.abandon(this.hostId)
  }

  private handleLost(hostId: number): void {
    if (hostId !== this.hostId) return
    this.hostId = undefined
    this.args.onLost(hostId)
    if (this.stopped) return
    void this.reregister()
  }

  private async reregister(): Promise<void> {
    try {
      const hostId = await this.args.presence.register()
      if (this.stopped) return
      this.hostId = hostId
      this.failures = 0
      this.args.onRegistered()
    } catch (error) {
      this.args.log?.error({
        source: 'holder.presence',
        message: 'registering a new host presence failed',
        ...logFieldsOf({ error }),
      })
      this.scheduleRetry()
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== undefined) return
    const delay = Math.min(REGISTER_RETRY_BASE_MS * 2 ** this.failures, REGISTER_RETRY_CAP_MS)
    this.failures += 1
    this.retryTimer = this.args.timers.setTimeout(() => {
      this.retryTimer = undefined
      void this.reregister()
    }, delay)
  }

  private cancelRetry(): void {
    if (this.retryTimer === undefined) return
    this.args.timers.clearTimeout(this.retryTimer)
    this.retryTimer = undefined
  }
}
