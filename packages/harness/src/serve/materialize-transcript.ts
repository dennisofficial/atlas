import { existsSync } from 'node:fs'

import { type ThreadId } from '@dltech/atlas-core'

import { extractSessionArchive } from '../cloud/session-archive'
import { sessionDirectory } from '../store/sessions/paths'

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
  if (existsSync(sessionDir)) return { restored: false, failed: null }

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
