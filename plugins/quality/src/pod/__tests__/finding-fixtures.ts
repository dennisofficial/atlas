import {
  EQualityFindingState,
  EQualityImpact,
  EQualityLanguage,
  EQualityReviewStatus,
  EQualityScopeKind,
  EQualityTransition,
  ETurnCause,
  toEventId,
  toRunId,
  type CodeQualityReviewedBody,
  type Hash,
  type QualityScopeIdentity,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { CALL, PROJECT, THREAD } from './support'

const HASH = 'a'.repeat(64) as Hash

export const eventsOf = (bodies: readonly RecordEventBody[]): readonly RecordEvent[] =>
  bodies.map(
    (body, index) =>
      ({
        ...body,
        id: toEventId(`event-${index + 1}`),
        seq: index + 1,
        threadId: THREAD,
        runId: toRunId('run-1'),
        depth: 0,
        at: '2026-11-23T00:00:00.000Z',
        epoch: 1,
        prevHash: HASH,
      }) as RecordEvent,
  )

const SCOPE: QualityScopeIdentity = {
  id: 'scope-1',
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  language: EQualityLanguage.TypeScript,
  kind: EQualityScopeKind.Class,
  name: 'Widget',
  adapterVersion: 'ts-1',
  structuralHash: 'sh-1',
  parentScopeId: null,
  lineRange: null,
}

export const reviewed = (args: {
  state: EQualityFindingState
  notified: boolean
  transition: EQualityTransition
}): CodeQualityReviewedBody => ({
  type: 'code-quality-reviewed',
  callId: CALL,
  workspaceNamespace: PROJECT,
  path: 'src/widget.ts',
  scope: SCOPE,
  beforeHash: null,
  afterHash: 'a1',
  status: EQualityReviewStatus.Completed,
  assessments: [
    {
      policyId: 'single-responsibility',
      policyVersion: '1',
      scopeId: 'scope-1',
      status: EQualityReviewStatus.Completed,
      impact: EQualityImpact.Introduced,
      currentConcernProbability: 0.9,
      transition: args.transition,
      evidenceIds: [],
      rawAnswers: {},
    },
  ],
  findings: [
    {
      id: 'single-responsibility:scope-1:1',
      policyId: 'single-responsibility',
      scopeId: 'scope-1',
      episode: 1,
      state: args.state,
      notified: args.notified,
      lastAfterHash: 'a1',
      policyVersion: '1',
    },
  ],
  durationMs: 5,
})

export const said: RecordEventBody = {
  type: 'assistant-said',
  parts: [{ type: 'text', text: 'done' }],
}
export const turnStarted: RecordEventBody = {
  type: 'turn-started',
  turnId: 'turn-1',
  cause: ETurnCause.Input,
}

export const notified = (): CodeQualityReviewedBody =>
  reviewed({
    state: EQualityFindingState.Active,
    notified: true,
    transition: EQualityTransition.Introduce,
  })

export const resolved = (): CodeQualityReviewedBody =>
  reviewed({
    state: EQualityFindingState.Resolved,
    notified: true,
    transition: EQualityTransition.Resolve,
  })

export const briefSaid: RecordEventBody = { type: 'user-said', text: 'build it', inboxId: 1 }
export const wakeConsumed: RecordEventBody = { type: 'input-consumed', inboxId: 2 }
