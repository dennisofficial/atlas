import { join } from 'node:path'

import { SANDBOX_WORKSPACES_PATH } from '@dltech/atlas-wire'

export const ARTIFACTS_DIRECTORY_NAME = 'artifacts'

const MAX_FOLDER_NAME_LENGTH = 60
const FALLBACK_FOLDER_NAME = 'artifact'

const underPath = ({ directory, path }: { directory: string; path: string }): boolean =>
  path === directory || path.startsWith(`${directory}/`)

export function artifactsRootOf({
  projectDirectory,
  atlasHome,
}: {
  projectDirectory: string
  atlasHome: string
}): string {
  if (underPath({ directory: SANDBOX_WORKSPACES_PATH, path: projectDirectory })) {
    return join(SANDBOX_WORKSPACES_PATH, ARTIFACTS_DIRECTORY_NAME)
  }
  return join(atlasHome, ARTIFACTS_DIRECTORY_NAME)
}

export function artifactFolderNameOf(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .replace(/^-+|-+$/g, '')
  return slug === '' ? FALLBACK_FOLDER_NAME : slug
}
