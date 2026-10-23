import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { CodexModelsPorts } from '../models'
import { atlasDirectory } from '../store/paths'

const CACHE_FILE_NAME = 'codex-models-cache.json'

export const codexModelsFsPorts = (
  args: { cacheFile?: string } = {},
): CodexModelsPorts & { cacheFile: string } => {
  const cacheFile = args.cacheFile ?? join(atlasDirectory(), CACHE_FILE_NAME)
  return {
    cacheFile,
    fetch: (url, init) => fetch(url, init),
    now: () => new Date().toISOString(),
    identityOf: (credential) =>
      createHash('sha256')
        .update(credential.providerAccountId ?? credential.accountId)
        .digest('hex'),
    cache: {
      read: () => {
        try {
          return readFileSync(cacheFile, 'utf8')
        } catch {
          return undefined
        }
      },
      write: (text) => {
        mkdirSync(dirname(cacheFile), { recursive: true })
        const staging = `${cacheFile}.${process.pid}.tmp`
        writeFileSync(staging, text)
        renameSync(staging, cacheFile)
      },
    },
  }
}
