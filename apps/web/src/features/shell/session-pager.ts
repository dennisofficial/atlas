import {
  ESessionBucket,
  type LiveThreadRow,
  type SessionBucketCounts,
  type SessionPageInput,
  type SessionPageOutput,
} from '@dltech/atlas-wire/web'

export const SESSION_PAGE_LIMIT = 20

export type PageBucket = ESessionBucket.Inactive | ESessionBucket.Archived

export interface SessionPageSnapshot {
  rows: readonly LiveThreadRow[]
  counts: SessionBucketCounts | null
  next: string | null
  search: string
  loading: boolean
  error: string | null
}

export const EMPTY_SESSION_PAGE: SessionPageSnapshot = {
  rows: [],
  counts: null,
  next: null,
  search: '',
  loading: false,
  error: null,
}

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : 'Could not load sessions'

export interface SessionPager {
  snapshot: () => SessionPageSnapshot
  start: () => void
  more: () => void
  search: (term: string) => void
}

export function createSessionPager(args: {
  bucket: PageBucket
  load: (input: SessionPageInput) => Promise<SessionPageOutput>
  emit: (snapshot: SessionPageSnapshot) => void
  limit?: number | undefined
}): SessionPager {
  const limit = args.limit ?? SESSION_PAGE_LIMIT
  let snapshot = EMPTY_SESSION_PAGE
  let generation = 0

  const set = (patch: Partial<SessionPageSnapshot>) => {
    snapshot = { ...snapshot, ...patch }
    args.emit(snapshot)
  }

  const fetchPage = async (page: { search: string; cursor: string | undefined }) => {
    generation += 1
    const mine = generation
    set({ loading: true, error: null })
    try {
      const result = await args.load({
        bucket: args.bucket,
        limit,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
        ...(page.search.length === 0 ? {} : { search: page.search }),
      })
      if (mine !== generation) return
      set({
        rows: page.cursor === undefined ? result.rows : [...snapshot.rows, ...result.rows],
        counts: result.counts,
        next: result.next ?? null,
        loading: false,
      })
    } catch (failure) {
      if (mine !== generation) return
      set({ loading: false, error: messageOf(failure) })
    }
  }

  return {
    snapshot: () => snapshot,
    start: () => void fetchPage({ search: snapshot.search, cursor: undefined }),
    more: () => {
      if (snapshot.loading || snapshot.next === null) return
      void fetchPage({ search: snapshot.search, cursor: snapshot.next })
    },
    search: (term: string) => {
      const trimmed = term.trim()
      if (trimmed === snapshot.search) return
      set({ search: trimmed, rows: [], counts: null, next: null })
      void fetchPage({ search: trimmed, cursor: undefined })
    },
  }
}
