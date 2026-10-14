import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ThreadId } from '@dltech/atlas-core'

import { safeRelativeSegment } from '../files/safe-relative-path'
import { registryFor } from '../store/sessions/registry'
import { SESSION_LOCK_NAME, EVENTS_FILE_SUFFIX, THREADS_DIRECTORY_NAME } from '../store/sessions/paths'
import { isPortableSessionFile } from './portable-session-file'
import { writeMirrorStamp, type MirrorStamp } from './session-mirror-stamp'

export type SessionMirrorFileWrite = { path: string; content: Buffer }

export type SessionMirrorWriter = {
  sessionDirFor(args: { threadId: ThreadId }): Promise<string>
  apply(args: {
    threadId: ThreadId
    writes: readonly SessionMirrorFileWrite[]
    deletions: readonly string[]
    stamp: MirrorStamp
  }): Promise<void>
  /**
   * Files whose local bytes no longer match the stamp — deleted alongside the deletions so the
   * next pull re-fetches them. A mirrored file is never repaired in place: it is discarded and
   * re-pulled whole.
   */
  findStaleDeletions(args: { threadId: ThreadId; stamp: MirrorStamp }): Promise<string[]>
}

const mirrorWriteAllowed = (path: string): boolean => {
  if (safeRelativeSegment(path) === null) return false
  if (path === SESSION_LOCK_NAME) return false
  if (path.startsWith(`${THREADS_DIRECTORY_NAME}/`) && path.endsWith(EVENTS_FILE_SUFFIX)) return false
  return isPortableSessionFile({ key: path })
}

const stage = async (args: { target: string; content: Buffer }): Promise<void> => {
  await mkdir(dirname(args.target), { recursive: true })
  const staged = `${args.target}.${process.pid}.mirror.tmp`
  await writeFile(staged, args.content)
  await rename(staged, args.target)
}

export function sessionMirrorWriter(args: { home: () => string }): SessionMirrorWriter {
  return {
    sessionDirFor: ({ threadId }) => registryFor({ home: args.home() }).sessionDirFor({ threadId }),

    async findStaleDeletions({ threadId, stamp }) {
      const sessionDir = await registryFor({ home: args.home() }).sessionDirFor({ threadId })
      const stale: string[] = []
      for (const [path, expected] of Object.entries(stamp.files)) {
        if (!mirrorWriteAllowed(path)) continue
        const content = await readFile(join(sessionDir, path)).catch(() => undefined)
        if (content === undefined) continue
        const sha256 = createHash('sha256').update(content).digest('hex')
        if (content.byteLength !== expected.bytes || sha256 !== expected.sha256) stale.push(path)
      }
      return stale.sort()
    },

    async apply(given) {
      const registry = registryFor({ home: args.home() })
      const sessionDir = await registry.sessionDirFor({ threadId: given.threadId })
      await registry.enqueue({
        handle: registry.handleFor({ sessionDir }),
        run: async () => {
          for (const written of given.writes) {
            if (!mirrorWriteAllowed(written.path)) continue
            await stage({ target: join(sessionDir, safeRelativeSegment(written.path) ?? written.path), content: written.content })
          }
          for (const deleted of given.deletions) {
            if (!mirrorWriteAllowed(deleted)) continue
            await rm(join(sessionDir, safeRelativeSegment(deleted) ?? deleted), { force: true })
          }
          await writeMirrorStamp({ sessionDir, stamp: given.stamp })
          registry.invalidateSession({ sessionDir })
        },
      })
    },
  }
}
