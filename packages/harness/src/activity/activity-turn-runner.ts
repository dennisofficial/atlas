import type { ThreadId } from '@dltech/atlas-core'

import { TurnRunner } from '../loop/turn-runner.port'
import type { TurnOutcome } from '../loop/turn-outcome'
import type { ActivityLifecycle } from './runtime-session-activity'

export class ActivityTurnRunner extends TurnRunner {
  constructor(private readonly deps: { inner: TurnRunner; lifecycle: ActivityLifecycle }) {
    super()
  }

  say(args: Parameters<TurnRunner['say']>[0]): Promise<TurnOutcome> {
    return this.invoke({ threadId: args.threadId, run: () => this.deps.inner.say(args) })
  }

  runTurn(args: Parameters<TurnRunner['runTurn']>[0]): Promise<TurnOutcome> {
    return this.invoke({ threadId: args.threadId, run: () => this.deps.inner.runTurn(args) })
  }

  resume(args: Parameters<TurnRunner['resume']>[0]): Promise<TurnOutcome> {
    return this.invoke({ threadId: args.threadId, run: () => this.deps.inner.resume(args) })
  }

  private async invoke(args: {
    threadId: ThreadId
    run: () => Promise<TurnOutcome>
  }): Promise<TurnOutcome> {
    const { threadId } = args
    this.deps.lifecycle.turnStarted({ threadId })
    try {
      const outcome = await args.run()
      this.deps.lifecycle.turnOutcome({ threadId, outcome })
      return outcome
    } catch (cause) {
      this.deps.lifecycle.turnFailed({ threadId })
      throw cause
    } finally {
      this.deps.lifecycle.turnEnded({ threadId })
    }
  }
}
