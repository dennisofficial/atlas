import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ThreadId } from '@dltech/atlas-core'

import { extractSessionArchive } from '@dltech/atlas-harness'
import { eventLogFile, sessionDirectory } from '@dltech/atlas-harness'

import type { FetchTranscriptArchive } from './workspace-spec'

export type TranscriptBootstrap = {
  applied: boolean
  digestMatched: boolean
  fresh: boolean
  failed: string | null
}

export type TranscriptOrigin = {
  threadId: ThreadId
  archiveDigest: string | null
  initialized: true
}

export const TRANSCRIPT_ORIGIN_FILE_NAME = 'transcript-origin.json'

const BOOTSTRAP_DIRECTORY_NAME = 'bootstrap'
const APPLIED_RECEIPT_NAME = 'transcript-applied.sha256'

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const receiptFile = ({ atlasHome }: { atlasHome: string }): string =>
  join(atlasHome, BOOTSTRAP_DIRECTORY_NAME, APPLIED_RECEIPT_NAME)

const digestOf = (archive: Uint8Array): string =>
  createHash('sha256').update(archive).digest('hex')

const appliedReceipt = async (args: { atlasHome: string }): Promise<string | null> => {
  try {
    return (await readFile(receiptFile(args), 'utf8')).trim()
  } catch {
    return null
  }
}

export const transcriptBootstrapReceipt = (args: { atlasHome: string }): Promise<string | null> =>
  appliedReceipt(args)

const writeReceipt = async (args: { atlasHome: string; digest: string }): Promise<void> => {
  const file = receiptFile(args)
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, `${args.digest}\n`)
}

const stampTranscriptOrigin = async (args: {
  sessionDir: string
  threadId: ThreadId
  archiveDigest: string | null
}): Promise<void> => {
  const origin: TranscriptOrigin = {
    threadId: args.threadId,
    archiveDigest: args.archiveDigest,
    initialized: true,
  }
  await mkdir(args.sessionDir, { recursive: true })
  await writeFile(join(args.sessionDir, TRANSCRIPT_ORIGIN_FILE_NAME), `${JSON.stringify(origin)}\n`)
}

export async function readTranscriptOrigin(args: {
  sessionDir: string
}): Promise<TranscriptOrigin | null> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(args.sessionDir, TRANSCRIPT_ORIGIN_FILE_NAME), 'utf8'),
    )
    if (typeof parsed !== 'object' || parsed === null) return null
    const origin = parsed as Partial<TranscriptOrigin>
    if (origin.initialized !== true || typeof origin.threadId !== 'string') return null
    if (origin.archiveDigest !== null && typeof origin.archiveDigest !== 'string') return null
    return {
      threadId: origin.threadId as ThreadId,
      archiveDigest: origin.archiveDigest ?? null,
      initialized: true,
    }
  } catch {
    return null
  }
}

const replaceWithVerifiedArchive = async (args: {
  archive: Uint8Array
  sessionDir: string
  threadId: ThreadId
}): Promise<string | null> => {
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-transcript-verify-'))
  try {
    await extractSessionArchive({ archive: args.archive, sessionDir: scratch })
    if (!existsSync(eventLogFile({ sessionDir: scratch, threadId: args.threadId }))) {
      return 'the transcript archive holds no events for this thread'
    }
    await extractSessionArchive({ archive: args.archive, sessionDir: args.sessionDir })
    return null
  } catch (error) {
    return `the transcript archive did not extract: ${messageOf(error)}`
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }
}

const idle: TranscriptBootstrap = { applied: false, digestMatched: false, fresh: false, failed: null }

export async function applyTranscriptArchive(args: {
  fetchArchive: FetchTranscriptArchive
  atlasHome: string
  threadId: ThreadId
  explicit: boolean
  refuseIfBusy?: (() => string | null) | undefined
}): Promise<TranscriptBootstrap> {
  const sessionDir = sessionDirectory({ home: args.atlasHome, sessionId: args.threadId })
  const logPresent = existsSync(eventLogFile({ sessionDir, threadId: args.threadId }))

  let archive: Uint8Array | null
  try {
    archive = await args.fetchArchive()
  } catch (error) {
    if (!args.explicit && logPresent) return idle
    return { ...idle, failed: `the transcript archive did not answer: ${messageOf(error)}` }
  }
  if (archive === null) {
    if (!args.explicit && !logPresent) {
      await stampTranscriptOrigin({ sessionDir, threadId: args.threadId, archiveDigest: null })
      return { ...idle, fresh: true }
    }
    if (!args.explicit) return idle
    return { ...idle, failed: 'the drive holds no transcript archive' }
  }

  const digest = digestOf(archive)
  const receipt = await appliedReceipt({ atlasHome: args.atlasHome })
  const digestMatched = receipt === digest
  if (digestMatched && logPresent) return { ...idle, digestMatched }

  const bootPreservesLegacyLog = !args.explicit && logPresent && receipt === null
  if (bootPreservesLegacyLog) return { ...idle, digestMatched }

  const busy = args.refuseIfBusy?.() ?? null
  if (busy !== null) return { ...idle, digestMatched, failed: busy }

  const failure = await replaceWithVerifiedArchive({
    archive,
    sessionDir,
    threadId: args.threadId,
  })
  if (failure !== null) return { ...idle, failed: failure }

  await writeReceipt({ atlasHome: args.atlasHome, digest })
  await stampTranscriptOrigin({ sessionDir, threadId: args.threadId, archiveDigest: digest })
  return { applied: true, digestMatched, fresh: false, failed: null }
}
