import { wireEventSchema, type WireEvent } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { desktopCall } from './desktop-http'

const eventsPageSchema = z.object({
  events: z.array(wireEventSchema),
  head: z.number().int().nonnegative(),
  nextAfter: z.number().int().nonnegative().nullable(),
})

const seeds = new Map<string, Promise<WireEvent[]>>()
const pendingSeeds = new Map<string, Promise<WireEvent[]>>()
const heads = new Map<string, number>()

export function invalidateLocalThreadHistory(threadId?: string): void {
  if (threadId === undefined) {
    seeds.clear()
    pendingSeeds.clear()
    heads.clear()
    return
  }
  seeds.delete(threadId)
  pendingSeeds.delete(threadId)
  heads.delete(threadId)
}

export function observeLocalThreadHead(args: { threadId: string; head: number }): void {
  const previous = heads.get(args.threadId)
  if (previous !== undefined && args.head < previous) invalidateLocalThreadHistory(args.threadId)
  heads.set(args.threadId, args.head)
}

async function fetchPages(args: {
  threadId: string
  fromSeq?: number | undefined
}): Promise<WireEvent[]> {
  let after = Math.max(0, (args.fromSeq ?? 1) - 1)
  const events: WireEvent[] = []
  let previousHead: number | undefined
  let restarts = 0
  while (true) {
    const page = await desktopCall({
      path: `/desktop/threads/${encodeURIComponent(args.threadId)}/events?after=${after}&limit=500`,
      schema: eventsPageSchema,
    })
    observeLocalThreadHead({ threadId: args.threadId, head: page.head })
    if (previousHead !== undefined && page.head < previousHead) {
      restarts += 1
      if (restarts > 2) throw new Error('Local history kept changing while paging')
      after = 0
      events.length = 0
      previousHead = page.head
      continue
    }
    previousHead = page.head
    events.push(...page.events)
    if (page.nextAfter === null) return events
    if (page.nextAfter <= after) throw new Error('Local history cursor did not advance')
    after = page.nextAfter
  }
}

export function readLocalEvents(args: {
  threadId: string
  fromSeq?: number | undefined
}): Promise<WireEvent[]> {
  if (args.fromSeq !== undefined) return fetchPages(args)
  const pending = pendingSeeds.get(args.threadId)
  if (pending !== undefined) return pending
  invalidateLocalThreadHistory(args.threadId)
  return readLocalSeed(args.threadId)
}

export function readLocalSeed(threadId: string): Promise<WireEvent[]> {
  const held = seeds.get(threadId)
  if (held !== undefined) return held
  const pending = fetchPages({ threadId })
    .catch((failure: unknown) => {
      if (seeds.get(threadId) === pending) seeds.delete(threadId)
      throw failure
    })
    .finally(() => {
      if (pendingSeeds.get(threadId) === pending) pendingSeeds.delete(threadId)
    })
  pendingSeeds.set(threadId, pending)
  seeds.set(threadId, pending)
  return pending
}
