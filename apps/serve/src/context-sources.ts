import { extractContextArchive } from '@dltech/atlas-harness'

import { fetchArchiveWithRetry, type ArchiveRetry } from './context-archive-retry'
import { fileEntry, type ContextEntry } from './context-entries'
import { messageOf } from './context-readiness'
import type { FetchContextArchive } from './workspace-spec'

export type ContextSource = { entries: readonly ContextEntry[]; cleanup: () => Promise<void> }

export type SourceOutcome = { source: ContextSource | null } | { failed: string }

const openArchive = async (archive: Uint8Array): Promise<SourceOutcome> => {
  try {
    const extracted = await extractContextArchive({ archive })
    return {
      source: {
        entries: extracted.entries.map((entry) => fileEntry({ key: entry.key, path: entry.path })),
        cleanup: extracted.cleanup,
      },
    }
  } catch (error) {
    return { failed: `the context archive did not extract: ${messageOf(error)}` }
  }
}

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((entry) => typeof entry === 'string')

const openBundle = (bundle: string): SourceOutcome => {
  let parsed: unknown
  try {
    parsed = JSON.parse(bundle)
  } catch {
    return { failed: 'the context bundle did not parse' }
  }
  if (!isStringRecord(parsed)) return { failed: 'the context bundle did not parse' }

  return {
    source: {
      entries: Object.entries(parsed).map(([path, content]) => ({
        path,
        readBytes: () => Promise.resolve(Buffer.from(content, 'base64')),
      })),
      cleanup: async () => undefined,
    },
  }
}

export const resolveContextSource = async (args: {
  fetchArchive: FetchContextArchive | undefined
  archiveRetry: ArchiveRetry | undefined
  legacyBundle: () => Promise<string | null | undefined>
}): Promise<SourceOutcome> => {
  if (args.fetchArchive !== undefined) {
    let archive: Uint8Array | null
    try {
      archive = await fetchArchiveWithRetry({ fetchArchive: args.fetchArchive, retry: args.archiveRetry })
    } catch (error) {
      return { failed: `the context archive did not answer: ${messageOf(error)}` }
    }
    if (archive !== null) return openArchive(archive)
  }

  let bundle: string | null | undefined
  try {
    bundle = await args.legacyBundle()
  } catch (error) {
    return { failed: `the workspace spec did not answer: ${messageOf(error)}` }
  }
  if (bundle === null || bundle === undefined) return { source: null }
  return openBundle(bundle)
}
