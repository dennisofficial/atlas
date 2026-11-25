import type { ModelWaitObserver } from '@dltech/atlas-agent'
import {
  EWaitEpisodeKind,
  projectWaiting,
  waitEpisodeGroupKey,
  type RunId,
  type ThreadId,
  type RecordEvent,
  type WaitEpisodeRef,
  type WaitingForModel,
} from '@dltech/atlas-core'
import { logFieldsOf, type LogPort } from '@dltech/atlas-observability'

import type { AppendBody, SessionRecord } from './record/record-adapter'

type WaitingEvent = Extract<RecordEvent, { type: 'model-waiting' | 'model-wait-cleared' }>

const isWaitingEvent = (event: RecordEvent): event is WaitingEvent =>
  event.type === 'model-waiting' || event.type === 'model-wait-cleared'

const generationOf = (episode: WaitEpisodeRef): number =>
  episode.kind === EWaitEpisodeKind.Credential ? episode.generation : 0

const waitsOn = ({
  waits,
  threadId,
}: {
  waits: readonly WaitingForModel[]
  threadId: ThreadId
}): readonly WaitingForModel[] => waits.filter((wait) => wait.affectedThreadIds.includes(threadId))

const clearedDraftOf = (wait: WaitingForModel): AppendBody => ({
  type: 'model-wait-cleared',
  episode: wait.episode,
  cause: wait.cause,
})

const stillWaitingDraftsOf = ({
  wait,
  admitted,
}: {
  wait: WaitingForModel
  admitted: ThreadId
}): readonly AppendBody[] => {
  const affectedThreadIds = wait.affectedThreadIds.filter((threadId) => threadId !== admitted)
  if (affectedThreadIds.length === 0) return []
  return [{ type: 'model-waiting', waiting: { ...wait, affectedThreadIds } }]
}

export const modelWaitObserverOf = (args: {
  record: SessionRecord
  threadId: ThreadId
  newRunId: () => RunId
  log?: LogPort | undefined
}): ModelWaitObserver => {
  const openWaits = (): readonly WaitingForModel[] =>
    projectWaiting(args.record.eventCache().visibleEvents().filter(isWaitingEvent))

  const appendSafely = async (drafts: readonly AppendBody[]): Promise<void> => {
    try {
      await args.record.append({ threadId: args.threadId, runId: args.newRunId(), drafts })
    } catch (error) {
      args.log?.error({
        source: 'holder.model-wait',
        message: 'a model wait could not be recorded',
        ...logFieldsOf({ error }),
      })
    }
  }

  return {
    observe: async ({ threadId: waitingThread, waiting }) => {
      const group = waitEpisodeGroupKey(waiting.episode)
      const covered = openWaits().some(
        (current) =>
          waitEpisodeGroupKey(current.episode) === group &&
          generationOf(current.episode) >= generationOf(waiting.episode) &&
          current.affectedThreadIds.includes(waitingThread),
      )
      if (covered) return
      await appendSafely([{ type: 'model-waiting', waiting }])
    },
    admitted: async ({ threadId: waitingThread }) => {
      const cleared = waitsOn({ waits: openWaits(), threadId: waitingThread })
      if (cleared.length === 0) return
      await appendSafely(
        cleared.flatMap((wait) => [
          clearedDraftOf(wait),
          ...stillWaitingDraftsOf({ wait, admitted: waitingThread }),
        ]),
      )
    },
    blocked: ({ threadId }) => waitsOn({ waits: openWaits(), threadId }).length > 0,
  }
}
