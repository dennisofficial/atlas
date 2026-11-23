import type {
  SessionBucketPageInput,
  SessionBucketPageOutput,
  SessionSummary,
} from '@dltech/atlas-protocol'
import { ESessionPageBucket } from '@dltech/atlas-protocol'
import {
  ESessionBucket,
  type LiveThreadRow,
  type SessionPageInput,
  type SessionPageOutput,
} from '@dltech/atlas-wire/web'

import { v2SessionHref } from './v2-rows'

export const SESSION_PAGE_LIMIT = 20

export type PageBucket = ESessionBucket.Inactive | ESessionBucket.Archived

export interface SheetRow {
  id: string
  title: string | null
  updatedAt: string
  href: string
}

export interface SessionPageSnapshot {
  rows: readonly SheetRow[]
  total: number | null
  next: boolean
  search: string
  loading: boolean
  error: string | null
}

export const EMPTY_SESSION_PAGE: SessionPageSnapshot = {
  rows: [],
  total: null,
  next: false,
  search: '',
  loading: false,
  error: null,
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'Could not load sessions'

const stampOf = (iso: string): number => {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

const newestFirst = (left: SheetRow, right: SheetRow): number =>
  stampOf(right.updatedAt) - stampOf(left.updatedAt)

const sheetRowOfV1 = (row: LiveThreadRow): SheetRow => ({
  id: row.thread.id,
  title: row.thread.title ?? null,
  updatedAt: row.thread.updatedAt,
  href: `/threads/${encodeURIComponent(row.thread.id)}`,
})

const sheetRowOfV2 = (session: SessionSummary): SheetRow => ({
  id: session.sessionId,
  title: session.title,
  updatedAt: session.updatedAt,
  href: v2SessionHref(session.sessionId),
})

const v2BucketOf = (bucket: PageBucket): ESessionPageBucket =>
  bucket === ESessionBucket.Archived ? ESessionPageBucket.Archived : ESessionPageBucket.Inactive

interface Source {
  rows: readonly SheetRow[]
  cursor: string | null
  count: number | null
  error: string | null
}

const EMPTY_SOURCE: Source = { rows: [], cursor: null, count: null, error: null }

export interface SessionPager {
  snapshot: () => SessionPageSnapshot
  start: () => void
  more: () => void
  search: (term: string) => void
}

export function createSessionPager(args: {
  bucket: PageBucket
  loadV1: (input: SessionPageInput) => Promise<SessionPageOutput>
  loadV2: (input: SessionBucketPageInput) => Promise<SessionBucketPageOutput>
  emit: (snapshot: SessionPageSnapshot) => void
  limit?: number | undefined
}): SessionPager {
  const limit = args.limit ?? SESSION_PAGE_LIMIT
  let snapshot = EMPTY_SESSION_PAGE
  let generation = 0
  let inflight = 0
  let v1 = EMPTY_SOURCE
  let v2 = EMPTY_SOURCE

  const publish = (): void => {
    snapshot = {
      ...snapshot,
      rows: [...v1.rows, ...v2.rows].sort(newestFirst),
      total: v1.count === null || v2.count === null ? null : v1.count + v2.count,
      next: v1.cursor !== null || v2.cursor !== null,
      loading: inflight > 0,
      error: v1.error ?? v2.error,
    }
    args.emit(snapshot)
  }

  const loadV1Page = async ({
    mine,
    term,
    cursor,
  }: {
    mine: number
    term: string
    cursor: string | undefined
  }): Promise<void> => {
    try {
      const result = await args.loadV1({
        bucket: args.bucket,
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(term.length === 0 ? {} : { search: term }),
      })
      if (mine !== generation) return
      const rows = result.rows.map(sheetRowOfV1)
      v1 = {
        rows: cursor === undefined ? rows : [...v1.rows, ...rows],
        cursor: result.next ?? null,
        count: result.counts[args.bucket],
        error: null,
      }
    } catch (failure) {
      if (mine !== generation) return
      v1 = { ...v1, error: messageOf(failure) }
    }
  }

  const loadV2Page = async ({
    mine,
    term,
    cursor,
  }: {
    mine: number
    term: string
    cursor: string | undefined
  }): Promise<void> => {
    try {
      const result = await args.loadV2({
        bucket: v2BucketOf(args.bucket),
        limit,
        ...(cursor === undefined ? {} : { cursor }),
        ...(term.length === 0 ? {} : { search: term }),
      })
      if (mine !== generation) return
      const rows = result.sessions.map(sheetRowOfV2)
      v2 = {
        rows: cursor === undefined ? rows : [...v2.rows, ...rows],
        cursor: result.next ?? null,
        count: result.counts[args.bucket],
        error: null,
      }
    } catch (failure) {
      if (mine !== generation) return
      v2 = { ...v2, error: messageOf(failure) }
    }
  }

  const loadFirst = async (term: string): Promise<void> => {
    generation += 1
    const mine = generation
    v1 = EMPTY_SOURCE
    v2 = EMPTY_SOURCE
    inflight = 2
    publish()
    await Promise.all([
      loadV1Page({ mine, term, cursor: undefined }),
      loadV2Page({ mine, term, cursor: undefined }),
    ])
    if (mine !== generation) return
    inflight = 0
    publish()
  }

  const loadMore = async (term: string): Promise<void> => {
    const mine = generation
    const v1Cursor = v1.cursor
    const v2Cursor = v2.cursor
    if (v1Cursor === null && v2Cursor === null) return
    inflight += (v1Cursor === null ? 0 : 1) + (v2Cursor === null ? 0 : 1)
    publish()
    await Promise.all([
      v1Cursor === null ? Promise.resolve() : loadV1Page({ mine, term, cursor: v1Cursor }),
      v2Cursor === null ? Promise.resolve() : loadV2Page({ mine, term, cursor: v2Cursor }),
    ])
    if (mine !== generation) return
    inflight = 0
    publish()
  }

  return {
    snapshot: () => snapshot,
    start: () => void loadFirst(snapshot.search),
    more: () => {
      if (snapshot.loading || !snapshot.next) return
      void loadMore(snapshot.search)
    },
    search: (term: string) => {
      const trimmed = term.trim()
      if (trimmed === snapshot.search) return
      snapshot = { ...snapshot, search: trimmed }
      void loadFirst(trimmed)
    },
  }
}
