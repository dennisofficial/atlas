import { isTurnTakingType, type Event, type ThreadId } from '@dltech/atlas-core'
import {
  readableEventFromWire,
  mirrorWriter,
  newThreadMeta,
  readMetaSync,
  registryFor,
  SessionsClient,
  threadMetaFile,
  threadMetaSchema,
  writeMeta,
  type MirrorWriter,
  type WireEvent,
} from '@dltech/atlas-harness'
import { BOOT_STEP_EVENT_TYPE, isApiProvisioned, mirrorsThreadState } from '@dltech/atlas-wire'

import { EServeEvent, type ServeLog } from './serve-log'

export type HydrateResult = { imported: number; skipped: number; head: number; remoteHead: number }

export class HydrationRejected extends Error {
  constructor(
    readonly wire: WireEvent,
    detail: string,
  ) {
    super(`unreadable turn-taking event seq ${wire.seq} of type ${wire.type}: ${detail}`)
    this.name = 'HydrationRejected'
  }
}

const coreEventOf = (wire: WireEvent): Event | null => {
  if (wire.type === BOOT_STEP_EVENT_TYPE) return null
  return readableEventFromWire(wire)
}

export async function hydrateServeHistory(args: {
  atlasHome: string
  threadId: ThreadId
  sessions: Pick<SessionsClient, 'readEvents'>
  log: ServeLog
  writer?: MirrorWriter | undefined
}): Promise<HydrateResult> {
  const { atlasHome, threadId, log } = args
  const registry = registryFor({ home: atlasHome })
  const sessionDir = await registry.sessionDirFor({ threadId })
  const localHead = (await registry.readThreadLog({ sessionDir, threadId })).head

  const wire = await args.sessions.readEvents({ threadId, own: true })
  const past = wire.filter((row) => row.seq > localHead).sort((a, b) => a.seq - b.seq)
  const remoteHead = wire.reduce((highest, row) => Math.max(highest, row.seq), 0)

  const events: Event[] = []
  let skipped = 0
  let head = localHead
  for (const row of past) {
    const event = coreEventOf(row)
    if (event === null && isTurnTakingType(row.type)) {
      log({
        event: EServeEvent.HydrateRejected,
        threadId,
        seq: row.seq,
        type: row.type,
      })
      throw new HydrationRejected(row, 'the body failed the local schema')
    }
    if (event === null) skipped += 1
    else events.push(event)
    head = row.seq
  }

  if (events.length > 0) {
    const writer = args.writer ?? mirrorWriter({ home: () => atlasHome })
    await writer.appendDelta({ threadId, events })
  }
  if (head > localHead) {
    const file = threadMetaFile({ sessionDir, threadId })
    const meta =
      readMetaSync({ file, schema: threadMetaSchema }) ??
      newThreadMeta({ id: threadId, at: new Date().toISOString() })
    await writeMeta({ file, meta: { ...meta, head, updatedAt: new Date().toISOString() } })
    registry.invalidateSession({ sessionDir })
  }

  log({ event: EServeEvent.Hydrated, localHead, imported: events.length, skipped, head })
  return { imported: events.length, skipped, head, remoteHead }
}

export async function hydrateWhenRegistered(args: {
  env: Record<string, string | undefined>
  atlasHome: string
  threadId: ThreadId
  controlPlaneUrl: string
  token: string
  clientVersion: string
  fetchFn: typeof fetch
  log: ServeLog
}): Promise<HydrateResult | undefined> {
  if (!mirrorsThreadState(args.env)) return undefined
  try {
    return await hydrateServeHistory({
      atlasHome: args.atlasHome,
      threadId: args.threadId,
      log: args.log,
      sessions: new SessionsClient({
        url: args.controlPlaneUrl,
        token: args.token,
        clientVersion: args.clientVersion,
        fetchFn: args.fetchFn,
      }),
    })
  } catch (failure) {
    args.log({
      event: EServeEvent.HydrateFailed,
      reason: failure instanceof Error ? failure.message : String(failure),
    })
    if (isApiProvisioned(args.env)) throw failure
    return undefined
  }
}
