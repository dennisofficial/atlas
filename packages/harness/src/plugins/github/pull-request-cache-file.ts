import { readFileSync } from 'node:fs'

import { EPullRequestState } from '@dltech/atlas-core'

import {
  EChecksState,
  EPullRequestLookup,
  type ChecksTally,
  type PullRequest,
  type PullRequestReading,
} from './pure'

export type CacheEntry = {
  reading: PullRequestReading
  fetchedAt: number | null
  failedAt: number | null
  revision: number
}

type EntryJson = {
  lookup: 'found' | 'absent'
  fetchedAt: number | null
  failedAt: number | null
  pullRequest?: {
    number: number
    title: string
    url: string
    state: string
    checks: string
    tally: ChecksTally
  }
}

export const entryToJson = (entry: CacheEntry): EntryJson | null => {
  if (entry.reading.lookup === EPullRequestLookup.Absent) {
    return { lookup: 'absent', fetchedAt: entry.fetchedAt, failedAt: entry.failedAt }
  }
  if (entry.reading.lookup !== EPullRequestLookup.Found) return null

  const pullRequest = entry.reading.pullRequest
  return {
    lookup: 'found',
    fetchedAt: entry.fetchedAt,
    failedAt: entry.failedAt,
    pullRequest: {
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.url,
      state: pullRequest.state,
      checks: pullRequest.checks,
      tally: pullRequest.tally,
    },
  }
}

const parseTally = (raw: unknown): ChecksTally | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const tally = raw as Record<string, unknown>
  if (
    typeof tally.running !== 'number' ||
    typeof tally.passed !== 'number' ||
    typeof tally.failed !== 'number'
  ) {
    return null
  }
  return { running: tally.running, passed: tally.passed, failed: tally.failed }
}

const parsePullRequest = (raw: unknown): PullRequest | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const pullRequest = raw as Record<string, unknown>
  const tally = parseTally(pullRequest.tally)
  if (
    typeof pullRequest.number !== 'number' ||
    typeof pullRequest.title !== 'string' ||
    typeof pullRequest.url !== 'string' ||
    typeof pullRequest.state !== 'string' ||
    typeof pullRequest.checks !== 'string' ||
    tally === null
  ) {
    return null
  }
  if (!Object.values(EPullRequestState).includes(pullRequest.state as EPullRequestState)) return null
  if (!Object.values(EChecksState).includes(pullRequest.checks as EChecksState)) return null

  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state as EPullRequestState,
    checks: pullRequest.checks as EChecksState,
    tally,
  }
}

const parseEntry = (raw: unknown): CacheEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  const fetchedAt = typeof entry.fetchedAt === 'number' ? entry.fetchedAt : null
  const failedAt = typeof entry.failedAt === 'number' ? entry.failedAt : null

  if (entry.lookup === 'absent') {
    return { reading: { lookup: EPullRequestLookup.Absent }, fetchedAt, failedAt, revision: 0 }
  }
  if (entry.lookup === 'found') {
    const pullRequest = parsePullRequest(entry.pullRequest)
    if (pullRequest === null) return null

    return {
      reading: { lookup: EPullRequestLookup.Found, pullRequest },
      fetchedAt,
      failedAt,
      revision: 0,
    }
  }
  return null
}

export const loadEntries = (file: string): Map<string, CacheEntry> => {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return new Map()
  }

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return new Map()
  }
  if (typeof json !== 'object' || json === null) return new Map()

  const entries = new Map<string, CacheEntry>()
  for (const [key, raw] of Object.entries(json)) {
    const entry = parseEntry(raw)
    if (entry !== null) entries.set(key, entry)
  }
  return entries
}
