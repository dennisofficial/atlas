import { join } from 'node:path'

import { ENoticeTone, NOTICE_WARN_MS, type NoticePort } from '@dltech/atlas-core'

import { atlasDirectory } from '../store/paths'

import { buildContextArchive, type ArchiveFileSource } from './context-archive'
import { MAX_CONTEXT_ARCHIVE_BYTES } from './sandbox-client'

const CONTEXT_OVERFLOW_NOTICE_KEY = 'context-archive-overflow'

export type CaptureContext = () => Promise<Buffer | undefined>

const mebibytes = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)}MiB`

/**
 * The machine-local context a lift still carries as an archive — the local MCP config. The user
 * layer (skills, instructions, memory) no longer rides here: the user-layer sync engine owns it.
 * Returns undefined when there is nothing to carry, and — past the sanity ceiling — warns through
 * the notice port rather than silently dropping the lift's context.
 */
export async function captureContextArchive(args: {
  notice: NoticePort
  cwd?: string | undefined
  home?: string | undefined
  atlasHome?: string | undefined
  maxArchiveBytes?: number | undefined
}): Promise<Buffer | undefined> {
  const atlasHome = args.atlasHome ?? atlasDirectory()
  const maxBytes = args.maxArchiveBytes ?? MAX_CONTEXT_ARCHIVE_BYTES
  const sources: ArchiveFileSource[] = [{ key: '.atlas/mcp.json', path: join(atlasHome, 'mcp.json') }]

  const archive = await buildContextArchive({ files: sources })
  if (archive === undefined) return undefined
  if (archive.byteLength <= maxBytes) return archive

  args.notice.notify({
    key: CONTEXT_OVERFLOW_NOTICE_KEY,
    text: `the cloud context archive is ${mebibytes(archive.byteLength)}, over the ${mebibytes(maxBytes)} limit — the cloud session lifts without the local MCP config this machine holds`,
    tone: ENoticeTone.Warn,
    ttlMs: NOTICE_WARN_MS,
  })
  return undefined
}
