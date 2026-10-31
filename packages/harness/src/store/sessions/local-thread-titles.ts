import { readFile } from 'node:fs/promises'

import type { ThreadId } from '@dltech/atlas-core'

import { withMirrorLock } from '../../cloud/mirror-lock'
import { EThreadTitleSource, localTitleStateOf, type LocalTitleState } from './local-title-state'
import { threadMetaSchema, type ThreadMeta } from './meta'
import { writeMetaFile } from './meta-file'
import { threadMetaFile } from './paths'
import { registryFor } from './registry'

const directoryLookups = new Map<string, Promise<string | undefined>>()

export class FileLocalThreadTitles {
  constructor(private readonly args: { home: string }) {}

  async read({ threadId }: { threadId: ThreadId }): Promise<LocalTitleState> {
    const file = await this.fileOf({ threadId })
    const meta = await this.readThreadMeta({ file })
    return localTitleStateOf(meta)
  }

  async renameUser({
    threadId,
    title,
  }: {
    threadId: ThreadId
    title: string
  }): Promise<LocalTitleState> {
    const file = await this.fileOf({ threadId })
    return withMirrorLock({
      eventsFile: file,
      run: async () => {
        const meta = await this.readThreadMeta({ file })
        const next = {
          ...meta,
          title,
          titleSource: EThreadTitleSource.User,
          titleRevision: (meta.titleRevision ?? 0) + 1,
        }
        await writeMetaFile({ file, meta: next })
        return localTitleStateOf(next)
      },
    })
  }

  async proposeAuto({
    threadId,
    title,
    expectedRevision,
  }: {
    threadId: ThreadId
    title: string
    expectedRevision: number
  }): Promise<LocalTitleState> {
    const file = await this.fileOf({ threadId })
    return withMirrorLock({
      eventsFile: file,
      run: async () => {
        const meta = await this.readThreadMeta({ file })
        const current = localTitleStateOf(meta)
        if (
          current.revision !== expectedRevision ||
          current.title !== null ||
          current.source === EThreadTitleSource.User
        )
          return current
        const next = {
          ...meta,
          title,
          titleSource: EThreadTitleSource.Auto,
          titleRevision: current.revision + 1,
        }
        await writeMetaFile({ file, meta: next })
        return localTitleStateOf(next)
      },
    })
  }

  private async fileOf({ threadId }: { threadId: ThreadId }): Promise<string> {
    const { home } = this.args
    const previous = directoryLookups.get(home) ?? Promise.resolve(undefined)
    const lookup = previous
      .catch(() => undefined)
      .then(() => registryFor({ home }).sessionDirOf({ threadId }))
    directoryLookups.set(home, lookup)
    try {
      const sessionDir = await lookup
      if (sessionDir === undefined) throw new Error(`local thread ${threadId} does not exist`)
      return threadMetaFile({ sessionDir, threadId })
    } finally {
      if (directoryLookups.get(home) === lookup) directoryLookups.delete(home)
    }
  }

  private async readThreadMeta({ file }: { file: string }): Promise<ThreadMeta> {
    return threadMetaSchema.parse(JSON.parse(await readFile(file, 'utf8')))
  }
}
