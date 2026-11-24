import type { V2Event } from '@dltech/atlas-core'
import type { z } from 'zod'

import type { SessionLog } from './session-log'
import { olderVisibleOf } from './session-log-restore'
import { olderOverHttp, type OlderFetch } from './session-older'
import { OLDER_PAGE, type SessionWindow } from './session-window'

export type OlderWindowArgs = {
  log: SessionLog
  sessionId: string
  window: SessionWindow
  count: number
  fetchOlder?: OlderFetch | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
}

const olderWindowOf = async (args: OlderWindowArgs): Promise<readonly V2Event[]> => {
  const cached = await olderVisibleOf({
    log: args.log,
    sessionId: args.sessionId,
    window: args.window,
    count: args.count,
  })
  if (cached.length > 0) return cached
  const fetchOlder = args.fetchOlder
  const oldest = args.window.events[0]?.seq
  if (fetchOlder === undefined || oldest === undefined || oldest <= 1) return []
  return olderOverHttp({
    fetchOlder: (input) => fetchOlder({ ...input, sessionId: args.sessionId }),
    beforeSeq: oldest,
    count: args.count,
    visibility: args.window.visibility,
    eventSchema: args.eventSchema,
  })
}

export type OlderLoaderArgs = {
  log: SessionLog
  sessionId: string
  windowOf: () => SessionWindow
  extend: (visible: readonly V2Event[]) => void
  fetchOlder?: OlderFetch | undefined
  eventSchema?: z.ZodType<V2Event> | undefined
}

export const createOlderLoader = (args: OlderLoaderArgs): (() => Promise<number>) => {
  let inFlight: Promise<number> | undefined
  const load = (): Promise<number> => {
    if (inFlight !== undefined) return inFlight
    const run = olderWindowOf({
      log: args.log,
      sessionId: args.sessionId,
      window: args.windowOf(),
      count: OLDER_PAGE,
      fetchOlder: args.fetchOlder,
      eventSchema: args.eventSchema,
    })
      .then((visible) => {
        if (visible.length === 0) return 0
        args.extend(visible)
        return visible.length
      })
      .catch(() => 0)
    inFlight = run
    void run.finally(() => {
      if (inFlight === run) inFlight = undefined
    })
    return run
  }
  return load
}
