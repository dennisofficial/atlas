import type { QualityScope } from '@dltech/atlas-core'

import { counterAfter, counterBefore, PROJECT_DIRECTORY, WORKSPACE_NAMESPACE } from '../../__fixtures__/curation'
import { prepareQualityScopes } from '../../../packages/harness/src/quality/source/scope-adapter'
import { EQualityScopeKind } from '@dltech/atlas-core'

export function scopeFixture(): QualityScope {
  const preparation = prepareQualityScopes({
    change: { path: `${PROJECT_DIRECTORY}/src/counter.ts`, before: counterBefore(), after: counterAfter() },
    projectDirectory: PROJECT_DIRECTORY,
    workspaceNamespace: WORKSPACE_NAMESPACE,
    previousScopes: [],
  })
  const scope = preparation.scopes.find((candidate) => candidate.kind === EQualityScopeKind.Class)
  if (scope === undefined) throw new Error('fixture produced no class scope')
  return scope
}
