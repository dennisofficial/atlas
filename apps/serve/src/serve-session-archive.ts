import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'
import { MEMORY_DIRECTORY_NAME } from '@dltech/atlas-core'

import { buildContextArchive, type ArchiveFileSource } from '@dltech/atlas-harness'
import { buildSessionArchive } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'
import { memoryDirectoriesFor } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'
import { statMemoryDirectory } from '@dltech/atlas-harness'

/**
 * The descend's transcript transfer: the session directory the sandbox served from, tarred the way
 * the lift shipped it up. Only the descend reads it, and a move cannot carry a live shell, so the
 * whole family's shells end before the tar is built; the build itself refuses a shell with no
 * terminal status. An empty directory answers null — the descend reads that as the cloud holding
 * nothing and refuses rather than wiping the local copy.
 */
export async function serveSessionArchive(args: {
  threadId: ThreadId
  endFamilyShells?: (() => Promise<void>) | undefined
}): Promise<Uint8Array | null> {
  await args.endFamilyShells?.()
  const archive = await buildSessionArchive({
    sessionDir: sessionDirectory({ home: atlasDirectory(), sessionId: args.threadId }),
  })
  return archive === undefined ? null : archive
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
