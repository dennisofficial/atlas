import type { EventDraft, SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'

import { TurnRunner, type PauseSignal, type TurnOutcome } from '../loop'

import { EChannelConnection, type RemoteDeltaChannel } from './remote-delta-channel'

export class RemoteTurnDetached extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RemoteTurnDetached'
  }
}

export const SERVE_DEFAULT_REPLAY_WINDOW_OUTCOMES = 2048

type Waiter = {
  resolve: (outcome: TurnOutcome) => void
  reject: (error: Error) => void
}

export class RemoteTurnRunner extends TurnRunner {
  private readonly channel: RemoteDeltaChannel
  private readonly wake: () => Promise<void>
  private readonly waiters: Waiter[] = []
  private readonly seenOutcomes = new Set<string>()
  private heldForReattach = false
  private driving = false

  constructor(args: { channel: RemoteDeltaChannel; wake: () => Promise<void> }) {
    super()
    this.channel = args.channel
    this.wake = args.wake

    this.channel.onTurnEnded((outcome) => {
      if (!this.isFirstSighting(outcome)) return
      this.waiters.shift()?.resolve(outcome)
    })
    this.channel.onConnection((connection) => {
      if (connection.state === EChannelConnection.Reattaching) {
        this.heldForReattach = true
        return
      }
      if (connection.state === EChannelConnection.Parked) {
        this.heldForReattach = false
        this.detachAll('The sandbox parked after this client lost its turn outcome.')
        return
      }
      if (connection.state !== EChannelConnection.Closed) return
      this.heldForReattach = false
      this.detachAll(connection.detail ?? 'The session socket closed mid-turn.')
    })
    this.channel.onReady((ready) => {
      if (!this.heldForReattach) return
      this.heldForReattach = false
      if (ready.turnInFlight) return
      this.detachAll('The sandbox finished the turn while this client was detached.')
    })
    this.channel.onServerError((failure) => {
      this.waiters.shift()?.reject(new Error(failure.message))
    })
    this.channel.onDetached?.((reason) => {
      this.heldForReattach = false
      this.detachAll(reason)
    })
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
    this.driving = true
    try {
      const state = this.channel.connection().state
      if (state === EChannelConnection.Closed || state === EChannelConnection.Parked) {
        await this.wake()
      }

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
          this.failAll(error instanceof Error ? error.message : 'the turn frame could not be sent')
        }
      })
    } finally {
      this.driving = false
    }
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
