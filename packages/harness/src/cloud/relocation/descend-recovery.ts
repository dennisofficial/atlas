import { cp, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

import { atlasDirectory } from '../../store/paths'
import { sessionDirectory } from '../../store/sessions/paths'

export type DescendRecovery = {
  directory: string
  restore: () => Promise<void>
  complete: () => Promise<void>
}

export async function preserveDescendSource(args: { threadId: ThreadId }): Promise<DescendRecovery> {
  const home = atlasDirectory()
  const parent = join(home, 'recovery')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(parent, 'descend-'))
  const sessionDir = sessionDirectory({ home, sessionId: args.threadId })
  const previous = join(directory, 'previous')
  const existed = await stat(sessionDir).then(() => true).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return false
    throw error
  })
  if (existed) await cp(sessionDir, previous, { recursive: true, preserveTimestamps: true })

  return {
    directory,
    complete: () => rm(directory, { recursive: true, force: true }),
    restore: async () => {
      await rename(sessionDir, join(directory, 'landed')).catch((error: unknown) => {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return
        throw error
      })
      if (existed) await cp(previous, sessionDir, { recursive: true, preserveTimestamps: true })
    },
  }
}
