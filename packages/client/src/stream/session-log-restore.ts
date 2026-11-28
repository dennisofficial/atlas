import {
  initialFailureMessage,
  foldableOf,
  initialSessionViewState,
  SESSION_VIEW_VERSION,
  isCommandLogEvent,
  retainedOf,
  visibleWithin,
  needsRebuild,
  rebuildEditSensitive,
  stepFailureMessage,
  stepPending,
  stepSessionViewWith,
  stepVisibility,
  type PluginViewFold,
  type SessionViewState,
  type RecordEvent,
} from '@dltech/atlas-core'

import { EStreamCacheOutcome } from '@dltech/atlas-protocol'

import { EMPTY_QUICK_STOP_STATE, stepQuickStop } from '../session/quick-stop-state'
import type { SessionLog, SessionLogSnapshot } from './session-log'
import type { SessionWindow } from './session-window'

type RefoldArgs = {
  log: SessionLog
  sessionId: string
  views: readonly PluginViewFold[]
  throughSeq: number
}

const refoldViewOf = async (args: RefoldArgs): Promise<SessionViewState | undefined> => {
  const cached = await args.log.readRange({
    sessionId: args.sessionId,
    fromSeq: 1,
    toSeq: args.throughSeq,
  })
  if (cached[0]?.seq !== 1 || cached.at(-1)?.seq !== args.throughSeq) return undefined
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
  return refoldViewOf({
    ...args,
    throughSeq: Math.max(args.saved.throughSeq, args.saved.foldedThrough ?? 0),
  })
}

type RestoreArgs = {
  log: SessionLog
  sessionId: string
  renderLimit: number
  views?: readonly PluginViewFold[] | undefined
}

const windowOf = async (
  args: RestoreArgs & { saved: SessionLogSnapshot },
): Promise<SessionWindow | undefined> => {
  const { log, sessionId, renderLimit, saved } = args
  const views = args.views ?? []
  const base = await baseViewOf({ log, sessionId, views, throughSeq: saved.throughSeq, saved })
  if (base === undefined) return undefined
  const from = saved.throughSeq + 1
  const to = saved.cursor?.seq ?? saved.throughSeq
  const gap = to >= from ? await log.readRange({ sessionId, fromSeq: from, toSeq: to }) : []
  const unfolded = gap.filter((event) => event.seq > (saved.foldedThrough ?? 0))
  const visibility = unfolded.reduce(stepVisibility, saved.visibility)
  const pending = unfolded.reduce(stepPending, saved.pending)
  const folded = unfolded.reduce(
    (state, event) => stepSessionViewWith({ state, views, event }),
    base,
  )
  const tail = await log.readTail({ sessionId, count: renderLimit })
  const events = visibleWithin({ state: visibility, events: tail }).slice(-renderLimit)
  const durable = retainedOf({
    events: [...(saved.durable ?? []), ...gap, ...tail],
    before: events[0]?.seq ?? Number.POSITIVE_INFINITY,
  })
  const foldable = foldableOf({ visible: events, durable })
  const view =
    unfolded.some(needsRebuild) && events.length > 0
      ? rebuildEditSensitive({ state: folded, visibleTail: events, foldableTail: foldable })
      : folded
  const failureMessage = unfolded.reduce(
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
    quickStops: gap.reduce(stepQuickStop, saved.quickStops ?? EMPTY_QUICK_STOP_STATE),
    cursor: saved.cursor,
    foldedThrough: saved.foldedThrough ?? 0,
  }
}

export type SessionLogRestore =
  | { outcome: EStreamCacheOutcome.Restored; window: SessionWindow }
  | {
      outcome: EStreamCacheOutcome.Empty | EStreamCacheOutcome.Unusable | EStreamCacheOutcome.Failed
      window: undefined
    }

export const restoredWindowResultOf = async (args: RestoreArgs): Promise<SessionLogRestore> => {
  try {
    const saved = await args.log.loadSnapshot(args.sessionId)
    if (saved === undefined) return { outcome: EStreamCacheOutcome.Empty, window: undefined }
    if (saved.cursor === undefined)
      return { outcome: EStreamCacheOutcome.Unusable, window: undefined }
    const window = await windowOf({ ...args, saved })
    return window === undefined
      ? { outcome: EStreamCacheOutcome.Unusable, window: undefined }
      : { outcome: EStreamCacheOutcome.Restored, window }
  } catch {
    return { outcome: EStreamCacheOutcome.Failed, window: undefined }
  }
}

export const restoredWindowOf = async (args: RestoreArgs): Promise<SessionWindow | undefined> =>
  (await restoredWindowResultOf(args)).window

export const olderVisibleOf = async (args: {
  log: SessionLog
  sessionId: string
  window: SessionWindow
  count: number
}): Promise<readonly RecordEvent[]> => {
  const { log, sessionId, window, count } = args
  const oldest = window.events[0]?.seq
  if (oldest === undefined) return []
  const older = await log
    .readBefore({ sessionId, seq: oldest, count })
    .catch(() => [] as readonly RecordEvent[])
  return visibleWithin({ state: window.visibility, events: older })
}
