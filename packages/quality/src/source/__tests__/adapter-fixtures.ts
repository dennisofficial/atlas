import type { CapturedFileChange, QualityScope, QualityScopeIdentity } from '@dltech/atlas-core'
import { EQualityScopeKind } from '@dltech/atlas-core'

import { prepareQualityScopes } from '../scope-adapter'

export const PROJECT = '/proj'
export const NAMESPACE = 'local:test-root-sha'

export function prepare(args: {
  path: string
  before: string | null
  after: string
  previousScopes?: readonly QualityScopeIdentity[]
}) {
  const change: CapturedFileChange = { path: args.path, before: args.before, after: args.after }
  return prepareQualityScopes({
    change,
    projectDirectory: PROJECT,
    workspaceNamespace: NAMESPACE,
    previousScopes: args.previousScopes ?? [],
  })
}

export const byKind = (scopes: readonly QualityScope[], kind: EQualityScopeKind) =>
  scopes.filter((scope) => scope.kind === kind)
