import {
  contentTypeOf,
  exceededBy,
  parseSpec,
  selectedByPolicy,
  selectionPolicyOf,
  type ArtifactSpec,
  type ManifestEntry,
} from '@dltech/atlas-artifacts'

import { ArtifactRefused } from './artifact-port'

export type PlannedFile = { path: string; sha256: string; size: number }

export type PublishPlan = { entries: ManifestEntry[]; spec: ArtifactSpec }

export const EMPTY_SPEC = {}

export function publishPlanOf(args: {
  specRaw: unknown
  files: readonly PlannedFile[]
}): PublishPlan {
  const spec = parseSpec(args.specRaw)
  const policy = selectionPolicyOf(spec)
  const entries = args.files
    .filter((file) => selectedByPolicy({ path: file.path, policy, fromGit: true }))
    .map(
      (file): ManifestEntry => ({
        path: file.path,
        tree: 'src',
        sha256: file.sha256,
        size: file.size,
        type: contentTypeOf(file.path),
      }),
    )
    .sort((left, right) => left.path.localeCompare(right.path))

  if (entries.length === 0) {
    throw new ArtifactRefused(
      'No file in that directory is publishable: git tracks nothing there and nothing untracked survived the ignore rules and the hard exclusions (.env*, node_modules, .git).',
    )
  }

  const exceeded = exceededBy(entries)
  if (exceeded !== null) throw new ArtifactRefused(exceeded.reason)

  return { entries, spec }
}
