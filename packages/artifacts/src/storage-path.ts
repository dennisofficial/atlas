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

export const ROUTE_VERSION_PREFIX = 'v'

export type ArtifactTreeKey = { id: string; path: string }

export type ArtifactRouteKey = ArtifactTreeKey & { version: number }

export const routePrefixOf = ({ id }: { id: string }): string =>
  `${ARTIFACTS_PREFIX}${id}/${ROUTE_TREE}/`

export const sourcePrefixOf = ({ id }: { id: string }): string =>
  `${ARTIFACTS_PREFIX}${id}/${SOURCE_TREE}/`

const versionFolderOf = ({ prefix, version }: { prefix: string; version: number }): string => {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new ArtifactPathError(`version must be a positive integer, got ${version}`)
  }
  return `${prefix}${ROUTE_VERSION_PREFIX}${version}/`
}

const versionOfKey = ({ prefix, key }: { prefix: string; key: string }): number | null => {
  if (!key.startsWith(prefix)) return null
  const folder = key.slice(prefix.length).split('/')[0] ?? ''
  const match = /^v([1-9][0-9]*)$/.exec(folder)
  return match === null ? null : Number(match[1])
}

export const routeVersionPrefixOf = ({ id, version }: { id: string; version: number }): string =>
  versionFolderOf({ prefix: routePrefixOf({ id }), version })

export const sourceVersionPrefixOf = ({ id, version }: { id: string; version: number }): string =>
  versionFolderOf({ prefix: sourcePrefixOf({ id }), version })

export const routeVersionOfKey = ({ id, key }: { id: string; key: string }): number | null =>
  versionOfKey({ prefix: routePrefixOf({ id }), key })

export const sourceVersionOfKey = ({ id, key }: { id: string; key: string }): number | null =>
  versionOfKey({ prefix: sourcePrefixOf({ id }), key })

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

export const routeFilePathOf = ({ id, version, path }: ArtifactRouteKey): string => {
  const prefix = routeVersionPrefixOf({ id, version })
  return withinPrefix({ key: `${prefix}${path}`, prefix, path })
}

export const sourceFilePathOf = ({ id, version, path }: ArtifactRouteKey): string => {
  const prefix = sourceVersionPrefixOf({ id, version })
  return withinPrefix({ key: `${prefix}${path}`, prefix, path })
}
