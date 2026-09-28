import { existsSync } from 'node:fs'

import { type ThreadId } from '@dltech/atlas-core'

import { extractSessionArchive } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptReadiness = { restored: boolean; failed: string | null }

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * The transcript is the session's spine rather than accessory context, so a failed restore is
 * reported rather than swallowed — a serve that boots without it composes an empty session and
 * would happily start answering turns against a blank log. A sandbox resuming from its snapshot
 * already holds the directory (the control plane answers 404) and is left untouched.
 */
export async function materializeTranscript(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
}): Promise<TranscriptReadiness> {
  const sessionDir = sessionDirectory({ home: args.atlasHome, sessionId: args.threadId })
  /**
   * An existing directory is proof of a resume only when it holds the transcript itself: a snapshot
   * that raced a boot can leave the folder with no events behind it, and treating that husk as
   * restored would boot the session blank while the archive sits unread on the Drive.
   */
  const hasTranscript =
    existsSync(sessionDir) && existsSync(eventLogFile({ sessionDir, threadId: args.threadId }))
  if (hasTranscript) return { restored: false, failed: null }

  let archive: Uint8Array | null
  try {
    archive = await args.fetchArchive()
  } catch (error) {
    return { restored: false, failed: `the transcript archive did not answer: ${messageOf(error)}` }
  }
  if (archive === null) return { restored: false, failed: null }

  try {
    await extractSessionArchive({ archive, sessionDir })
    return { restored: true, failed: null }
  } catch (error) {
    return { restored: false, failed: `the transcript archive did not extract: ${messageOf(error)}` }
  }
}
