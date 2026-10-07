import { EQualityLanguage, EQualityScopeKind } from '@dltech/atlas-core'

import { ECandidateMethod, type Candidate } from '../src/curation/candidates'
import { sha256Hex } from '../src/hash'

export function makeCandidate({
  id,
  before = null,
  after = 'x',
  path = 'a.ts',
  method = ECandidateMethod.ProspectiveCapture,
}: {
  id: string
  before?: string | null
  after?: string
  path?: string
  method?: ECandidateMethod
}): Candidate {
  return {
    schemaVersion: 2,
    candidateId: id,
    method,
    group: `group-${id}`,
    provenance: { session: 's', captureId: id, adapterVersion: '1', sourceHash: sha256Hex({ text: after }) },
    snapshot: {
      path,
      workspaceNamespace: 'ns',
      adapterVersion: '1',
      scope: {
        id: 'scope-shared',
        kind: EQualityScopeKind.Function,
        name: 'x',
        language: EQualityLanguage.TypeScript,
        structuralHash: 'sh',
        parentScopeId: null,
        lineRange: null,
        beforeLineRange: null,
        afterLineRange: null,
        before,
        after,
        diff: '',
        dependencyContext: [],
        evidence: [],
      },
      digests: { beforeSha256: before === null ? null : sha256Hex({ text: before }), afterSha256: sha256Hex({ text: after }) },
      redaction: { path: [], name: [], before: [], after: [], diff: [], dependencyContext: [], evidence: [] },
    },
  }
}
