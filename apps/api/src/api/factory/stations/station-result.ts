const HEAD_SHA = /^[0-9a-f]{40}$/
const MAX_ENTRIES = 200
const MAX_FIELD_LENGTH = 20_000
const MAX_RESULT_BYTES = 100_000

export type StationChangeSummaryEntry = { path: string; change: string }
export type StationVerificationEntry = { command: string; result: string }

export type StationResultPayload = {
  branch: string
  base: string
  pushed: boolean
  head_sha: string
  change_summary: StationChangeSummaryEntry[]
  verification: StationVerificationEntry[]
  deviations: string[]
  known_limitations: string[]
}

export type StationResultParse =
  | { ok: true; result: StationResultPayload }
  | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const shortString = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= MAX_FIELD_LENGTH

const stringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= MAX_ENTRIES && value.every(shortString)

const entryArray = <T>(value: unknown, keys: readonly (keyof T)[]): value is T[] =>
  Array.isArray(value) &&
  value.length <= MAX_ENTRIES &&
  value.every((entry) => isRecord(entry) && keys.every((key) => shortString(entry[key as string])))

const fail = (error: string): StationResultParse => ({ ok: false, error })

/**
 * The station result contract, validated at the boundary: the orchestrator's prompt teaches this
 * exact shape and the transcript stores it verbatim, so anything off-shape is refused here rather
 * than rotting downstream readers.
 */
export function parseStationResult(raw: unknown): StationResultParse {
  if (!isRecord(raw)) return fail('the result must be a JSON object')

  const { branch, base, pushed, head_sha } = raw
  if (!shortString(branch)) return fail('result.branch must be a string')
  if (pushed === true && branch.length === 0) {
    return fail('result.branch must name the pushed branch when pushed is true')
  }
  if (!shortString(base) || base.length === 0) return fail('result.base must be a non-empty string')
  if (typeof pushed !== 'boolean') return fail('result.pushed must be a boolean')
  if (typeof head_sha !== 'string') return fail('result.head_sha must be a string')
  if (pushed && !HEAD_SHA.test(head_sha)) {
    return fail('result.head_sha must be the 40-character hex SHA of the pushed branch head')
  }
  if (!pushed && head_sha.length > 0) {
    return fail('result.head_sha must be empty when pushed is false')
  }

  if (!entryArray<StationChangeSummaryEntry>(raw.change_summary, ['path', 'change'])) {
    return fail('result.change_summary must be a list of { path, change } strings')
  }
  if (!entryArray<StationVerificationEntry>(raw.verification, ['command', 'result'])) {
    return fail('result.verification must be a list of { command, result } strings')
  }
  if (!stringArray(raw.deviations)) return fail('result.deviations must be a list of strings')
  if (!stringArray(raw.known_limitations)) {
    return fail('result.known_limitations must be a list of strings')
  }

  const result: StationResultPayload = {
    branch,
    base,
    pushed,
    head_sha,
    change_summary: raw.change_summary.map((entry) => ({ path: entry.path, change: entry.change })),
    verification: raw.verification.map((entry) => ({ command: entry.command, result: entry.result })),
    deviations: [...raw.deviations],
    known_limitations: [...raw.known_limitations],
  }
  const bytes = Buffer.byteLength(JSON.stringify(result), 'utf8')
  if (bytes > MAX_RESULT_BYTES) {
    return fail(
      `the result is ${bytes} bytes, over the ${MAX_RESULT_BYTES} cap — summarize and resubmit`,
    )
  }
  return { ok: true, result }
}
