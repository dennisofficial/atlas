import type { EventDraft, SaidFile, SaidImage, ThreadId } from '@dltech/atlas-core'

import type { PauseSignal } from '../loop/pause-signal'

import { ETurnStatus, LoopTurnRunner, TurnRunner, type TurnDeps, type TurnOutcome } from '../loop'
import type { ThreadPublisher, DeltaChannel } from './delta-channel'
import { withDeltaPublishing } from './publishing-event-log'
import { EStepEnd } from './signal'

const endFor = (outcome: TurnOutcome): EStepEnd => {
  if (outcome.status === ETurnStatus.Failed) return EStepEnd.Failed
  if (outcome.status === ETurnStatus.Interrupted) return EStepEnd.Interrupted
  return EStepEnd.Completed
}

async function publishing(args: {
  publisher: ThreadPublisher
  run: () => Promise<TurnOutcome>
}): Promise<TurnOutcome> {
  args.publisher.turnWorking({ working: true })
  try {
    const outcome = await args.run()
    args.publisher.close({ end: endFor(outcome) })
    return outcome
  } catch (error) {
    args.publisher.close({ end: EStepEnd.Failed })
    throw error
  } finally {
    args.publisher.turnWorking({ working: false })
  }
}

export class PublishingTurnRunner extends TurnRunner {
  private readonly channel: DeltaChannel
  private readonly deps: TurnDeps

  constructor(args: { channel: DeltaChannel; deps: TurnDeps }) {
    super()
    this.channel = args.channel
    this.deps = { ...args.deps, log: withDeltaPublishing({ log: args.deps.log, channel: args.channel }) }
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
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      publisher,
      run: () => runner.say(args),
    })
  }

  runTurn(args: { threadId: ThreadId; signal?: AbortSignal; pause?: PauseSignal }): Promise<TurnOutcome> {
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      publisher,
      run: () => runner.runTurn(args),
    })
  }

  resume(args: { threadId: ThreadId; signal?: AbortSignal; pause?: PauseSignal }): Promise<TurnOutcome> {
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      publisher,
      run: () => runner.resume(args),
    })
  }

  private runnerFor(threadId: ThreadId): { publisher: ThreadPublisher; runner: TurnRunner } {
    const publisher = this.channel.publisherFor({ threadId, filter: this.deps.onChunk })
    const runner = new LoopTurnRunner({
      ...this.deps,
      onChunk: publisher.onChunk,
      onToolOutput: (output) => {
        publisher.toolOutput(output)
        this.deps.onToolOutput?.(output)
      },
      retry: {
        ...this.deps.retry,
        onWaiting: (notice) => {
          publisher.retrying(notice)
          this.deps.retry?.onWaiting?.(notice)
        },
      },
    })
    return { publisher, runner }
  }
}
