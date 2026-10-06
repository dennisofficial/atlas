import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualityTransition,
  type QualityAssessment,
  type QualityFinding,
} from './policy'
import type { CodeQualityReviewedBody } from './schema'

export type QualityFindingKey = { policyId: string; scopeId: string }

export type QualityLedgerStep = {
  findings: readonly QualityFinding[]
  notifiable: readonly QualityFinding[]
}

const keyOf = ({ policyId, scopeId }: QualityFindingKey): string => `${policyId}\u0000${scopeId}`

export const findingId = ({ policyId, scopeId, episode }: QualityFindingKey & { episode: number }): string =>
  `${policyId}:${scopeId}:${episode}`

type Applied = { finding: QualityFinding | undefined; notify: boolean }

function openEpisode({
  existing,
  assessment,
  afterHash,
  notify,
}: {
  existing: QualityFinding | undefined
  assessment: QualityAssessment
  afterHash: string | null
  notify: boolean
}): Applied {
  const episode = (existing?.episode ?? 0) + 1
  const finding: QualityFinding = {
    id: findingId({ policyId: assessment.policyId, scopeId: assessment.scopeId, episode }),
    policyId: assessment.policyId,
    scopeId: assessment.scopeId,
    episode,
    state: EQualityFindingState.Active,
    notified: notify,
    lastAfterHash: afterHash,
    policyVersion: assessment.policyVersion,
  }
  return { finding, notify }
}

function updateActive({
  existing,
  assessment,
  afterHash,
  notify,
}: {
  existing: QualityFinding
  assessment: QualityAssessment
  afterHash: string | null
  notify: boolean
}): Applied {
  const finding: QualityFinding = {
    ...existing,
    notified: existing.notified || notify,
    lastAfterHash: afterHash,
    policyVersion: assessment.policyVersion,
  }
  return { finding, notify }
}

function resolve({ existing, afterHash }: { existing: QualityFinding | undefined; afterHash: string | null }): Applied {
  if (existing === undefined || existing.state === EQualityFindingState.Resolved) {
    return { finding: existing, notify: false }
  }
  return { finding: { ...existing, state: EQualityFindingState.Resolved, lastAfterHash: afterHash }, notify: false }
}

function applyAssessment({
  existing,
  assessment,
  afterHash,
}: {
  existing: QualityFinding | undefined
  assessment: QualityAssessment
  afterHash: string | null
}): Applied {
  if (assessment.status !== EQualityReviewStatus.Completed) return { finding: existing, notify: false }
  if (assessment.transition === EQualityTransition.None) return { finding: existing, notify: false }
  if (assessment.transition === EQualityTransition.Resolve) return resolve({ existing, afterHash })

  const introduce = assessment.transition === EQualityTransition.Introduce
  if (existing === undefined || existing.state === EQualityFindingState.Resolved) {
    return openEpisode({ existing, assessment, afterHash, notify: introduce })
  }
  return updateActive({ existing, assessment, afterHash, notify: introduce && !existing.notified })
}

export function applyAssessments({
  previous,
  assessments,
  afterHash,
  scopeDeleted,
}: {
  previous: readonly QualityFinding[]
  assessments: readonly QualityAssessment[]
  afterHash: string | null
  scopeDeleted: boolean
}): QualityLedgerStep {
  const table = new Map<string, QualityFinding>(previous.map((finding) => [keyOf(finding), finding]))
  const notifiable: QualityFinding[] = []

  if (scopeDeleted) {
    for (const [key, finding] of table) table.set(key, resolve({ existing: finding, afterHash: null }).finding ?? finding)
    return { findings: [...table.values()], notifiable }
  }

  for (const assessment of assessments) {
    const key = keyOf(assessment)
    const applied = applyAssessment({ existing: table.get(key), assessment, afterHash })
    if (applied.finding === undefined) continue
    table.set(key, applied.finding)
    if (applied.notify) notifiable.push(applied.finding)
  }

  return { findings: [...table.values()], notifiable }
}

export function foldQualityFindings({
  records,
}: {
  records: readonly CodeQualityReviewedBody[]
}): ReadonlyMap<string, readonly QualityFinding[]> {
  const byScope = new Map<string, readonly QualityFinding[]>()
  for (const record of records) {
    if (record.scope === undefined) continue
    byScope.set(record.scope.id, record.findings)
  }
  return byScope
}

export const activeFindings = ({ findings }: { findings: readonly QualityFinding[] }): readonly QualityFinding[] =>
  findings.filter((finding) => finding.state === EQualityFindingState.Active)
