import { STREAM_EVENT_TYPES_VERSION, type StreamServerMessage } from '@dltech/atlas-protocol'

type ReadyFrame = Extract<StreamServerMessage, { type: 'ready' }>

export const readyFrameOf = (args: {
  version: number
  connectionId: string
  eventTypes: readonly string[] | undefined
}): ReadyFrame => {
  const base = { type: 'ready', v: args.version, connectionId: args.connectionId } as const
  if (args.eventTypes === undefined || args.version < STREAM_EVENT_TYPES_VERSION) return base
  return { ...base, eventTypes: [...args.eventTypes] }
}
