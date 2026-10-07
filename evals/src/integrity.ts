import { z } from 'zod'

export enum EIntegrityProblem {
  MissingArtifact = 'missing_artifact',
  StaleArtifact = 'stale_artifact',
  InvalidSchema = 'invalid_schema',
  DuplicateRow = 'duplicate_row',
  MissingRow = 'missing_row',
  ExtraRow = 'extra_row',
  InvalidScore = 'invalid_score',
  IncompleteStatus = 'incomplete_status',
  OnlyFiltered = 'only_filtered',
}

export type IntegrityProblem = { kind: EIntegrityProblem; detail: string }

export type IntegrityReport = { ok: boolean; problems: readonly IntegrityProblem[] }

export type PlannedRow = { caseId: string; trialId: string }

const rawExportSchema = z.object({
  run: z.object({
    id: z.unknown(),
    runType: z.string(),
    createdAt: z.string(),
  }),
  evals: z.array(
    z.object({
      name: z.string(),
      status: z.string().optional(),
      results: z.array(
        z.object({
          input: z.unknown(),
          output: z.unknown(),
          expected: z.unknown().optional(),
          scores: z.array(z.object({ name: z.string(), score: z.unknown() })),
          status: z.string(),
        }),
      ),
    }),
  ),
})

export type RawExportShape = z.infer<typeof rawExportSchema>

const ACCEPTED_RESULT_STATUSES: readonly string[] = ['success', 'fail']

export function safeJsonParse({ text }: { text: string }): unknown | undefined {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const identityKey = ({ caseId, trialId }: PlannedRow): string => JSON.stringify([caseId, trialId])

const describeIdentity = ({ caseId, trialId }: PlannedRow): string => `${caseId}/${trialId}`

const readIdentity = ({ input }: { input: unknown }): PlannedRow | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const caseId: unknown = Reflect.get(input, 'caseId')
  const trialId: unknown = Reflect.get(input, 'trialId')
  if (typeof caseId !== 'string' || typeof trialId !== 'string') return undefined
  return { caseId, trialId }
}

const isStartedAfter = ({ startedAt, startedAfter }: { startedAt: string; startedAfter: string }): boolean => {
  const startedMs = Date.parse(startedAt)
  const afterMs = Date.parse(startedAfter)
  if (Number.isFinite(startedMs) && Number.isFinite(afterMs)) return startedMs >= afterMs
  return startedAt >= startedAfter
}

const checkRowIdentities = ({
  results,
  plannedRows,
}: {
  results: readonly { input: unknown }[]
  plannedRows: readonly PlannedRow[]
}): IntegrityProblem[] => {
  const problems: IntegrityProblem[] = []
  const plannedKeys = new Set(plannedRows.map(identityKey))
  const seenCounts = new Map<string, number>()
  const unreadable: number[] = []
  const unknown = new Set<string>()
  results.forEach((result, index) => {
    const identity = readIdentity({ input: result.input })
    if (identity === undefined) {
      unreadable.push(index)
      return
    }
    const key = identityKey(identity)
    seenCounts.set(key, (seenCounts.get(key) ?? 0) + 1)
    if (!plannedKeys.has(key)) unknown.add(describeIdentity(identity))
  })
  for (const index of unreadable) {
    problems.push({ kind: EIntegrityProblem.ExtraRow, detail: `result ${index} has no caseId/trialId input envelope` })
  }
  for (const identity of unknown) {
    problems.push({ kind: EIntegrityProblem.ExtraRow, detail: `unplanned row ${identity}` })
  }
  for (const planned of plannedRows) {
    const count = seenCounts.get(identityKey(planned)) ?? 0
    if (count === 0) problems.push({ kind: EIntegrityProblem.MissingRow, detail: `missing row ${describeIdentity(planned)}` })
    if (count > 1) {
      problems.push({ kind: EIntegrityProblem.DuplicateRow, detail: `row ${describeIdentity(planned)} appears ${count} times` })
    }
  }
  return problems
}

const checkResultFields = ({ results }: { results: RawExportShape['evals'][number]['results'] }): IntegrityProblem[] => {
  const problems: IntegrityProblem[] = []
  results.forEach((result, index) => {
    for (const entry of result.scores) {
      const valid = typeof entry.score === 'number' && Number.isFinite(entry.score)
      if (valid) continue
      problems.push({
        kind: EIntegrityProblem.InvalidScore,
        detail: `result ${index} score "${entry.name}" is not a finite number`,
      })
    }
    if (!ACCEPTED_RESULT_STATUSES.includes(result.status)) {
      problems.push({
        kind: EIntegrityProblem.IncompleteStatus,
        detail: `result ${index} has status "${result.status}"`,
      })
    }
  })
  return problems
}

export function validateRawExport({
  parsed,
  startedAfter,
  plannedRows,
}: {
  parsed: unknown
  startedAfter: string
  plannedRows: readonly PlannedRow[]
}): IntegrityReport {
  const schemaResult = rawExportSchema.safeParse(parsed)
  if (!schemaResult.success) {
    const detail = schemaResult.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    return { ok: false, problems: [{ kind: EIntegrityProblem.InvalidSchema, detail }] }
  }
  const { run, evals } = schemaResult.data
  const results = evals.flatMap((evaluation) => evaluation.results)
  const problems: IntegrityProblem[] = []
  if (!isStartedAfter({ startedAt: run.createdAt, startedAfter })) {
    problems.push({
      kind: EIntegrityProblem.StaleArtifact,
      detail: `run created ${run.createdAt}, before ${startedAfter}`,
    })
  }
  if (run.runType !== 'full') {
    problems.push({ kind: EIntegrityProblem.OnlyFiltered, detail: `run type is "${run.runType}", expected "full"` })
  }
  problems.push(...checkRowIdentities({ results, plannedRows }))
  problems.push(...checkResultFields({ results }))
  return { ok: problems.length === 0, problems }
}
