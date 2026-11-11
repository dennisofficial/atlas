export const ARTIFACTS_PREFIX = 'artifacts/'
export const ROUTES_PREFIX = 'routes/'
export const ROUTE_TREE = '_route'
export const SOURCE_TREE = '_source'

export class ArtifactPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArtifactPathError'
  }
}

export type ArtifactTreeKey = { id: string; path: string }

export const routePrefixOf = ({ id }: { id: string }): string =>
  `${ARTIFACTS_PREFIX}${id}/${ROUTE_TREE}/`

export const sourcePrefixOf = ({ id }: { id: string }): string =>
  `${ARTIFACTS_PREFIX}${id}/${SOURCE_TREE}/`

export const routePathOf = ({ id }: { id: string }): string => `${ROUTES_PREFIX}${id}.json`

const isPlainRelativePath = (path: string): boolean => {
  if (path.length === 0 || path.startsWith('/')) return false
  if (path.includes('\\') || path.includes('\0')) return false
  const segments = path.split('/')
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

const withinPrefix = ({
  key,
  prefix,
  path,
}: {
  key: string
  prefix: string
  path: string
}): string => {
  if (!isPlainRelativePath(path) || !key.startsWith(prefix)) {
    throw new ArtifactPathError(`key escapes ${prefix}: ${key}`)
  }
  return key
}

export const routeFilePathOf = ({ id, path }: ArtifactTreeKey): string => {
  const prefix = routePrefixOf({ id })
  return withinPrefix({ key: `${prefix}${path}`, prefix, path })
}

export const sourcePathOf = ({ id, path }: ArtifactTreeKey): string => {
  const prefix = sourcePrefixOf({ id })
  return withinPrefix({ key: `${prefix}${path}`, prefix, path })
}
