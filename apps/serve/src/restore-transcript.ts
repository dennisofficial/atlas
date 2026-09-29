import { existsSync } from 'node:fs'

import type { EventLogPort, ThreadId } from '@dltech/atlas-core'

import { extractSessionArchive } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptRestore = {
  restored: boolean
  failed: string | null
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The lift ships the transcript after serve is already healthy, so the boot-time materialize in
 * index.ts has already run and found nothing. This is the lift's late-restore half: re-read the
 * archive off the drive, extract it onto the session directory, and refresh the store so the read
 * ops serve the restored events without a process restart. A serve whose session already holds the
 * transcript (a snapshot resume) reads as already-restored and is left untouched.
 */
export async function restoreTranscript(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
  log: Pick<EventLogPort, 'refresh'>
  /** Whether the session directory already serves the transcript; boot computed it. */
  hasTranscript: () => boolean
}): Promise<TranscriptRestore> {
  if (args.hasTranscript()) return { restored: true, failed: null }

  let archive: Uint8Array | null
  try {
    archive = await args.fetchArchive()
  } catch (error) {
    return { restored: false, failed: `the transcript archive did not answer: ${messageOf(error)}` }
  }
  if (archive === null) return { restored: false, failed: 'the drive holds no transcript archive' }

  const sessionDir = sessionDirectory({ home: args.atlasHome, sessionId: args.threadId })
  try {
    await extractSessionArchive({ archive, sessionDir })
  } catch (error) {
    return { restored: false, failed: `the transcript archive did not extract: ${messageOf(error)}` }
  }

  await args.log.refresh({ threadId: args.threadId })
  return {
    restored: existsSync(eventLogFile({ sessionDir, threadId: args.threadId })),
    failed: null,
  }
}
