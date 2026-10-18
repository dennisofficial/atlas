import { eventBodySchema, type EventDraft, type SaidFile, type SaidImage, type ThreadId } from '@dltech/atlas-core'

import { TurnRunner, type PauseSignal, type TurnOutcome } from '../loop'
import type { PendingSaid } from '../pending/pending-queue'

import { EClientRequest, takeBackPendingReplySchema } from './channel-wire'
import { EConnectionView, type ConnectionView } from './connection-view'
import type { RemoteDeltaChannel } from './remote-delta-channel'

export class RemoteTurnDetached extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RemoteTurnDetached'
  }
}

export const SERVE_DEFAULT_REPLAY_WINDOW_OUTCOMES = 2048

const draftsOf = (context: readonly unknown[]): readonly EventDraft[] | undefined => {
  const drafts: EventDraft[] = []
  for (const draft of context) {
    const parsed = eventBodySchema.safeParse(draft)
    if (!parsed.success) return undefined
    drafts.push(parsed.data)
  }
  return drafts
}

type Waiter = {
  resolve: (outcome: TurnOutcome) => void
  reject: (error: Error) => void
}

export class RemoteTurnRunner extends TurnRunner {
  private readonly channel: RemoteDeltaChannel
  private readonly wake: () => Promise<void>
  private readonly waiters: Waiter[] = []
  private readonly seenOutcomes = new Set<string>()
  private held = false
  private driving = false
  private readonly claimListeners = new Set<() => void>()

  constructor(args: { channel: RemoteDeltaChannel; wake: () => Promise<void> }) {
    super()
    this.channel = args.channel
    this.wake = args.wake

    this.channel.onTurnEnded((outcome) => {
      if (!this.isFirstSighting(outcome)) return
      this.waiters.shift()?.resolve(outcome)
    })
    this.channel.onConnection((connection) => this.handleConnection(connection))
    this.channel.onReady((ready) => {
      if (!this.held) return
      this.held = false
      if (ready.turnInFlight || this.channel.unackedSendCount() > 0) return
      this.detachAll('The sandbox finished the turn while this client was detached.')
    })
    this.channel.onServerError((failure) => {
      this.waiters.shift()?.reject(new Error(failure.message))
    })
    this.channel.onDetached?.((reason) => {
      this.held = false
      this.detachAll(reason)
    })
  }

  private handleConnection(connection: ConnectionView): void {
    const { state } = connection
    if (state === EConnectionView.Waking || state === EConnectionView.Updating || state === EConnectionView.Parked) {
      if (this.waiters.length === 0) return
      this.held = true
      if (state === EConnectionView.Parked) this.ensureAttached().catch(() => undefined)
      return
    }
    if (state !== EConnectionView.Disconnected && state !== EConnectionView.Detached) return
    this.held = false
    this.detachAll(connection.detail ?? 'The session socket closed mid-turn.')
  }

  turnInFlight(): boolean {
    return this.driving
  }

  onTurnClaimChanged(listener: () => void): () => void {
    this.claimListeners.add(listener)
    return () => {
      this.claimListeners.delete(listener)
    }
  }

  say(args: {
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    context?: readonly EventDraft[]
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    return this.drive({
      ...args,
      fire: () =>
        this.channel.send({
          text: args.text,
          images: args.images,
          files: args.files,
          ...(args.context === undefined ? {} : { context: args.context }),
        }),
    })
  }

  steer(args: {
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    context?: readonly EventDraft[]
  }): void {
    if (args.threadId !== this.channel.threadId) {
      throw new Error(`this runner serves ${this.channel.threadId}, not ${args.threadId}`)
    }
    this.channel.send({
      text: args.text,
      images: args.images,
      files: args.files,
      ...(args.context === undefined ? {} : { context: args.context }),
    })
  }

  async takeBackPending(args: { threadId: ThreadId }): Promise<PendingSaid | null> {
    if (args.threadId !== this.channel.threadId) return null

    let reply: unknown
    try {
      reply = await this.channel.request({
        op: EClientRequest.TakeBackPending,
        params: { threadId: this.channel.threadId },
      })
    } catch {
      return null
    }

    const parsed = takeBackPendingReplySchema.safeParse(reply)
    if (!parsed.success || parsed.data.taken === null) return null

    const { text, images, files, context } = parsed.data.taken
    const drafts = context === undefined ? undefined : draftsOf(context)
    return { text, images, files, ...(drafts === undefined ? {} : { context: drafts }) }
  }

  async ensureAttached(): Promise<void> {
    if (!this.needsAttachment()) return
    this.channel.beginWake()
    await this.wake()
  }

  private needsAttachment(): boolean {
    const state = this.channel.connection().state
    return state === EConnectionView.Parked ||
      state === EConnectionView.Waking ||
      state === EConnectionView.Disconnected
  }

  runTurn(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    return this.drive({ ...args, fire: () => this.channel.run() })
  }

  resume(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    return this.drive({ ...args, fire: () => this.channel.run({ resume: true }) })
  }

  private async drive(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
    pause?: PauseSignal | undefined
    fire: () => void
  }): Promise<TurnOutcome> {
    if (args.threadId !== this.channel.threadId) {
      throw new Error(`this runner serves ${this.channel.threadId}, not ${args.threadId}`)
    }

    if (this.driving) throw new Error('a turn is already running on this runner')
    this.setDriving(true)
    try {
      if (this.needsAttachment()) await this.ensureAttached()

      return await new Promise<TurnOutcome>((resolve, reject) => {
        const interrupt = () => this.channel.interrupt()
        const pauseTurn = () => this.channel.pause()
        const settle =
          <T>(done: (value: T) => void) =>
          (value: T) => {
            args.signal?.removeEventListener('abort', interrupt)
            unsubscribePause()
            done(value)
          }
        this.waiters.push({ resolve: settle(resolve), reject: settle(reject) })
        args.signal?.addEventListener('abort', interrupt)
        const unsubscribePause = args.pause?.onPause(pauseTurn) ?? (() => undefined)
        if (args.pause?.paused === true) pauseTurn()
        try {
          args.fire()
        } catch (error) {
          this.detachAll(error instanceof Error ? error.message : 'the turn frame could not be sent')
        }
      })
    } finally {
      this.setDriving(false)
    }
  }

  private setDriving(driving: boolean): void {
    this.driving = driving
    for (const listener of [...this.claimListeners]) listener()
  }

  private isFirstSighting(outcome: TurnOutcome): boolean {
    const key = `${outcome.runId}:${outcome.status}`
    if (this.seenOutcomes.has(key)) return false

    this.seenOutcomes.add(key)
    if (this.seenOutcomes.size > SERVE_DEFAULT_REPLAY_WINDOW_OUTCOMES) {
      const oldest = this.seenOutcomes.values().next().value
      if (oldest !== undefined) this.seenOutcomes.delete(oldest)
    }
    return true
  }

  private detachAll(reason: string): void {
    const detached = new RemoteTurnDetached(reason)
    while (this.waiters.length > 0) this.waiters.shift()?.reject(detached)
  }
}
