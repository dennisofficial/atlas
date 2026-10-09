import { CLOUD_WORKSPACE_PATH, CLOUD_WORKSPACES_PATH } from './serve-env.js'

const SEPARATORS = /[\\/]+/
const UNNAMEABLE_COMPONENTS = new Set(['.', '..'])

/**
 * The in-sandbox workspace path for a lifted checkout: named beside the other workspaces when the
 * source directory has a usable final component, the anonymous default otherwise.
 */
export function cloudWorkspacePath({ sourcePath }: { sourcePath: string }): string {
  const name = sourcePath
    .split(SEPARATORS)
    .filter((component) => component.length > 0)
    .at(-1)
  if (name === undefined || UNNAMEABLE_COMPONENTS.has(name)) return CLOUD_WORKSPACE_PATH
  return `${CLOUD_WORKSPACES_PATH}/${name}`
}
