import {
  EQualityFindingState,
  EQualityReviewStatus,
  EQualitySkipReason,
  EQualityTransition,
  replacedRanges,
  singleResponsibilityPolicy,
  type Event,
  type EventOfType,
  type QualityFinding,
} from '@dltech/atlas-core'

import { EAuthor, EEntryKind, type CodeQualityReviewedEntry } from './transcript-model'

type QualityRecord = EventOfType<'code-quality-reviewed'>

type QualityFindingView = {
  record: QualityRecord
  finding: QualityFinding
}

export type QualityEntryGroup = {
  records: readonly QualityRecord[]
  findings: readonly QualityFindingView[]
  failures: readonly QualityRecord[]
  seq: number
  nudge: EventOfType<'nudge'> | undefined
}

const POLICY_TITLES: Readonly<Record<string, string>> = {
  [singleResponsibilityPolicy.id]: singleResponsibilityPolicy.title,
}

const EXPECTED_SKIPS: ReadonlySet<EQualitySkipReason> = new Set([
  EQualitySkipReason.UnsupportedLanguage,
  EQualitySkipReason.DeclarationOnly,
  EQualitySkipReason.OutsideWorkspace,
  EQualitySkipReason.SourceUnavailable,
  EQualitySkipReason.InvalidText,
  EQualitySkipReason.InvalidSyntax,
  EQualitySkipReason.OversizedSource,
  EQualitySkipReason.NoSupportedScope,
  EQualitySkipReason.ScopeIdentityUncertain,
  EQualitySkipReason.Disabled,
  EQualitySkipReason.OversizedRequest,
  EQualitySkipReason.TurnInterrupted,
  EQualitySkipReason.WorkspaceUnidentified,
])

const policyTitle = (id: string): string => POLICY_TITLES[id] ?? id

const introducedBy = (record: QualityRecord): readonly QualityFinding[] =>
  record.findings.filter(
    (finding) =>
      finding.state === EQualityFindingState.Active &&
      finding.notified &&
      record.assessments.some(
        (assessment) =>
          assessment.policyId === finding.policyId &&
          assessment.scopeId === finding.scopeId &&
          assessment.transition === EQualityTransition.Introduce,
      ),
  )

const notifiedIdsOf = (record: QualityRecord): readonly string[] =>
  record.findings
    .filter((finding) => finding.state === EQualityFindingState.Active && finding.notified)
    .map((finding) => finding.id)

const operationallyFailed = (record: QualityRecord): boolean => {
  if (record.reason === EQualitySkipReason.DecisionUnavailable) return true
  if (record.reason === EQualitySkipReason.ReviewDeadline) return true
  if (record.reason === EQualitySkipReason.UncalibratedModel) return true
  if (record.reason !== undefined && EXPECTED_SKIPS.has(record.reason)) return false
  return record.status === EQualityReviewStatus.OperationalError
}

const inReplacedRange = (args: { event: Event; ranges: ReturnType<typeof replacedRanges> }): boolean =>
  args.ranges.some((range) => args.event.seq >= range.fromSeq && args.event.seq <= range.throughSeq)

export function qualityEntryGroups(events: readonly Event[]): readonly QualityEntryGroup[] {
  const ranges = replacedRanges(events)
  const groups = new Map<string, QualityEntryGroup>()
  const ordered: QualityEntryGroup[] = []
  const notifiedByScope = new Map<string, Set<string>>()
  let lastVisible: QualityEntryGroup | undefined

  for (const event of events) {
    if (event.type === 'nudge') {
      if (lastVisible !== undefined && lastVisible.findings.length > 0 && lastVisible.nudge === undefined) {
        lastVisible.nudge = event
      }
      lastVisible = undefined
      continue
    }
    if (event.type !== 'code-quality-reviewed') {
      lastVisible = undefined
      continue
    }
    const scopeId = event.scope?.id
    const prior = scopeId === undefined ? new Set<string>() : (notifiedByScope.get(scopeId) ?? new Set<string>())
    const currentNotifiedIds = notifiedIdsOf(event)
    if (scopeId !== undefined) notifiedByScope.set(scopeId, new Set(currentNotifiedIds))

    if (inReplacedRange({ event, ranges })) {
      lastVisible = undefined
      continue
    }

    const introduced = introducedBy(event).filter((finding) => !prior.has(finding.id))

    if (event.status === EQualityReviewStatus.Skipped && !operationallyFailed(event)) continue

    const key = event.callId
    const held = groups.get(key)
    const group: QualityEntryGroup =
      held === undefined
        ? { records: [], findings: [], failures: [], seq: event.seq, nudge: undefined }
        : held
    const introducedViews = introduced.map((finding) => ({ record: event, finding }))
    const failed = operationallyFailed(event)
    group.records = [...group.records, event]
    group.findings = [...group.findings, ...introducedViews]
    if (failed) group.failures = [...group.failures, event]
    group.seq = event.seq

    if (group.findings.length === 0 && group.failures.length === 0) {
      lastVisible = undefined
      continue
    }

    if (held === undefined) {
      groups.set(key, group)
      ordered.push(group)
    }
    lastVisible = group
  }

  return ordered.filter((group) => group.findings.length > 0 || group.failures.length > 0)
}

const titleOf = (group: QualityEntryGroup): string => {
  if (group.findings.length === 1) return policyTitle(group.findings[0]?.finding.policyId ?? '')
  if (group.findings.length > 1) return `${group.findings.length} quality findings`

  const failure = group.failures[0]
  if (failure?.reason === EQualitySkipReason.ReviewDeadline) return 'Review failed · timed out'
  if (failure?.reason === EQualitySkipReason.DecisionUnavailable) return 'Review failed · decision unavailable'
  if (failure?.reason === EQualitySkipReason.UncalibratedModel) return 'Review failed · uncalibrated model'
  const detail = failure === undefined ? undefined : failureDetail(failure)
  return detail === undefined ? 'Review failed' : `Review failed · ${detail}`
}

const findingLines = (findings: readonly QualityFindingView[]): string[] =>
  findings.map(({ record, finding }) =>
    `${record.path}${record.scope === undefined ? '' : ` · ${record.scope.kind} ${record.scope.name}`} · ${policyTitle(finding.policyId)}`,
  )

const failureDetail = (record: QualityRecord): string =>
  record.reason !== undefined || record.detail === undefined
    ? (record.detail ?? record.reason ?? 'the review gave no detail')
    : record.detail.replace(/^review failed:\s*/i, '')

const failureLines = (failures: readonly QualityRecord[]): string[] =>
  [...new Set(failures.map((record) => failureDetail(record)))]

export function qualityEntriesBySeq(events: readonly Event[]): ReadonlyMap<number, CodeQualityReviewedEntry> {
  return new Map(qualityEntryGroups(events).map((group) => [group.seq, entryOfQualityGroup({ group })]))
}

export function entryOfQualityGroup({ group }: { group: QualityEntryGroup }): CodeQualityReviewedEntry {
  const sections = [...findingLines(group.findings), ...failureLines(group.failures)]
  if (group.nudge !== undefined) sections.push('', group.nudge.text)
  const record = group.records[0]
  if (record === undefined) throw new Error('a quality entry needs a record')

  return {
    kind: EEntryKind.CodeQualityReviewed,
    author: EAuthor.Model,
    key: `quality:${record.callId}`,
    text: titleOf(group),
    body: sections.join('\n'),
    failed: group.findings.length === 0,
  }
}
