import type { ThreadId } from '@dltech/atlas-core'

import { TurnRunner, type TurnOutcome } from '../loop'

import { EChannelConnection, type RemoteDeltaChannel } from './remote-delta-channel'

type Waiter = {
  resolve: (outcome: TurnOutcome) => void
  reject: (error: Error) => void
}

/**
 * Drives turns on the sandbox rather than in-process: what was said is already durable in the
 * remote log, so a turn is a bare run frame and the outcome arrives as a broadcast. Outcomes are
 * matched to callers in the order they were asked, which is the order the sandbox ends them.
 */
export class RemoteTurnRunner extends TurnRunner {
  private readonly channel: RemoteDeltaChannel
  private readonly wake: () => Promise<void>
  private readonly waiters: Waiter[] = []

  constructor(args: { channel: RemoteDeltaChannel; wake: () => Promise<void> }) {
    super()
    this.channel = args.channel
    this.wake = args.wake

    this.channel.onTurnEnded((outcome) => {
      this.waiters.shift()?.resolve(outcome)
    })
    this.channel.onConnection((connection) => {
      if (connection.state !== EChannelConnection.Closed) return
      this.failAll(connection.detail ?? 'The session socket closed mid-turn.')
    })
    this.channel.onServerError((failure) => {
      this.waiters.shift()?.reject(new Error(failure.message))
    })
  }

  say(args: { threadId: ThreadId; text: string; signal?: AbortSignal }): Promise<TurnOutcome> {
    return this.drive({ ...args, fire: () => this.channel.send({ text: args.text }) })
  }

  runTurn(args: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    return this.drive({ ...args, fire: () => this.channel.run() })
  }

  resume(args: { threadId: ThreadId; signal?: AbortSignal }): Promise<TurnOutcome> {
    return this.drive({ ...args, fire: () => this.channel.run() })
  }

  private async drive(args: {
    threadId: ThreadId
    signal?: AbortSignal | undefined
    fire: () => void
  }): Promise<TurnOutcome> {
    if (args.threadId !== this.channel.threadId) {
      throw new Error(`this runner serves ${this.channel.threadId}, not ${args.threadId}`)
    }

    const state = this.channel.connection().state
    if (state === EChannelConnection.Closed || state === EChannelConnection.Parked) {
      await this.wake()
    }

    return new Promise<TurnOutcome>((resolve, reject) => {
      const interrupt = () => this.channel.interrupt()
      const settle = <T>(done: (value: T) => void) => (value: T) => {
        args.signal?.removeEventListener('abort', interrupt)
        done(value)
      }
      this.waiters.push({ resolve: settle(resolve), reject: settle(reject) })
      args.signal?.addEventListener('abort', interrupt)
      args.fire()
    })
  }

  private failAll(reason: string): void {
    const error = new Error(reason)
    while (this.waiters.length > 0) this.waiters.shift()?.reject(error)
  }
}
