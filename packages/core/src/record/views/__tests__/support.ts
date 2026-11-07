import fc from 'fast-check'

import { toAccountId } from '../../../credentials/account'
import { toCallId, toRunId, toThreadId } from '../../../events/ids'
import { ECompactionAnchor, type StepReading } from '../../../events/body'
import { ERunFailureKind } from '../../../events/run-failure'
import { EModelWaitCause, EWaitEpisodeKind } from '../../../model-recovery/waiting'
import { ERetryReason } from '../../../models/retry'
import { EFinishReason } from '../../../stream/chunk'
import { chainEvents } from '../../chain-events'
import { EInputConsumed, type V2Body, type V2Event } from '../../event'
import { EWorkspaceStep, EWorkspaceStepState } from '../../workspace'

export const NOW = '2026-11-03T12:00:00.000Z'
const NOW_MS = Date.parse(NOW)
const THREAD = toThreadId('t')
const RUN = toRunId('r')
const CALL = toCallId('c1')

const WORLD_KINDS = [
  'branches',
  'branches',
  'branches',
  'pr',
  'pr',
  'assistant-usage',
  'tool-called-usage',
] as const

const TURN_KINDS = [
  'user',
  'assistant-stop',
  'assistant-tools',
  'assistant-handoff',
  'assistant-usage',
  'tool-called-usage',
  'tool-called',
  'dispatched',
  'result',
  'denied',
  'run-failed',
  'dismissed',
  'retry',
  'wait-credential',
  'wait-control',
  'wait-cleared',
  'start-failed',
  'prepared',
  'prepare-failed',
  'workspace-step',
  'stop-consumed',
  'message-consumed',
  'fact',
] as const

const EDIT_KINDS = ['rewind', 'summarise'] as const

export type OpKind =
  | (typeof WORLD_KINDS)[number]
  | (typeof TURN_KINDS)[number]
  | (typeof EDIT_KINDS)[number]

export type Op = { kind: OpKind; a: number; b: number }

const opOf = (kinds: readonly OpKind[]): fc.Arbitrary<Op> =>
  fc.record({
    kind: fc.constantFrom(...kinds),
    a: fc.integer({ min: 0, max: 99 }),
    b: fc.integer({ min: 0, max: 99 }),
  })

export const opsWithoutEdits = fc.array(opOf([...TURN_KINDS, ...WORLD_KINDS]), { maxLength: 60 })

export const opsWithEdits = fc.array(opOf([...TURN_KINDS, ...WORLD_KINDS, ...EDIT_KINDS]), {
  maxLength: 60,
})

const readingOf = (op: Op): StepReading => ({
  inputTokens: op.a * 100 + 10,
  outputTokens: op.b * 10,
  ...(op.a % 2 === 0 ? { cacheReadTokens: op.a } : {}),
  ...(op.b % 3 === 0 ? { contextWindow: 100_000 + op.a } : {}),
  ...(op.a % 4 === 0
    ? { providerId: 'openai' }
    : op.a % 4 === 1
      ? { providerId: 'anthropic' }
      : {}),
  ...(op.b % 2 === 0 ? { modelId: 'gpt-5' } : {}),
})

const waiting = (kind: EWaitEpisodeKind): V2Body => ({
  type: 'model-waiting',
  waiting: {
    episode:
      kind === EWaitEpisodeKind.Credential
        ? {
            kind,
            key: { accountId: toAccountId('a'), providerId: 'openai', modelId: 'gpt-5' },
            generation: 1,
          }
        : { kind, code: 'down', providerId: 'openai', modelId: null },
    cause: EModelWaitCause.Availability,
    providerId: 'openai',
    accountId: 'a',
    modelId: null,
    reason: null,
    resetAt: null,
    affectedThreadIds: [THREAD],
  },
})

const branchesBody = (op: Op): V2Body => {
  const sha = (salt: number): string => `sha${(op.a + salt) % 3}`
  const branches = [
    { name: 'main', sha: sha(0) },
    { name: 'feat', sha: sha(op.b) },
    { name: 'x', sha: sha(1) },
  ].filter((_, index) => (op.b >> index) % 4 !== 3)
  const base = [undefined, null, 'main'][(op.a >> 1) % 3]
  return {
    type: 'branches-observed',
    repo: ['/work/a', '/work/b'][op.a % 2] as string,
    head: [null, 'main', 'feat', 'x'][op.b % 4] ?? null,
    ...(base === undefined ? {} : { base }),
    branches,
    worktrees:
      op.b % 5 === 0 ? [{ path: '/wt/feat', branch: 'feat', sha: sha(op.b), detached: false }] : [],
  }
}

const rewind = (op: Op, seq: number): V2Body => ({
  type: 'history-rewound',
  toSeq: Math.min(seq - 1, Math.floor((op.a * seq) / 100)),
})

const summarise = (op: Op, seq: number): V2Body => {
  const through = 1 + Math.floor((op.a * (seq - 1)) / 100)
  return {
    type: 'history-summarised',
    fromSeq: Math.min(through, 1 + Math.floor((op.b * through) / 100)),
    throughSeq: through,
    anchor: ECompactionAnchor.Prefix,
    summary: `summary ${op.a}`,
  }
}

const bodyOf = (op: Op, seq: number): V2Body => {
  switch (op.kind) {
    case 'user':
      return { type: 'user-said', text: `message ${op.a}` }
    case 'assistant-stop':
      return { type: 'assistant-said', parts: [], finish: EFinishReason.Stop }
    case 'assistant-tools':
      return { type: 'assistant-said', parts: [], finish: EFinishReason.ToolCalls }
    case 'assistant-handoff':
      return { type: 'assistant-said', parts: [], aborted: 'handoff' }
    case 'assistant-usage':
      return {
        type: 'assistant-said',
        parts: [],
        finish: op.a % 2 === 0 ? EFinishReason.ToolCalls : EFinishReason.Stop,
        usage: readingOf(op),
      }
    case 'tool-called-usage':
      return { type: 'tool-called', callId: CALL, name: 'bash', ordinal: 0, usage: readingOf(op) }
    case 'tool-called':
      return { type: 'tool-called', callId: CALL, name: 'bash', ordinal: 1 }
    case 'dispatched':
      return { type: 'tool-dispatched', callId: CALL, name: op.a % 2 === 0 ? 'bash' : 'read' }
    case 'result':
      return { type: 'tool-result', callId: CALL, name: 'bash', output: 'x'.repeat(op.a) }
    case 'denied':
      return { type: 'tool-denied', callId: CALL, name: 'bash', reason: 'no' }
    case 'run-failed':
      return { type: 'run-failed', failure: { kind: ERunFailureKind.Network, message: `f${op.a}` } }
    case 'dismissed':
      return { type: 'run-failure-dismissed', failureSeq: Math.max(1, seq - 1) }
    case 'retry':
      return {
        type: 'retry-scheduled',
        key: `retry:${seq}`,
        notBefore: new Date(NOW_MS + (op.a - 50) * 1000).toISOString(),
        attempt: 1,
        reason: ERetryReason.Network,
      }
    case 'wait-credential':
      return waiting(EWaitEpisodeKind.Credential)
    case 'wait-control':
      return waiting(EWaitEpisodeKind.ControlPlane)
    case 'wait-cleared':
      return {
        type: 'model-wait-cleared',
        episode: {
          kind: EWaitEpisodeKind.ControlPlane,
          code: 'down',
          providerId: 'openai',
          modelId: null,
        },
        cause: EModelWaitCause.Availability,
      }
    case 'start-failed':
      return { type: 'session-start-failed', reason: `s${op.a}`, inboxHead: 0, permanent: false }
    case 'prepared':
      return { type: 'workspace-prepared' }
    case 'prepare-failed':
      return { type: 'workspace-prepare-failed', reason: `p${op.a}`, inboxHead: 0 }
    case 'workspace-step':
      return {
        type: 'workspace-step',
        step: EWorkspaceStep.Clone,
        state: EWorkspaceStepState.Started,
      }
    case 'stop-consumed':
      return { type: 'input-consumed', inboxId: 1, consumed: EInputConsumed.Stop }
    case 'message-consumed':
      return { type: 'input-consumed', inboxId: 1, consumed: EInputConsumed.Message }
    case 'fact':
      return { type: 'fact-recorded', key: 'k', kind: 'note' }
    case 'branches':
      return branchesBody(op)
    case 'pr':
      return {
        type: 'pull-request-linked',
        number: (op.a % 3) + 1,
        url: `https://example.test/${op.b}`,
        repo: ['a/b', 'c/d'][op.a % 2] as string,
        branch: `br${op.b % 4}`,
      }
    case 'rewind':
      return seq < 2 ? { type: 'user-said', text: 'first' } : rewind(op, seq)
    case 'summarise':
      return seq < 2 ? { type: 'user-said', text: 'first' } : summarise(op, seq)
  }
}

export const eventsOf = (ops: readonly Op[]): V2Event[] => {
  const bodies: V2Body[] = []
  for (const op of ops) bodies.push(bodyOf(op, bodies.length + 1))
  return chainEvents({ threadId: THREAD, runId: RUN, epoch: 1, at: NOW, bodies })
}
