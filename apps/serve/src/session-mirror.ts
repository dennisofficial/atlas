import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  isPortableSessionFile,
  safeRelativeSegment,
  walkRegularFiles,
  EVENTS_FILE_SUFFIX,
  THREADS_DIRECTORY_NAME,
} from '@dltech/atlas-harness'
import type { SessionFileContent, SessionMirrorFile } from '@dltech/atlas-wire'

import { MIRROR_STAMP_NAME } from '@dltech/atlas-harness'

/** Above this the mirror leaves the blob on the channel; context/image readers fetch on demand. */
const MAX_MIRROR_FILE_BYTES = 4 * 1024 * 1024

const isEventLog = (path: string): boolean =>
  path.startsWith(`${THREADS_DIRECTORY_NAME}/`) && path.endsWith(EVENTS_FILE_SUFFIX)

const isMirrorArtifact = (path: string): boolean =>
  path === MIRROR_STAMP_NAME || path.endsWith('.mirror.tmp')

const mirrorable = (path: string): boolean => {
  // The event log is the transcript syncer's own channel-verified stream; hashing it here mid-append
  // would race every tail. Liveness/host-specific shell state is excluded by isPortableSessionFile.
  // The stamp and its temp files are the mirror's own bookkeeping, never the serve's data.
  if (isEventLog(path) || isMirrorArtifact(path)) return false
  return safeRelativeSegment(path) !== null && isPortableSessionFile({ key: path })
}

const sha256Of = (content: Buffer): string => createHash('sha256').update(content).digest('hex')

const encodingOf = (content: Buffer): 'utf8' | 'base64' => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content)
    return 'utf8'
  } catch {
    return 'base64'
  }
}

export type SessionMirrorReader = {
  manifest(): Promise<{ files: SessionMirrorFile[] }>
  readFiles(args: { paths: readonly string[] }): Promise<{ files: SessionFileContent[]; missing: string[] }>
}

export function createSessionMirrorReader(args: { sessionDir: () => string }): SessionMirrorReader {
  return {
    async manifest() {
      const root = args.sessionDir()
      const keys = (await walkRegularFiles({ root })) ?? []
      const files: SessionMirrorFile[] = []
      for (const key of keys) {
        if (!mirrorable(key)) continue
        const content = await readFile(join(root, key)).catch(() => undefined)
        if (content === undefined) continue
        if (content.byteLength > MAX_MIRROR_FILE_BYTES) continue
        files.push({ path: key, bytes: content.byteLength, sha256: sha256Of(content) })
      }
      return { files }
    },

    async readFiles({ paths }) {
      const root = args.sessionDir()
      const files: SessionFileContent[] = []
      const missing: string[] = []
      for (const requested of paths) {
        const safe = safeRelativeSegment(requested)
        if (safe === null || !mirrorable(safe)) {
          missing.push(requested)
          continue
        }
        const content = await readFile(join(root, safe)).catch(() => undefined)
        if (content === undefined) {
          missing.push(safe)
          continue
        }
        if (content.byteLength > MAX_MIRROR_FILE_BYTES) {
          missing.push(safe)
          continue
        }
        const encoding = encodingOf(content)
        files.push({
          path: safe,
          encoding,
          content: encoding === 'base64' ? content.toString('base64') : content.toString('utf8'),
        })
      }
      return { files, missing }
    },
  }
}
