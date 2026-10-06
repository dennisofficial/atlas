import {
  EQualityReviewStatus,
  EQualitySkipReason,
  codeQualityReviewedSchema,
  type CallId,
  type CodeQualityReviewedBody,
  type QualityAssessment,
  type QualityFinding,
  type QualityPolicy,
  type QualityScope,
  type QualityScopeIdentity,
} from '@dltech/atlas-core'

export type NotifiableEntry = {
  finding: QualityFinding
  assessment: QualityAssessment
  scope: QualityScope
  policy: QualityPolicy
}

export type ReviewItem = { record: CodeQualityReviewedBody; notifiable: readonly NotifiableEntry[] }

const PLACEHOLDER = 'unknown'

const identifier = (value: string): string => (value.length > 0 ? value : PLACEHOLDER)

export function identityOf({ scope }: { scope: QualityScope }): QualityScopeIdentity {
  return {
    id: scope.id,
    workspaceNamespace: scope.workspaceNamespace,
    path: scope.path,
    language: scope.language,
    kind: scope.kind,
    name: scope.name,
    adapterVersion: scope.adapterVersion,
    structuralHash: scope.structuralHash,
    parentScopeId: scope.parentScopeId,
    lineRange: scope.lineRange,
  }
}

export type RecordFacts = {
  callId: CallId
  workspaceNamespace: string
  path: string
  scope?: QualityScope | undefined
  status: EQualityReviewStatus
  reason?: EQualitySkipReason | undefined
  detail?: string | undefined
  assessments?: readonly QualityAssessment[]
  findings?: readonly QualityFinding[]
  durationMs: number
  requestedModel?: string | undefined
  resolvedModel?: string | undefined
  evidencePath?: string | undefined
}

export function buildRecord({ scope, assessments = [], findings = [], ...facts }: RecordFacts): CodeQualityReviewedBody {
  return {
    type: 'code-quality-reviewed',
    ...facts,
    scope: scope === undefined ? undefined : identityOf({ scope }),
    beforeHash: scope?.beforeHash ?? null,
    afterHash: scope?.afterHash ?? null,
    assessments,
    findings,
  }
}

export function validateItem({ item }: { item: ReviewItem }): ReviewItem {
  const { record } = item
  if (codeQualityReviewedSchema.safeParse(record).success) return item
  const replacement = buildRecord({
    callId: record.callId,
    workspaceNamespace: identifier(record.workspaceNamespace),
    path: identifier(record.path),
    status: EQualityReviewStatus.OperationalError,
    detail: 'review record failed validation and was replaced',
    durationMs: Number.isFinite(record.durationMs) ? Math.max(0, record.durationMs) : 0,
  })
  return { record: replacement, notifiable: [] }
}

function evidenceLabels({ assessment, scope }: { assessment: QualityAssessment; scope: QualityScope }): readonly string[] {
  const labels = new Map(scope.evidence.map((evidence) => [evidence.id, evidence.label]))
  return assessment.evidenceIds.flatMap((id) => labels.get(id) ?? [])
}

function entryLine({ path, entry }: { path: string; entry: NotifiableEntry }): string {
  const { assessment, scope, policy } = entry
  try {
    const labels = evidenceLabels({ assessment, scope })
    const evidence = labels.length > 0 ? ` (evidence: ${labels.join(', ')})` : ''
    return `- ${path} ${scope.kind} ${scope.name}: ${policy.guidance({ assessment, scope })}${evidence}`
  } catch (error) {
    return `- ${path} ${scope.kind} ${scope.name}: guidance from policy "${policy.id}" failed to render (${error instanceof Error ? error.message : String(error)})`
  }
}

export function renderNudge({ items }: { items: readonly ReviewItem[] }): string | undefined {
  const byPolicy = new Map<string, { title: string; lines: string[] }>()
  const paths = new Set<string>()
  for (const { record, notifiable } of items) {
    for (const entry of notifiable) {
      paths.add(record.path)
      const group = byPolicy.get(entry.policy.id) ?? { title: entry.policy.title, lines: [] }
      group.lines.push(entryLine({ path: record.path, entry }))
      byPolicy.set(entry.policy.id, group)
    }
  }
  if (byPolicy.size === 0) return undefined

  const sections = [...byPolicy.values()].map((group) => `${group.title}\n${group.lines.join('\n')}`)
  const written = `${[...paths].join(', ')} ${paths.size === 1 ? 'was' : 'were'} written successfully`
  return [
    `Code quality note: ${written}. This advisory review is not a failure and nothing was reverted.`,
    ...sections,
    'If the current structure is justified, leaving it unchanged is fine.',
  ].join('\n\n')
}
