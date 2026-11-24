import {
  initialFailureMessage,
  foldableOf,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  isCommandLogEvent,
  isDurable,
  visibleWithin,
  needsRebuild,
  rebuildEditSensitive,
  stepFailureMessage,
  stepPending,
  stepSessionViewWith,
  stepVisibility,
  type PluginViewFold,
  type SessionViewState,
  type V2Event,
} from '@dltech/atlas-core'

import { quickStopEvidenceRowsOf } from '../session/quick-stop-restore'
import type { SessionLog, SessionLogSnapshot } from './session-log'
import type { SessionWindow } from './session-window'

type RefoldArgs = {
  log: SessionLog
  sessionId: string
  views: readonly PluginViewFold[]
  throughSeq: number
}

const refoldViewOf = async (args: RefoldArgs): Promise<SessionViewState | undefined> => {
  const cached = await args.log
    .readRange({ sessionId: args.sessionId, fromSeq: 1, toSeq: args.throughSeq })
    .catch(() => undefined)
  if (cached === undefined || cached[0]?.seq !== 1) return undefined
  return cached.reduce(
    (state, event) => stepSessionViewWith({ state, views: args.views, event }),
    initialSessionViewState,
  )
}

const baseViewOf = async (
  args: RefoldArgs & { saved: SessionLogSnapshot },
): Promise<SessionViewState | undefined> => {
  const view = args.saved.view
  if (view === undefined) return initialSessionViewState
  if (view.version === SESSION_VIEW_VERSION) return view
  return refoldViewOf({ ...args, throughSeq: args.saved.throughSeq })
}

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
  const base = await baseViewOf({ log, sessionId, views, throughSeq: saved.throughSeq, saved })
  if (base === undefined) return undefined
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
  const folded = gap.reduce((state, event) => stepSessionViewWith({ state, views, event }), base)
  const tail = await log.readTail({ sessionId, count: renderLimit }).catch(() => [])
  const events = visibleWithin({ state: visibility, events: tail }).slice(-renderLimit)
  const durable = [...(saved.durable ?? []), ...gap.filter((event) => isDurable(event.type))]
  const foldable = foldableOf({ visible: events, durable })
  const view =
    gap.some(needsRebuild) && events.length > 0
      ? rebuildEditSensitive({ state: folded, visibleTail: events, foldableTail: foldable })
      : folded
  const failureMessage = gap.reduce(
    stepFailureMessage,
    saved.failureMessage ?? initialFailureMessage,
  )
  const commandLog = [...(saved.commandLog ?? []), ...gap.filter(isCommandLogEvent)]
  return {
    events,
    visibility,
    pending,
    view,
    failureMessage,
    durable,
    foldable,
    commandLog,
    quickStopRows: quickStopEvidenceRowsOf(tail),
    cursor: saved.cursor,
    foldedThrough: 0,
  }
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
  return visibleWithin({ state: window.visibility, events: older })
}
