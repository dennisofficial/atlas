import type {
  EventDraft,
  EventLogPort,
  RunFailure,
  RunId,
  SaidFile,
  SaidImage,
  SaidUpload,
  ThreadId,
} from '@dltech/atlas-core'

import type { PauseSignal } from '../loop/pause-signal'

import { runFailureOf } from '../model/run-failure'
import { ETurnStatus, LoopTurnRunner, TurnRunner, type TurnDeps, type TurnOutcome } from '../loop'
import type { ThreadPublisher, DeltaChannel } from './delta-channel'
import { withDeltaPublishing } from './publishing-event-log'
import { EStepEnd } from './signal'

const endFor = (outcome: TurnOutcome): EStepEnd => {
  if (outcome.status === ETurnStatus.Failed) return EStepEnd.Failed
  if (outcome.status === ETurnStatus.Interrupted) return EStepEnd.Interrupted
  return EStepEnd.Completed
}

const appendRunFailed = async (args: {
  log: EventLogPort
  threadId: ThreadId
  runId: RunId
  failure: RunFailure
}): Promise<void> => {
  try {
    await args.log.append({
      threadId: args.threadId,
      runId: args.runId,
      drafts: [{ type: 'run-failed', failure: args.failure }],
    })
  } catch {
    return
  }
}

async function publishing(args: {
  publisher: ThreadPublisher
  log: EventLogPort
  threadId: ThreadId
  runId: () => RunId
  identity: { id: string; modelId: string }
  run: () => Promise<TurnOutcome>
}): Promise<TurnOutcome> {
  const failed = (failure: RunFailure, runId: RunId) =>
    appendRunFailed({ log: args.log, threadId: args.threadId, runId, failure })
  args.publisher.turnWorking({ working: true })
  try {
    const outcome = await args.run()
    args.publisher.close({ end: endFor(outcome) })
    return outcome
  } catch (error) {
    await failed(
      runFailureOf({
        message: error instanceof Error ? error.message : String(error),
        cause: error,
        escaped: true,
        providerId: args.identity.id,
        modelId: args.identity.modelId,
      }),
      args.runId(),
    )
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
    this.deps = {
      ...args.deps,
      log: withDeltaPublishing({ log: args.deps.log, channel: args.channel }),
    }
  }

  say(args: {
    threadId: ThreadId
    text: string
    images?: readonly SaidImage[]
    files?: readonly SaidFile[]
    uploads?: readonly SaidUpload[]
    context?: readonly EventDraft[]
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      ...this.publishingFor({ threadId: args.threadId, publisher }),
      run: () => runner.say(args),
    })
  }

  runTurn(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      ...this.publishingFor({ threadId: args.threadId, publisher }),
      run: () => runner.runTurn(args),
    })
  }

  resume(args: {
    threadId: ThreadId
    signal?: AbortSignal
    pause?: PauseSignal
  }): Promise<TurnOutcome> {
    const { publisher, runner } = this.runnerFor(args.threadId)
    return publishing({
      ...this.publishingFor({ threadId: args.threadId, publisher }),
      run: () => runner.resume(args),
    })
  }

  private publishingFor(args: { threadId: ThreadId; publisher: ThreadPublisher }) {
    return {
      publisher: args.publisher,
      log: this.deps.log,
      threadId: args.threadId,
      runId: () => this.deps.ids.nextRunId(),
      identity: this.deps.model.identity,
    }
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
