import {
  v2EventSchema,
  visibleWithin,
  type V2Event,
  type VisibilityState,
} from '@dltech/atlas-core'
import type { z } from 'zod'

import type { OlderEventsPage, StreamTransport } from './stream-ports'

export const OLDER_FETCH_LIMIT = 400

export const OLDER_FETCH_ATTEMPTS = 5

export type OlderFetch = (input: {
  sessionId: string
  afterSeq: number
  limit: number
}) => Promise<OlderEventsPage>

export const fetchOlderOf = (args: {
  transport: StreamTransport
  threadId: string | undefined
}): { fetchOlder?: OlderFetch } => {
  const events = args.transport.events
  if (events === undefined) return {}
  const threadId = args.threadId
  return {
    fetchOlder: (input) => events({ ...input, ...(threadId === undefined ? {} : { threadId }) }),
  }
}

export type OlderPageFetch = (input: {
  afterSeq: number
  limit: number
}) => Promise<OlderEventsPage>

export type OlderFetchArgs = {
  fetchOlder: OlderPageFetch
  beforeSeq: number
  count: number
  visibility: VisibilityState
  eventSchema?: z.ZodType<V2Event> | undefined
}

const visibleBetween = (args: {
  page: OlderEventsPage
  afterSeq: number
  beforeSeq: number
  eventSchema: z.ZodType<V2Event>
  visibility: VisibilityState
}): V2Event[] =>
  visibleWithin({
    state: args.visibility,
    events: args.page.events.flatMap((raw) => {
      const parsed = args.eventSchema.safeParse(raw)
      if (!parsed.success) return []
      if (parsed.data.seq <= args.afterSeq || parsed.data.seq >= args.beforeSeq) return []
      return [parsed.data]
    }),
  })

export const olderOverHttp = async (args: OlderFetchArgs): Promise<readonly V2Event[]> => {
  const eventSchema = args.eventSchema ?? v2EventSchema
  const collected: V2Event[] = []
  let boundary = args.beforeSeq
  for (
    let attempt = 0;
    attempt < OLDER_FETCH_ATTEMPTS && collected.length < args.count && boundary > 1;
    attempt += 1
  ) {
    const afterSeq = Math.max(0, boundary - 1 - OLDER_FETCH_LIMIT)
    const page = await args
      .fetchOlder({ afterSeq, limit: OLDER_FETCH_LIMIT })
      .catch(() => undefined)
    if (page === undefined) break
    const events = visibleBetween({
      page,
      afterSeq,
      beforeSeq: boundary,
      eventSchema,
      visibility: args.visibility,
    })
    collected.unshift(...events)
    if (afterSeq === 0) break
    boundary = afterSeq + 1
  }
  return collected.slice(-args.count)
}
