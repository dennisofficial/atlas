import {
  foldableOf,
  SESSION_VIEW_VERSION,
  recordEventSchema,
  type RecordEvent,
} from '@dltech/atlas-core'
import type { StreamServerMessage } from '@dltech/atlas-protocol'
import type { z } from 'zod'

import { EMPTY_QUICK_STOP_STATE } from '../session/quick-stop-state'
import type { FollowedState } from './follower-state'
import { isView, isVisibility } from './session-log-record'
import { resetWindow, type SessionWindow } from './session-window'

type BaseMessage = Extract<StreamServerMessage, { type: 'base' }>

const readableEventsOf = (args: {
  raw: readonly unknown[]
  eventSchema: z.ZodType<RecordEvent>
}): RecordEvent[] =>
  args.raw.flatMap((raw) => {
    const parsed = args.eventSchema.safeParse(raw)
    return parsed.success ? [parsed.data] : []
  })

export const windowOfBase = (args: {
  message: BaseMessage
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): SessionWindow | undefined => {
  const { message } = args
  if (!isVisibility(message.visibility)) return undefined
  if (!isView(message.view) || message.view.version !== SESSION_VIEW_VERSION) return undefined
  const eventSchema = args.eventSchema ?? recordEventSchema
  const durable = readableEventsOf({ raw: message.durable, eventSchema })
  return {
    events: [],
    visibility: message.visibility,
    pending: message.view.pending,
    view: message.view,
    failureMessage: message.view.failure,
    durable,
    foldable: foldableOf({ visible: [], durable }),
    commandLog: readableEventsOf({ raw: message.commandLog, eventSchema }),
    quickStops: EMPTY_QUICK_STOP_STATE,
    cursor: message.cursor,
    foldedThrough: message.view.at,
  }
}

export const basedStateOf = (args: {
  inner: FollowedState
  message: BaseMessage
  eventSchema?: z.ZodType<RecordEvent> | undefined
}): FollowedState | undefined => {
  const window = windowOfBase({ message: args.message, eventSchema: args.eventSchema })
  if (window === undefined) return undefined
  return {
    ...args.inner,
    window,
    setupOutput: '',
    shells: {},
    live: false,
    skipped: 0,
    fromCache: false,
  }
}

export const resetStateOf = (inner: FollowedState): FollowedState => ({
  ...inner,
  window: resetWindow(),
  setupOutput: '',
  shells: {},
  live: false,
  skipped: 0,
  fromCache: false,
})
