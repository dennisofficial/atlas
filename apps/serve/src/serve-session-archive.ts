import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'
import { MEMORY_DIRECTORY_NAME } from '@dltech/atlas-core'
import { SESSION_EXPORT_DIRECTORY_NAME, type SessionArchiveDescriptor } from '@dltech/atlas-wire'

import { buildContextArchive, type ArchiveBuildReporter, type ArchiveFileSource } from '@dltech/atlas-harness'
import { buildSessionArchive } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'
import { memoryDirectoriesFor } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'
import { statMemoryDirectory } from '@dltech/atlas-harness'

const SAFE_THREAD_ID = /^[A-Za-z0-9_-]+$/

export async function serveSessionArchive(args: {
  threadId: ThreadId
  endFamilyShells?: (() => Promise<void>) | undefined
  onBuildProgress?: ArchiveBuildReporter | undefined
}): Promise<SessionArchiveDescriptor | null> {
  if (!SAFE_THREAD_ID.test(args.threadId)) {
    throw new Error(`thread ${args.threadId} cannot name a session export`)
  }
  await args.endFamilyShells?.()
  const directory = join(atlasDirectory(), SESSION_EXPORT_DIRECTORY_NAME)
  const prefix = `session-${args.threadId}-`
  await mkdir(directory, { recursive: true })

  const archive = await buildSessionArchive({
    sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId }),
    archivePath: join(directory, `${prefix}${randomBytes(6).toString('hex')}.tar.gz`),
    onBuildProgress: args.onBuildProgress,
  })
  if (archive === undefined) return null
  return { path: archive.path, size: archive.size, sha256: archive.sha256, threadId: args.threadId }
}

const addFlatMemoryDirectory = async (args: {
  sources: ArchiveFileSource[]
  directory: string
  keyPrefix: string
}): Promise<void> => {
  for (const file of await statMemoryDirectory(args.directory)) {
    args.sources.push({ key: `${args.keyPrefix}/${file.name}`, path: file.path })
  }
}

/**
 * The descend's memory transfer: the sandbox's own user memory and the project memory the
 * materialized context archive landed, keyed exactly the way the lift archive carried them up
 * (`.atlas/memory/…`, `project-memory/…`) so the host's merge mirrors its own layout. A sandbox
 * that never saw memory answers null — the descend reads that as nothing to merge, not an error.
 */
export async function serveMemoryArchive(args: {
  cwd: string
  identity?: string | null | undefined
}): Promise<Uint8Array | null> {
  const atlasHome = atlasDirectory()
  const sources: ArchiveFileSource[] = []

  await addFlatMemoryDirectory({
    sources,
    directory: join(atlasHome, MEMORY_DIRECTORY_NAME),
    keyPrefix: `.atlas/${MEMORY_DIRECTORY_NAME}`,
  })
  await addFlatMemoryDirectory({
    sources,
    directory: memoryDirectoriesFor({
      atlasHome,
      repoRoot: args.cwd,
      identity: args.identity,
    }).project,
    keyPrefix: 'project-memory',
  })

  const archive = await buildContextArchive({ files: sources })
  return archive === undefined ? null : archive
}
