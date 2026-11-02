import { noContentDraft, type ModelStepResult, type RunId, type ThreadId } from '@dltech/atlas-core'

import { appendPending } from './pending-intake'
import { appendShellCompletionNudge } from './shell-completion'
import type { TrackedTurnDeps } from './tracked-turn-deps'
import { nudgeSilentStep } from './turn-faults'
import { ETurnStatus, type TurnOutcome } from './turn-outcome'
import { messageArrivedSince } from './turn-position'
import type { TurnPosition } from './turn-position-state'

export type QuietStep = { kind: 'continue' } | { kind: 'done'; outcome: TurnOutcome }

const CONTINUE: QuietStep = { kind: 'continue' }

export async function closeQuietStep({
  deps,
  position,
  stepped,
  threadId,
  runId,
  signal,
  interrupted,
}: {
  deps: TrackedTurnDeps
  position: TurnPosition
  stepped: ModelStepResult
  threadId: ThreadId
  runId: RunId
  signal: AbortSignal
  interrupted: () => Promise<TurnOutcome>
}): Promise<QuietStep> {
  const { log, ids } = deps
  const latest = await log.read({ threadId })
  if (messageArrivedSince({ events: latest, seenThrough: position.seenThrough })) {
    await appendShellCompletionNudge({ log, threadId, runId, seenThrough: position.seenThrough })
    position.silentSteps = 0
    position.silentRetries = 0
    return CONTINUE
  }

  const speech = await appendPending({
    drain: deps.drainPending,
    log,
    ids,
    threadId,
    signal,
  })
  if (!speech.ok) {
    if (signal.aborted) return { kind: 'done', outcome: await interrupted() }
    throw speech.cause
  }
  if (speech.wakesTurn) {
    position.silentSteps = 0
    position.silentRetries = 0
    return CONTINUE
  }

  const silenced = await nudgeSilentStep({
    result: stepped,
    threadId,
    runId,
    log,
    silentSteps: position.silentSteps,
  })
  if (silenced.kind === 'failed') {
    return {
      kind: 'done',
      outcome: {
        status: ETurnStatus.Failed,
        runId,
        message: silenced.message,
        cause: silenced.cause,
      },
    }
  }
  if (silenced.kind === 'nudged') {
    position.silentSteps += 1
    position.resetAssembly()
    return CONTINUE
  }
  if (silenced.kind === 'no-content') {
    await log.append({ threadId, runId, drafts: [noContentDraft()] })
  }

  const closing = (await deps.hooks?.afterTurn({ threadId })) ?? []
  if (closing.length > 0) await log.append({ threadId, runId, drafts: closing })

  return { kind: 'done', outcome: { status: ETurnStatus.Completed, runId } }
}
