import {
  routeFilePathOf,
  sourceFilePathOf,
  type ManifestEntry,
  type ManifestTree,
} from '@dltech/atlas-artifacts'

export type ArtifactUploadGrant = {
  path: string
  tree: ManifestTree
  sha256: string
  pathname: string
}

type UploadOf = { id: string; version: number; entry: ManifestEntry }

const sourceGrantOf = (args: UploadOf): ArtifactUploadGrant => ({
  path: args.entry.path,
  tree: 'src',
  sha256: args.entry.sha256,
  pathname: sourceFilePathOf({ id: args.id, version: args.version, path: args.entry.path }),
})

const routeGrantOf = (args: UploadOf): ArtifactUploadGrant => ({
  path: args.entry.path,
  tree: 'dist',
  sha256: args.entry.sha256,
  pathname: routeFilePathOf({ id: args.id, version: args.version, path: args.entry.path }),
})

const mirrorOf = (args: UploadOf): ArtifactUploadGrant => ({
  ...sourceGrantOf(args),
  tree: 'dist',
  pathname: routeFilePathOf({ id: args.id, version: args.version, path: args.entry.path }),
})

export const mirrorsSource = (entries: readonly ManifestEntry[]): boolean =>
  !entries.some((entry) => entry.tree === 'dist')

export const uploadsOf = (args: {
  id: string
  version: number
  entries: readonly ManifestEntry[]
}): ArtifactUploadGrant[] => {
  const sources = args.entries.filter((entry) => entry.tree === 'src')
  const sourceGrants = sources.map((entry) =>
    sourceGrantOf({ id: args.id, version: args.version, entry }),
  )
  const output = mirrorsSource(args.entries)
    ? sources.map((entry) => mirrorOf({ id: args.id, version: args.version, entry }))
    : args.entries
        .filter((entry) => entry.tree === 'dist')
        .map((entry) => routeGrantOf({ id: args.id, version: args.version, entry }))
  return [...sourceGrants, ...output]
}
