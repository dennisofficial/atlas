import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { isPortableSessionFile, safeRelativeSegment, walkRegularFiles } from '@dltech/atlas-harness'
import type { SessionFileContent, SessionMirrorFile } from '@dltech/atlas-wire'

const mirrorable = (path: string): boolean =>
  safeRelativeSegment(path) !== null && isPortableSessionFile({ key: path })

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
