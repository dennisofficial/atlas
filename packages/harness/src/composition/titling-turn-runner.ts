import {
  ENoticeTone,
  NOTICE_WARN_MS,
  type EventLogPort,
  type NoticePort,
  type ThreadId,
} from '@dltech/atlas-core'

import type { Unsubscribe } from '../channel/delta-channel'

import { sessionDigest } from '../model/session-digest'
import { TurnRunner, type TurnOutcome } from '../loop'
import type { TurnRunner as TurnRunnerShape } from '../loop/turn-runner.port'
import type { ThreadStorePort } from '../store/thread-store'

const TITLE_NOTICE_KEY = 'session-titler'

/**
 * Titling is a session behavior, not a surface one: the first turn names the thread no matter
 * which surface drove it, so serve threads carry the same titles a terminal session would. The
 * ask rides the first commit's own await (the write path already runs before any turn), and a
 * titler that declines or fails is silent — a title that never arrives must never hold up or
 * fail the turn it was taken from. `/rename` and the TUI's own naming settle the same row, so
 * this only ever asks for a thread that is still unnamed.
 */
export class TitlingTurnRunner extends TurnRunner {
  private readonly inner: TurnRunnerShape
  private readonly log: EventLogPort
  private readonly threads: Pick<ThreadStorePort, 'find' | 'rename'>
  private readonly titler: (args: { text: string }) => Promise<string | null>
  private readonly notice: NoticePort
  private readonly asked = new Set<ThreadId>()
  private readonly inFlight = new Set<ThreadId>()
  private readonly listeners = new Map<ThreadId, Set<(titling: boolean) => void>>()

  constructor(args: {
    inner: TurnRunnerShape
    log: EventLogPort
    threads: Pick<ThreadStorePort, 'find' | 'rename'>
    titler: (args: { text: string }) => Promise<string | null>
    notice: NoticePort
  }) {
    super()
    this.inner = args.inner
    this.log = args.log
    this.threads = args.threads
    this.titler = args.titler
    this.notice = args.notice
  }

  async say(args: { threadId: ThreadId; text: string; signal?: AbortSignal }): Promise<TurnOutcome> {
    const outcome = await this.inner.say(args)
    void this.titleOnce({ threadId: args.threadId })
    return outcome
  }

  async runTurn(args: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    const outcome = await this.inner.runTurn(args)
    void this.titleOnce({ threadId: args.threadId })
    return outcome
  }

  resume(args: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    return this.inner.resume(args)
  }

  /**
   * Whether a first-message titling ask is in flight for the thread — the surface shimmers the
   * opening line off this while it waits, the way it already shimmers a `/rename` ask off the
   * composer's own naming state.
   */
  titling(args: { threadId: ThreadId }): boolean {
    return this.inFlight.has(args.threadId)
  }

  onTitling(args: { threadId: ThreadId; listener: (titling: boolean) => void }): Unsubscribe {
    const existing = this.listeners.get(args.threadId) ?? new Set()
    existing.add(args.listener)
    this.listeners.set(args.threadId, existing)
    return () => {
      existing.delete(args.listener)
      if (existing.size === 0) this.listeners.delete(args.threadId)
    }
  }

  private setTitling(args: { threadId: ThreadId; titling: boolean }): void {
    if (args.titling) {
      this.inFlight.add(args.threadId)
    } else {
      this.inFlight.delete(args.threadId)
    }
    for (const listener of [...(this.listeners.get(args.threadId) ?? [])]) {
      listener(args.titling)
    }
  }

  private async titleOnce(args: { threadId: ThreadId }): Promise<void> {
    if (this.asked.has(args.threadId)) return
    this.asked.add(args.threadId)
    this.setTitling({ threadId: args.threadId, titling: true })

    try {
      const thread = await this.threads.find({ threadId: args.threadId })
      if (thread !== undefined && thread.title !== undefined) return

      const events = await this.log.read({ threadId: args.threadId })
      const digest = sessionDigest(events)
      if (digest.trim().length === 0) return

      const named = await this.titler({ text: digest })
      if (named === null) return

      const still = await this.threads.find({ threadId: args.threadId })
      if (still !== undefined && still.title !== undefined) return
      await this.threads.rename({ threadId: args.threadId, title: named })
    } catch (error) {
      this.notice.notify({
        key: TITLE_NOTICE_KEY,
        tone: ENoticeTone.Warn,
        ttlMs: NOTICE_WARN_MS,
        text: `this session could not be titled: ${error instanceof Error ? error.message : String(error)}`,
      })
    } finally {
      this.setTitling({ threadId: args.threadId, titling: false })
    }
  }
}
