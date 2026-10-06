import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { CLOUD_WORKSPACE_PATH } from '@dltech/atlas-core'

export type DirectoryEntries = (args: { directory: string }) => Promise<readonly string[]>

const LEGACY_DIRECTORY_NAME = 'workspace'

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT'

export const readDirectoryEntries: DirectoryEntries = async ({ directory }) => {
  try {
    return await readdir(directory)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

export async function legacyWorkspaceDirectoryOf({
  cwd,
  driveHome,
  entriesOf = readDirectoryEntries,
}: {
  cwd: string
  driveHome: string
  entriesOf?: DirectoryEntries | undefined
}): Promise<string> {
  if (cwd !== CLOUD_WORKSPACE_PATH) return cwd
  if ((await entriesOf({ directory: cwd })).length > 0) return cwd

  const legacy = join(dirname(driveHome), LEGACY_DIRECTORY_NAME)
  return (await entriesOf({ directory: legacy })).length > 0 ? legacy : cwd
}
