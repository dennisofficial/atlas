export const CLOUD_WORKSPACES_PATH = '/atlas/workspaces'
export const CLOUD_WORKSPACE_PATH = `${CLOUD_WORKSPACES_PATH}/workspace`

const SEPARATORS = /[\\/]+/
const UNNAMEABLE_COMPONENTS = new Set(['.', '..'])

export function cloudWorkspacePath({ sourcePath }: { sourcePath: string }): string {
  const name = sourcePath
    .split(SEPARATORS)
    .filter((component) => component.length > 0)
    .at(-1)
  if (name === undefined || UNNAMEABLE_COMPONENTS.has(name)) return CLOUD_WORKSPACE_PATH
  return `${CLOUD_WORKSPACES_PATH}/${name}`
}
