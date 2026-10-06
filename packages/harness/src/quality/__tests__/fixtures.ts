import {
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualitySkipReason,
  EQualityTransition,
  EToolEffect,
  JEV_QUALITY_MODEL,
  createQualityRegistry,
  stampDrafts,
  toCallId,
  toEventId,
  toRunId,
  toThreadId,
  type CapturedFileChange,
  type CodeQualityReviewedBody,
  type DecisionAnswer,
  type DecisionOutcome,
  type DecisionQuestion,
  type Event,
  type EventDraft,
  type QualityPolicy,
  type QualityScope,
  type ToolCall,
  type WorkspaceIdentityPort,
} from '@dltech/atlas-core'

import { CodeQualityReview } from '../engine'
import type { QualityExampleSink } from '../example-sink'
import type { QualitySourceAdapter } from '../review-scopes'

export const THREAD = toThreadId('thread-1')
export const RUN = toRunId('run-1')
export const PROJECT = '/repo'
export const FILE = '/repo/src/a.ts'

export const call: ToolCall = {
  callId: toCallId('call-1'),
  name: 'write',
  input: {},
  effect: EToolEffect.Write,
  threadId: THREAD,
}

export const change: CapturedFileChange = { path: FILE, before: 'old', after: 'new' }

export function scopeNamed(overrides: Partial<QualityScope> = {}): QualityScope {
  return {
    id: 'scope-1',
    workspaceNamespace: 'ns',
    path: FILE,
    language: EQualityLanguage.TypeScript,
    kind: EQualityScopeKind.Class,
    name: 'Widget',
    adapterVersion: 'ts-1',
    structuralHash: 'sh-1',
    parentScopeId: null,
    lineRange: { start: 1, end: 10 },
    before: 'class Widget {}',
    after: 'class Widget { run() {} }',
    diff: '+ run() {}',
    beforeHash: 'b1',
    afterHash: 'a1',
    evidence: [{ id: 'ev-1', label: 'run method', changed: true }],
    dependencyContext: [],
    beforeLineRange: null,
    afterLineRange: { start: 1, end: 10 },
    ...overrides,
  }
}

export function policyNamed({
  id = 'srp',
  version = '1',
  definitionBytes = 0,
  select,
  invalidConcern = false,
}: {
  id?: string
  version?: string
  definitionBytes?: number
  select?: (scopeIds: readonly string[]) => readonly string[]
  invalidConcern?: boolean
} = {}): QualityPolicy {
  return {
    id,
    version,
    title: `Policy ${id}`,
    description: 'a test policy',
    settingKey: `quality.policies.${id}`,
    defaultEnabled: true,
    definition: 'x'.repeat(definitionBytes),
    exceptions: [],
    selectScopes: ({ scopes }) => {
      const ids = scopes.map((scope) => scope.id)
      return select === undefined ? ids : select(ids)
    },
    questions: (): Record<string, DecisionQuestion> => ({
      concern: { type: 'noul', instructions: 'is there a concern' },
      impact: {
        type: 'choice',
        instructions: 'what changed',
        criteria: Object.fromEntries(Object.values(EQualityImpact).map((value) => [value, value])),
      },
    }),
    interpret: ({ scope, answers }) => {
      const concern = answers.concern?.noul ?? null
      const impact = answers.impact?.choice
      const introduces = concern !== null && concern >= 0.8 && (impact === EQualityImpact.Introduced || impact === EQualityImpact.Worsened)
      const resolves = concern !== null && concern <= 0.2 && impact === EQualityImpact.Resolved
      return {
        policyId: id,
        policyVersion: version,
        scopeId: scope.id,
        status: EQualityReviewStatus.Completed,
        impact: Object.values(EQualityImpact).find((value) => value === impact) ?? EQualityImpact.Uncertain,
        currentConcernProbability: invalidConcern ? 5 : concern,
        transition: introduces ? EQualityTransition.Introduce : resolves ? EQualityTransition.Resolve : EQualityTransition.None,
        evidenceIds: introduces ? ['ev-1', 'not-a-real-evidence-id'] : [],
        rawAnswers: answers,
      }
    },
    guidance: ({ scope }) => `consider whether ${scope.name} still does one thing`,
  }
}

export type Verdict = { concern: number; impact: EQualityImpact }

export const INTRODUCE: Verdict = { concern: 0.9, impact: EQualityImpact.Introduced }
export const RESOLVE: Verdict = { concern: 0.1, impact: EQualityImpact.Resolved }
export const IMPROVE: Verdict = { concern: 0.5, impact: EQualityImpact.Improved }

export function answersFor({ verdicts }: { verdicts: Readonly<Record<string, Verdict>> }): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {}
  for (const [policyId, verdict] of Object.entries(verdicts)) {
    answers[`${policyId}:concern`] = { noul: verdict.concern }
    answers[`${policyId}:impact`] = { choice: verdict.impact }
  }
  return answers
}

export const calibrated = ({ answers }: { answers: Record<string, DecisionAnswer> }): DecisionOutcome => ({
  ok: true,
  answers,
  model: JEV_QUALITY_MODEL,
})

export type DecideArgs = { state: string; questions: Record<string, DecisionQuestion>; signal: AbortSignal; model?: string | undefined }

export type RigOptions = {
  settings?: Record<string, unknown>
  policies?: readonly QualityPolicy[]
  scopes?: readonly QualityScope[]
  skipped?: ReturnType<QualitySourceAdapter['prepareQualityScopes']>['skipped']
  decide?: (args: DecideArgs) => Promise<DecisionOutcome>
  identify?: WorkspaceIdentityPort['identify']
  examples?: Pick<QualityExampleSink, 'record'>
  deadlineMs?: number
}

export function createRig(options: RigOptions = {}) {
  const policies = options.policies ?? [policyNamed()]
  const values: Record<string, unknown> = options.settings ?? { 'quality.enabled': true }
  const state = { scopes: options.scopes ?? [scopeNamed()] }
  const decisionCalls: DecideArgs[] = []
  const sourceCalls: Parameters<QualitySourceAdapter['prepareQualityScopes']>[0][] = []
  const identityCalls: Parameters<WorkspaceIdentityPort['identify']>[0][] = []
  const decide = options.decide ?? (async ({ questions }) => {
    const verdicts = Object.fromEntries(policies.map((policy) => [policy.id, INTRODUCE]))
    return calibrated({ answers: answersFor({ verdicts: Object.fromEntries(Object.entries(verdicts).filter(([id]) => `${id}:concern` in questions)) }) })
  })

  const engine = new CodeQualityReview({
    decisions: {
      decide: (args) => {
        decisionCalls.push(args)
        return decide(args)
      },
    },
    source: {
      prepareQualityScopes: (args) => {
        sourceCalls.push(args)
        const scopes = state.scopes.map((scope) => ({ ...scope, workspaceNamespace: args.workspaceNamespace }))
        return { scopes, skipped: options.skipped ?? [] }
      },
    },
    registry: createQualityRegistry({ policies }),
    settings: () => values,
    workspaceIdentity: {
      identify: (args) => {
        identityCalls.push(args)
        return (options.identify ?? (async () => ({ remote: 'git@host:org/repo.git', worktreePath: '.' })))(args)
      },
    },
    examples: options.examples,
    clock: monotonicClock(),
    deadlineMs: options.deadlineMs ?? 1000,
  })

  const review = (overrides: Partial<Parameters<CodeQualityReview['review']>[0]> = {}) =>
    engine.review({
      call,
      runId: RUN,
      changes: [change],
      captureFaults: [],
      events: [],
      projectDirectory: PROJECT,
      signal: new AbortController().signal,
      ...overrides,
    })

  return {
    engine,
    values,
    decisionCalls,
    sourceCalls,
    identityCalls,
    review,
    setScopes: (scopes: readonly QualityScope[]) => {
      state.scopes = scopes
    },
  }
}

export function monotonicClock(): () => number {
  let now = 0
  return () => (now += 5)
}

export function stampHistory({ batches }: { batches: readonly (readonly EventDraft[])[] }): Event[] {
  const drafts = batches.flat()
  const envelopes = drafts.map((_, index) => ({
    id: toEventId(`event-${index + 1}`),
    seq: index + 1,
    threadId: THREAD,
    runId: RUN,
    depth: 0,
    at: '2026-10-06T00:00:00.000Z',
  }))
  return stampDrafts({ drafts, envelopes })
}

export const recordsOf = (drafts: readonly EventDraft[]): CodeQualityReviewedBody[] =>
  drafts.filter((draft): draft is CodeQualityReviewedBody => draft.type === 'code-quality-reviewed')

export const nudgesOf = (drafts: readonly EventDraft[]): Extract<EventDraft, { type: 'nudge' }>[] =>
  drafts.filter((draft): draft is Extract<EventDraft, { type: 'nudge' }> => draft.type === 'nudge')

export const reasonOf = (record: CodeQualityReviewedBody | undefined): EQualitySkipReason | undefined => record?.reason
