import { existsSync, renameSync } from 'node:fs'

import { atlasVaultFile } from '../credentials/paths'
import { atlasSecretsFile } from '../secrets/paths'
import { userMcpFile } from '../settings/paths'

const LOCAL_SYNCED_FILES = (): string[] => [atlasVaultFile(), atlasSecretsFile(), userMcpFile()]

const isAbsentFile = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT'

export function restoreArchivedLocalFiles(): string[] {
  const restored: string[] = []
  for (const file of LOCAL_SYNCED_FILES()) {
    if (existsSync(file)) continue
    try {
      renameSync(`${file}.archived`, file)
      restored.push(file)
    } catch (cause) {
      if (!isAbsentFile(cause)) throw cause
    }
  }
  return restored
}
