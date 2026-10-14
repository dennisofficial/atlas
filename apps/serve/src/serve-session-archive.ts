import { randomBytes } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'
import { SESSION_EXPORT_DIRECTORY_NAME, type SessionArchiveDescriptor } from '@dltech/atlas-wire'

import type { ArchiveBuildReporter } from '@dltech/atlas-harness'
import { buildSessionArchive } from '@dltech/atlas-harness'
import { atlasDirectory } from '@dltech/atlas-harness'
import { sessionDirectory } from '@dltech/atlas-harness'

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
