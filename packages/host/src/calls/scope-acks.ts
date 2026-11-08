import type { LogPort } from '@dltech/atlas-observability'

import { ProtocolViolationError, ReadyTimeoutError } from './errors'
import type { DaemonLink } from './link'
import type { CallTimers } from './remote-calls'

export const ACK_TIMEOUT_MS = 10_000

type ScopeAcksArgs = {
  timers: CallTimers
  sessionId: string
  log?: LogPort | undefined
  link: DaemonLink
  epoch(): number
  gone(): boolean
  readyWithin(signal: AbortSignal): Promise<unknown>
}

type Waiting = { settle(found: boolean): void }

export class ScopeAcks {
  private readonly waiting = new Map<string, Waiting>()

  constructor(private readonly args: ScopeAcksArgs) {}

  async ack(args: { key: string }): Promise<boolean> {
    if (this.args.gone()) return false
    const deadline = new AbortController()
    const timer = this.args.timers.setTimeout(() => deadline.abort(), ACK_TIMEOUT_MS)
    try {
      const found = await this.ackWithin({ key: args.key, signal: deadline.signal })
      if (!found && deadline.signal.aborted) this.warnExpired(args.key)
      return found
    } finally {
      this.args.timers.clearTimeout(timer)
    }
  }

  async scope(args: { scopeKey: string; count?: number | undefined }): Promise<void> {
    if (args.count !== undefined) {
      for (let index = args.count - 1; index >= 0; index -= 1) {
        await this.ack({ key: `${args.scopeKey}.${index}` })
      }
      return
    }
    for (let index = 0; ; index += 1) {
      if (!(await this.ack({ key: `${args.scopeKey}.${index}` }))) return
    }
  }

  flush(): number {
    const keys = [...this.waiting.keys()]
    for (const key of keys) this.send(key)
    return keys.length
  }

  settle(args: { key: string; found: boolean }): boolean {
    const entry = this.waiting.get(args.key)
    if (entry === undefined) return false
    entry.settle(args.found)
    return true
  }

  releaseAll(): void {
    for (const entry of [...this.waiting.values()]) entry.settle(false)
  }

  private async ackWithin(args: { key: string; signal: AbortSignal }): Promise<boolean> {
    try {
      await this.args.readyWithin(args.signal)
    } catch (error) {
      if (this.args.gone() || error instanceof ReadyTimeoutError) return false
      throw new ProtocolViolationError('the daemon link failed before the ack could be sent')
    }
    if (this.args.gone() || args.signal.aborted) return false
    return this.reply(args)
  }

  private reply(args: { key: string; signal: AbortSignal }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const entry: Waiting = {
        settle: (found) => {
          if (this.waiting.get(args.key) === entry) this.waiting.delete(args.key)
          args.signal.removeEventListener('abort', handleExpiry)
          resolve(found)
        },
      }
      const handleExpiry = (): void => entry.settle(false)
      this.waiting.get(args.key)?.settle(false)
      this.waiting.set(args.key, entry)
      args.signal.addEventListener('abort', handleExpiry, { once: true })
      if (this.args.link.ready) this.send(args.key)
    })
  }

  private warnExpired(key: string): void {
    this.args.log?.warn({
      source: 'calls.ack',
      message: `ack of ${key} went unanswered for ${ACK_TIMEOUT_MS} ms`,
      data: { sessionId: this.args.sessionId, key, linkReady: this.args.link.ready },
    })
  }

  private send(key: string): void {
    this.args.link.send({ kind: 'ack', key, epoch: this.args.epoch() })
  }
}
