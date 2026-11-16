import {
  contentTypeOf,
  exceededBy,
  isHardExcluded,
  selectedByPolicy,
  selectionPolicyOf,
  type ArtifactSpec,
  type ManifestEntry,
  type ManifestTree,
} from '@dltech/atlas-artifacts'

import { ArtifactRefused } from './artifact-port'

export type ArtifactFile = {
  path: string
  tree: ManifestTree
  sha256: string
  size: number
  bytes: Uint8Array
}

export type PublishPlan = { entries: ManifestEntry[]; spec: ArtifactSpec }

export type PlannedCounts = { source: number; output: number }

export const EMPTY_SPEC = {}

const underOutDir = (args: { path: string; outDir: string }): boolean =>
  args.path === args.outDir || args.path.startsWith(`${args.outDir}/`)

const entryOf = (file: ArtifactFile): ManifestEntry => ({
  path: file.path,
  tree: file.tree,
  sha256: file.sha256,
  size: file.size,
  type: contentTypeOf(file.path),
})

export function publishPlanOf(args: {
  spec: ArtifactSpec
  source: readonly ArtifactFile[]
  output: readonly ArtifactFile[]
}): PublishPlan {
  const policy = selectionPolicyOf(args.spec)
  const outDir = args.spec.build?.outDir
  const source = args.source.filter(
    (file) =>
      selectedByPolicy({ path: file.path, policy, fromGit: true }) &&
      (outDir === undefined || !underOutDir({ path: file.path, outDir })),
  )
  const output = args.output.filter((file) => !isHardExcluded({ path: file.path }))
  const entries = [...source, ...output]
    .map(entryOf)
    .sort((left, right) =>
      left.tree === right.tree ? left.path.localeCompare(right.path) : left.tree === 'src' ? -1 : 1,
    )

  if (source.length === 0) {
    throw new ArtifactRefused(
      'No file in that directory is publishable: git tracks nothing there and nothing untracked survived the ignore rules and the hard exclusions (.env*, node_modules, .git).',
    )
  }

  const exceeded = exceededBy(entries)
  if (exceeded !== null) throw new ArtifactRefused(exceeded.reason)

  return { entries, spec: args.spec }
}

export const countsOf = (plan: PublishPlan): PlannedCounts => ({
  source: plan.entries.filter((entry) => entry.tree === 'src').length,
  output: plan.entries.filter((entry) => entry.tree === 'dist').length,
})
