import { existsSync, renameSync } from 'node:fs'

import { atlasVaultFile } from '../credentials/paths'
import { atlasSecretsFile } from '../secrets/paths'
import { userMcpFile } from '../settings/paths'
import { archivedPathOf, restoreArchivedSecrets, restoreArchivedVault } from './local-archive'

type ArchivedFile = {
  file: string
  merge: ((file: string) => boolean) | undefined
}

const LOCAL_SYNCED_FILES = (): ArchivedFile[] => [
  { file: atlasVaultFile(), merge: restoreArchivedVault },
  { file: atlasSecretsFile(), merge: restoreArchivedSecrets },
  { file: userMcpFile(), merge: undefined },
]

const isAbsentFile = (cause: unknown): boolean =>
  typeof cause === 'object' && cause !== null && Reflect.get(cause, 'code') === 'ENOENT'

const mergedBack = (args: ArchivedFile): boolean => {
  if (args.merge === undefined || !existsSync(archivedPathOf(args.file))) return false
  try {
    return args.merge(args.file)
  } catch {
    return false
  }
}

export function restoreArchivedLocalFiles(): string[] {
  const restored: string[] = []
  for (const archived of LOCAL_SYNCED_FILES()) {
    const { file } = archived
    if (existsSync(file)) {
      if (mergedBack(archived)) restored.push(file)
      continue
    }
    try {
      renameSync(archivedPathOf(file), file)
      restored.push(file)
    } catch (cause) {
      if (!isAbsentFile(cause)) throw cause
    }
  }
  return restored
}
