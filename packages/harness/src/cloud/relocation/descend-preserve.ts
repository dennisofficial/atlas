import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlacementRecord, ThreadId, WorkspaceIdentity } from '@dltech/atlas-core'

import { extractSessionArchive } from '../session-archive'
import { requireReadableIncomingFamily } from './descend-family'
import { requireValidatedIncomingRoot } from './descend-validate'

const sessionDirectoryNameOf = ({ threadId }: { threadId: string }): string => {
  const segments = threadId.split('/')
  const name = segments[segments.length - 1] ?? ''
  if (name === '' || name === '.' || name === '..') {
    throw new Error(`the thread id ${threadId} names no session directory`)
  }
  return name
}

export async function replaceSessionDirectoryGuarded(args: {
  archive: Uint8Array
  sessionDir: string
  threadId: ThreadId
  tarCommand?: string | undefined
  preserveOwnership?: { record: PlacementRecord; workspace: WorkspaceIdentity } | undefined
}): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'atlas-descend-check-'))
  const stagedDir = join(scratch, sessionDirectoryNameOf({ threadId: args.threadId }))
  try {
    await extractSessionArchive({
      archive: args.archive,
      sessionDir: stagedDir,
      ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    })
    const root = await requireValidatedIncomingRoot({
      sessionDir: stagedDir,
      threadId: args.threadId,
      localDir: args.sessionDir,
    })
    await requireReadableIncomingFamily({
      sessionDir: stagedDir,
      root,
      threadId: args.threadId,
    })
  } finally {
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined)
  }

  await extractSessionArchive({
    archive: args.archive,
    sessionDir: args.sessionDir,
    ...(args.tarCommand === undefined ? {} : { tarCommand: args.tarCommand }),
    ...(args.preserveOwnership === undefined ? {} : { preserveOwnership: { threadId: args.threadId, ...args.preserveOwnership } }),
  })
}
