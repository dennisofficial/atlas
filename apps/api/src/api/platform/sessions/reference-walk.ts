import { REFERENCE_CHAIN_LIMIT, type SessionReader } from './fork-chain'

export type WalkedEvent = { seq: number; type: string; body: string }

type Cursor = { threadId: string; upTo: number | undefined }

export async function walkReferences<T>(args: {
  reader: SessionReader
  threadIds: readonly string[]
  eventTypes: string[]
  pick: (events: WalkedEvent[]) => { value: T } | null
  fallback: () => T
}): Promise<Map<string, T>> {
  const resolved = new Map<string, T>()
  let cursors = new Map<string, Cursor>(
    [...new Set(args.threadIds)].map((id) => [id, { threadId: id, upTo: undefined }]),
  )

  for (let hop = 0; hop <= REFERENCE_CHAIN_LIMIT && cursors.size > 0; hop += 1) {
    const threadIds = [...new Set([...cursors.values()].map((cursor) => cursor.threadId))]
    const rows = await args.reader.orm.public.Event.where((event) => event.type.in(args.eventTypes))
      .where((event) => event.threadId.in(threadIds))
      .select('threadId', 'seq', 'type', 'body')
      .orderBy((event) => event.seq.asc())
      .all()
    const byThread = new Map<string, WalkedEvent[]>()
    for (const row of rows) {
      const events = byThread.get(row.threadId)
      if (events === undefined) byThread.set(row.threadId, [row])
      else events.push(row)
    }

    const misses: [string, Cursor][] = []
    for (const [origin, cursor] of cursors) {
      const bounded = (byThread.get(cursor.threadId) ?? []).filter(
        (event) => cursor.upTo === undefined || event.seq <= cursor.upTo,
      )
      const picked = args.pick(bounded)
      if (picked === null) misses.push([origin, cursor])
      else resolved.set(origin, picked.value)
    }
    if (hop === REFERENCE_CHAIN_LIMIT || misses.length === 0) break

    const links = await referenceLinks({
      reader: args.reader,
      threadIds: [...new Set(misses.map(([, cursor]) => cursor.threadId))],
    })
    cursors = new Map()
    for (const [origin, cursor] of misses) {
      const link = links.get(cursor.threadId)
      if (link === undefined) continue
      cursors.set(origin, {
        threadId: link.parentThreadId,
        upTo: cursor.upTo === undefined ? link.forkSeq : Math.min(cursor.upTo, link.forkSeq),
      })
    }
  }

  for (const origin of args.threadIds) {
    if (!resolved.has(origin)) resolved.set(origin, args.fallback())
  }
  return resolved
}

async function referenceLinks(args: {
  reader: SessionReader
  threadIds: string[]
}): Promise<Map<string, { parentThreadId: string; forkSeq: number }>> {
  const rows = await args.reader.orm.public.Thread.where((thread) => thread.id.in(args.threadIds))
    .select('id', 'parentThreadId', 'forkSeq', 'forkMode')
    .all()
  const links = new Map<string, { parentThreadId: string; forkSeq: number }>()
  for (const row of rows) {
    if (row.forkMode !== 'reference') continue
    if (row.parentThreadId === null || row.forkSeq === null) continue
    links.set(row.id, {
      parentThreadId: row.parentThreadId,
      forkSeq: row.forkSeq,
    })
  }
  return links
}
