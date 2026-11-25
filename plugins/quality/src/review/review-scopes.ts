import { isAbsolute, relative, resolve, sep } from 'node:path'

import {
  EQualityReviewStatus,
  EQualitySkipReason,
  QualityContractError,
  type CapturedFileChange,
  type CodeQualityReviewedBody,
  type QualityPolicy,
  type QualityScope,
  type QualityScopeIdentity,
  type QualityScopePreparation,
} from '@dltech/atlas-core'

import { prepareQualityRequest, type QualityDecisionRequest } from './request'
import { excerptOf } from './source/scope-excerpt'

export const JEV_DEFAULT_QUESTION_TOKENS = 32_000
export const JEV_DEFAULT_REQUEST_TOKENS = 64_000
export const JEV_LONG_CONTEXT_TOKENS = 262_144
export const CONSERVATIVE_BYTES_PER_TOKEN = 2.4

const TOKEN_HEADROOM = 0.05

const bytesForTokens = (tokens: number): number =>
  Math.floor(tokens * (1 - TOKEN_HEADROOM) * CONSERVATIVE_BYTES_PER_TOKEN)

const MAX_STATE_AND_LONGEST_QUESTION_DEFAULT_BYTES = bytesForTokens(JEV_DEFAULT_QUESTION_TOKENS)
const MAX_STATE_AND_ALL_QUESTIONS_DEFAULT_BYTES = bytesForTokens(JEV_DEFAULT_REQUEST_TOKENS)

export const MAX_STATE_AND_LONGEST_QUESTION_BYTES = bytesForTokens(JEV_LONG_CONTEXT_TOKENS)
export const MAX_STATE_AND_ALL_QUESTIONS_BYTES = bytesForTokens(JEV_LONG_CONTEXT_TOKENS)

export type QualitySourceAdapter = {
  prepareQualityScopes(args: {
    change: CapturedFileChange
    projectDirectory: string
    workspaceNamespace: string
    previousScopes: readonly QualityScopeIdentity[]
  }): QualityScopePreparation
}

export type ScopeSelection = { scope: QualityScope; policies: readonly QualityPolicy[] }

export type SelectionFault = { scope: QualityScope | undefined; detail: string }

export type RequestUnit = {
  policies: readonly QualityPolicy[]
  request: QualityDecisionRequest
  longContext: boolean
}

export type RejectedRequest = {
  status: EQualityReviewStatus
  reason: EQualitySkipReason | undefined
  detail: string
}

export type RequestPlan = { units: readonly RequestUnit[]; rejected: readonly RejectedRequest[] }

export function normalizeWorkspacePath({
  projectDirectory,
  path,
}: {
  projectDirectory: string
  path: string
}): string | null {
  const relativePath = relative(projectDirectory, resolve(projectDirectory, path))
  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${sep}`))
    return null
  if (isAbsolute(relativePath)) return null
  return relativePath.split(sep).join('/')
}

export function previousScopesOf({
  records,
  path,
  workspaceNamespace,
}: {
  records: readonly CodeQualityReviewedBody[]
  path: string
  workspaceNamespace: string
}): readonly QualityScopeIdentity[] {
  const latest = new Map<string, QualityScopeIdentity>()
  for (const record of records) {
    if (record.scope === undefined) continue
    if (record.path !== path || record.workspaceNamespace !== workspaceNamespace) continue
    latest.set(record.scope.id, record.scope)
  }
  return [...latest.values()]
}

export function selectPolicyScopes({
  policies,
  scopes,
}: {
  policies: readonly QualityPolicy[]
  scopes: readonly QualityScope[]
}): { selections: readonly ScopeSelection[]; faults: readonly SelectionFault[] } {
  const byId = new Map(scopes.map((scope) => [scope.id, scope]))
  const chosen = new Map<string, QualityPolicy[]>()
  const duplicated = new Map<string, SelectionFault>()
  const faults: SelectionFault[] = []

  for (const policy of policies) {
    let selected: readonly string[]
    try {
      selected = policy.selectScopes({ scopes })
    } catch (error) {
      faults.push({
        scope: undefined,
        detail: `policy "${policy.id}" selectScopes threw: ${error instanceof Error ? error.message : String(error)}`,
      })
      continue
    }
    const seen = new Set<string>()
    for (const id of selected) {
      const scope = byId.get(id)
      if (scope === undefined) {
        faults.push({
          scope: undefined,
          detail: `policy "${policy.id}" selected unknown scope id "${id}"`,
        })
        continue
      }
      if (seen.has(id)) {
        duplicated.set(`${policy.id}${id}`, {
          scope,
          detail: `policy "${policy.id}" selected scope "${id}" more than once`,
        })
        continue
      }
      seen.add(id)
      chosen.set(id, [...(chosen.get(id) ?? []), policy])
    }
  }

  const selections = scopes
    .filter((scope) =>
      (chosen.get(scope.id) ?? []).some((policy) => !duplicated.has(`${policy.id}${scope.id}`)),
    )
    .map((scope) => ({
      scope,
      policies: (chosen.get(scope.id) ?? []).filter(
        (policy) => !duplicated.has(`${policy.id}${scope.id}`),
      ),
    }))
  return { selections, faults: [...faults, ...duplicated.values()] }
}

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

type RequestSize = { state: number; longest: number; total: number }

type RequestFit = 'default' | 'long' | 'over'

function sizeOf({ request }: { request: QualityDecisionRequest }): RequestSize {
  const sizes = Object.values(request.questions).map((question) =>
    byteLength(JSON.stringify(question)),
  )
  return {
    state: byteLength(request.state),
    longest: sizes.reduce((max, size) => Math.max(max, size), 0),
    total: sizes.reduce((sum, size) => sum + size, 0),
  }
}

function fitOf({ request }: { request: QualityDecisionRequest }): RequestFit {
  const size = sizeOf({ request })
  const longest = size.state + size.longest
  const all = size.state + size.total
  if (
    longest <= MAX_STATE_AND_LONGEST_QUESTION_DEFAULT_BYTES &&
    all <= MAX_STATE_AND_ALL_QUESTIONS_DEFAULT_BYTES
  )
    return 'default'
  if (longest <= MAX_STATE_AND_LONGEST_QUESTION_BYTES && all <= MAX_STATE_AND_ALL_QUESTIONS_BYTES)
    return 'long'
  return 'over'
}

const estimateTokens = (bytes: number): number => Math.ceil(bytes / CONSERVATIVE_BYTES_PER_TOKEN)

const describeSize = (size: RequestSize): string => {
  const longest = size.state + size.longest
  const all = size.state + size.total
  return `state ${size.state} + longest question ${size.longest} + all questions ${size.total} bytes (about ${estimateTokens(longest)} tokens with the longest question, ${estimateTokens(all)} with all of them)`
}

function unitOf({
  request,
  policies,
}: {
  request: QualityDecisionRequest
  policies: readonly QualityPolicy[]
}): RequestUnit | undefined {
  const fit = fitOf({ request })
  return fit === 'over' ? undefined : { policies, request, longContext: fit === 'long' }
}

function tryRequest({
  scope,
  policies,
}: {
  scope: QualityScope
  policies: readonly QualityPolicy[]
}): { unit: RequestUnit } | { rejected: RejectedRequest } {
  try {
    const request = prepareQualityRequest({ scope, policies })
    const full = unitOf({ request, policies })
    if (full !== undefined) return { unit: full }
    const excerpted = excerptOf({ scope })
    const excerpt = prepareQualityRequest({
      scope: excerpted.scope,
      policies,
      excerpt: excerpted.excerpt,
    })
    const reduced = unitOf({ request: excerpt, policies })
    if (reduced !== undefined) return { unit: reduced }
    return {
      rejected: {
        status: EQualityReviewStatus.Skipped,
        reason: EQualitySkipReason.OversizedRequest,
        detail: `request for ${policies.map((policy) => policy.id).join(', ')} exceeds the classifier limit: ${describeSize(sizeOf({ request }))} full, ${describeSize(sizeOf({ request: excerpt }))} excerpted`,
      },
    }
  } catch (error) {
    if (!(error instanceof QualityContractError)) throw error
    return {
      rejected: {
        status: EQualityReviewStatus.OperationalError,
        reason: undefined,
        detail: error.message,
      },
    }
  }
}

export function planRequests({
  scope,
  policies,
}: {
  scope: QualityScope
  policies: readonly QualityPolicy[]
}): RequestPlan {
  if (policies.length > 1) {
    const shared = tryRequest({ scope, policies })
    if ('unit' in shared) return { units: [shared.unit], rejected: [] }
  }

  const units: RequestUnit[] = []
  const rejected: RejectedRequest[] = []
  for (const policy of policies) {
    const attempt = tryRequest({ scope, policies: [policy] })
    if ('unit' in attempt) units.push(attempt.unit)
    else rejected.push(attempt.rejected)
  }
  return { units, rejected }
}
