import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { EPullRequestState } from '@dltech/atlas-core'

import {
  checkoutKey,
  EPullRequestLookup,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'
import { entryToJson, loadEntries, type CacheEntry } from './pull-request-cache-file'

export const PULL_REQUEST_CACHE_FILE_NAME = 'pull-request-badges.json'

export const PULL_REQUEST_CACHE_LIMIT = 256

export const PULL_REQUEST_CACHE_ACTIVE_TTL_MS = 60_000

export const PULL_REQUEST_CACHE_ABSENT_TTL_MS = 15_000

export const PULL_REQUEST_CACHE_FAILURE_TTL_MS = 15_000

export const PULL_REQUEST_CACHE_SETTLED_TTL_MS = 24 * 60 * 60_000

export type PullRequestCache = {
  peek: (args: { key: string }) => PullRequestReading | null
  freshen: (args: { key: string; ask: () => Promise<PullRequestReading> }) => void
  ingest: (args: { key: string; reading: PullRequestReading }) => void
  subscribe: (listener: () => void) => () => void
  dispose: () => void
}

export type CacheKeyArgs =
  | { kind: 'checkout'; checkout: RepositoryCheckout }
  | { kind: 'linked'; repo: string; number: number }

export const pullRequestCacheKey = (args: CacheKeyArgs): string =>
  args.kind === 'checkout' ? checkoutKey(args.checkout) : `${args.repo}#${args.number}`

export const pullRequestLinkedKeyOf = (args: { repo: string; number: number }): string =>
  `${args.repo}#${args.number}`

const SETTLED = new Set<string>([EPullRequestState.Merged, EPullRequestState.Closed])

const ttlOf = (reading: PullRequestReading): number => {
  if (reading.lookup === EPullRequestLookup.Absent) return PULL_REQUEST_CACHE_ABSENT_TTL_MS
  if (reading.lookup !== EPullRequestLookup.Found) return PULL_REQUEST_CACHE_ABSENT_TTL_MS
  return SETTLED.has(reading.pullRequest.state)
    ? PULL_REQUEST_CACHE_SETTLED_TTL_MS
    : PULL_REQUEST_CACHE_ACTIVE_TTL_MS
}

const sameFound = (left: PullRequestReading, right: PullRequestReading): boolean => {
  if (left.lookup !== EPullRequestLookup.Found || right.lookup !== EPullRequestLookup.Found) {
    return left.lookup === right.lookup
  }
  return (
    left.pullRequest.number === right.pullRequest.number &&
    left.pullRequest.state === right.pullRequest.state &&
    left.pullRequest.checks === right.pullRequest.checks &&
    left.pullRequest.tally.running === right.pullRequest.tally.running &&
    left.pullRequest.tally.passed === right.pullRequest.tally.passed &&
    left.pullRequest.tally.failed === right.pullRequest.tally.failed
  )
}

export function createPullRequestCache(args: {
  file: string
  now?: () => number
}): PullRequestCache {
  const now = args.now ?? Date.now
  const entries = loadEntries(args.file)
  const listeners = new Set<() => void>()
  const inFlight = new Map<string, number>()
  const sealed = new Map<string, number>()
  let revisions = 0
  let dirty = false
  let saving = false
  let saveFailed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const record = (key: string, entry: CacheEntry): void => {
    const held = entries.get(key)
    if (
      held !== undefined &&
      sameFound(held.reading, entry.reading) &&
      held.fetchedAt === entry.fetchedAt &&
      held.failedAt === entry.failedAt &&
      held.revision === entry.revision
    ) {
      return
    }
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > PULL_REQUEST_CACHE_LIMIT) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
    notify()
    scheduleSave()
  }

  const save = (): void => {
    if (saving) return
    if (!dirty) return

    saving = true
    dirty = false
    saveFailed = false

    try {
      const onDisk = loadEntries(args.file)
      const held = new Map(onDisk)
      for (const [key, entry] of entries) {
        const existing = held.get(key)
        if (existing !== undefined) {
          const existingAt = existing.fetchedAt ?? 0
          const entryAt = entry.fetchedAt ?? 0
          if (existingAt > entryAt) continue
        }
        held.set(key, entry)
      }
      const serialised: Record<string, unknown> = {}
      for (const [key, entry] of held) {
        const json = entryToJson(entry)
        if (json !== null) serialised[key] = json
      }

      mkdirSync(dirname(args.file), { recursive: true })
      const staging = join(
        dirname(args.file),
        `.pull-request-badges.${process.pid}.${randomUUID()}.tmp`,
      )
      writeFileSync(staging, `${JSON.stringify(serialised)}\n`)
      renameSync(staging, args.file)
    } catch {
      saveFailed = true
      dirty = true
      if (retryTimer === null) {
        retryTimer = setTimeout(() => {
          retryTimer = null
          saveFailed = false
          save()
        }, PULL_REQUEST_CACHE_FAILURE_TTL_MS)
        retryTimer.unref?.()
      }
    } finally {
      saving = false
    }
  }

  const scheduleSave = (): void => {
    dirty = true
    if (timer !== null || saveFailed) return

    timer = setTimeout(() => {
      timer = null
      save()
    }, 0)
    timer.unref?.()
  }

  return {
    peek: ({ key }) => entries.get(key)?.reading ?? null,
    freshen: ({ key, ask }) => {
      if (inFlight.has(key)) return

      const held = entries.get(key)
      const at = now()
      if (held !== undefined) {
        if (held.fetchedAt !== null && at - held.fetchedAt < ttlOf(held.reading)) return
        if (held.failedAt !== null && at - held.failedAt < PULL_REQUEST_CACHE_FAILURE_TTL_MS) return
      }

      revisions += 1
      const revision = revisions
      inFlight.set(key, revision)

      void ask()
        .then((reading) => {
          if ((sealed.get(key) ?? 0) > revision) return
          if (reading.lookup === EPullRequestLookup.Unavailable) {
            const current = entries.get(key)
            if (current !== undefined) {
              entries.set(key, { ...current, failedAt: now() })
            } else {
              entries.set(key, { reading, fetchedAt: null, failedAt: now(), revision })
            }
            return
          }

          record(key, { reading, fetchedAt: now(), failedAt: null, revision })
        })
        .catch(() => {
          if ((sealed.get(key) ?? 0) > revision) return
          const current = entries.get(key)
          if (current !== undefined) entries.set(key, { ...current, failedAt: now() })
        })
        .finally(() => {
          if (inFlight.get(key) === revision) inFlight.delete(key)
        })
    },
    ingest: ({ key, reading }) => {
      if (reading.lookup === EPullRequestLookup.Unavailable) return

      revisions += 1
      const revision = revisions
      sealed.set(key, revision)
      if (sealed.size > PULL_REQUEST_CACHE_LIMIT) {
        const oldest = sealed.keys().next().value
        if (oldest !== undefined) sealed.delete(oldest)
      }

      const held = entries.get(key)
      const unchanged = held !== undefined && sameFound(held.reading, reading)
      const fetchedAt = unchanged ? (held?.fetchedAt ?? null) : now()
      record(key, { reading, fetchedAt, failedAt: null, revision })
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
      listeners.clear()
      inFlight.clear()
      saveFailed = false
      save()
    },
  }
}
