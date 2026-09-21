import { EReviewVerdict } from './station.types'

const MAX_ENTRIES = 200
const MAX_FIELD_LENGTH = 20_000
const MAX_VERDICT_BYTES = 100_000
const HEAD_SHA = /^[0-9a-f]{40}$/

export enum EFindingSeverity {
  Blocker = 'blocker',
  ShouldFix = 'should-fix',
  Note = 'note',
}

export type ReviewCriterion = { criterion: string; pass: boolean; note: string }
export type ReviewFinding = { severity: EFindingSeverity; path: string; summary: string }

export type ReviewVerdictPayload = {
  verdict: EReviewVerdict
  head_sha: string
  summary: string
  criteria: ReviewCriterion[]
  findings: ReviewFinding[]
}

export type ReviewVerdictParse =
  | { ok: true; verdict: ReviewVerdictPayload }
  | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_FIELD_LENGTH

const fail = (error: string): ReviewVerdictParse => ({ ok: false, error })

const isCriterion = (value: unknown): value is ReviewCriterion =>
  isRecord(value) &&
  shortString(value.criterion) &&
  value.criterion.length > 0 &&
  typeof value.pass === 'boolean' &&
  shortString(value.note)

const isFinding = (value: unknown): value is ReviewFinding =>
  isRecord(value) &&
  (value.severity === EFindingSeverity.Blocker ||
    value.severity === EFindingSeverity.ShouldFix ||
    value.severity === EFindingSeverity.Note) &&
  shortString(value.path) &&
  shortString(value.summary) &&
  value.summary.length > 0

/**
 * The reviewer station's verdict contract — a sibling of the implementer result, validated at the
 * same boundary and stored verbatim on the transcript.
 */
export function parseReviewVerdict(raw: unknown): ReviewVerdictParse {
  if (!isRecord(raw)) return fail('the verdict must be a JSON object')

  const verdictValue = raw.verdict
  if (verdictValue !== EReviewVerdict.Approve && verdictValue !== EReviewVerdict.RequestChanges) {
    return fail('verdict.verdict must be "approve" or "request_changes"')
  }
  if (!shortString(raw.summary) || raw.summary.length === 0) {
    return fail('verdict.summary must be a non-empty string')
  }
  if (typeof raw.head_sha !== 'string' || !HEAD_SHA.test(raw.head_sha)) {
    return fail('verdict.head_sha must be the 40-character hex SHA of the head you reviewed')
  }
  if (!Array.isArray(raw.criteria) || raw.criteria.length > MAX_ENTRIES) {
    return fail('verdict.criteria must be a list')
  }
  const criteria: ReviewCriterion[] = []
  for (const entry of raw.criteria) {
    if (!isCriterion(entry)) {
      return fail('every criterion needs a criterion string, a pass boolean, and a note string')
    }
    criteria.push({ criterion: entry.criterion, pass: entry.pass, note: entry.note })
  }
  if (!Array.isArray(raw.findings) || raw.findings.length > MAX_ENTRIES) {
    return fail('verdict.findings must be a list')
  }
  const findings: ReviewFinding[] = []
  for (const entry of raw.findings) {
    if (!isFinding(entry)) {
      return fail('every finding needs a blocker/should-fix/note severity, a path, and a summary')
    }
    findings.push({ severity: entry.severity, path: entry.path, summary: entry.summary })
  }
  if (verdictValue === EReviewVerdict.RequestChanges && findings.length === 0) {
    return fail('a request_changes verdict needs at least one finding to act on')
  }

  const verdictKind =
    verdictValue === EReviewVerdict.Approve ? EReviewVerdict.Approve : EReviewVerdict.RequestChanges
  const verdict: ReviewVerdictPayload = {
    verdict: verdictKind,
    head_sha: raw.head_sha,
    summary: raw.summary,
    criteria,
    findings,
  }
  const bytes = Buffer.byteLength(JSON.stringify(verdict), 'utf8')
  if (bytes > MAX_VERDICT_BYTES) {
    return fail(`the verdict is ${bytes} bytes, over the ${MAX_VERDICT_BYTES} cap — summarize and resubmit`)
  }
  return { ok: true, verdict }
}
