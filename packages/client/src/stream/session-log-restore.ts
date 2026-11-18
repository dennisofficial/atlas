import {
  initialFailureMessage,
  initialSessionViewState,
  isCommandLogEvent,
  isVisible,
  needsRebuild,
  rebuildEditSensitive,
  stepFailureMessage,
  stepPending,
  stepSessionViewWith,
  stepVisibility,
  type PluginViewFold,
  type V2Event,
} from '@dltech/atlas-core'

import type { SessionLog } from './session-log'
import type { SessionWindow } from './session-window'

export const restoredWindowOf = async (args: {
  log: SessionLog
  sessionId: string
  renderLimit: number
  views?: readonly PluginViewFold[] | undefined
}): Promise<SessionWindow | undefined> => {
  const { log, sessionId, renderLimit } = args
  const views = args.views ?? []
  const saved = await log.loadSnapshot(sessionId).catch(() => undefined)
  if (saved === undefined) return undefined
  const from = saved.throughSeq + 1
  const to = saved.cursor?.seq ?? saved.throughSeq
  const gap =
    to >= from
      ? await log
          .readRange({ sessionId, fromSeq: from, toSeq: to })
          .catch(() => [] as readonly V2Event[])
      : []
  const visibility = gap.reduce(stepVisibility, saved.visibility)
  const pending = gap.reduce(stepPending, saved.pending)
  const folded = gap.reduce(
    (state, event) => stepSessionViewWith({ state, views, event }),
    saved.view ?? initialSessionViewState,
  )
  const tail = await log.readTail({ sessionId, count: renderLimit }).catch(() => [])
  const events = tail.filter((event) => isVisible(visibility, event)).slice(-renderLimit)
  const view =
    gap.some(needsRebuild) && events.length > 0
      ? rebuildEditSensitive({ state: folded, visibleTail: events })
      : folded
  const failureMessage = gap.reduce(
    stepFailureMessage,
    saved.failureMessage ?? initialFailureMessage,
  )
  const commandLog = [...(saved.commandLog ?? []), ...gap.filter(isCommandLogEvent)]
  return { events, visibility, pending, view, failureMessage, commandLog, cursor: saved.cursor }
}

export const olderVisibleOf = async (args: {
  log: SessionLog
  sessionId: string
  window: SessionWindow
  count: number
}): Promise<readonly V2Event[]> => {
  const { log, sessionId, window, count } = args
  const oldest = window.events[0]?.seq
  if (oldest === undefined) return []
  const older = await log
    .readBefore({ sessionId, seq: oldest, count })
    .catch(() => [] as readonly V2Event[])
  return older.filter((event) => isVisible(window.visibility, event))
}
