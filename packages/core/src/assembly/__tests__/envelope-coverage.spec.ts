import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../agents/restart'
import { EModelFallbackReason } from '../../events/agent-body'
import { EAgentStart } from '../../agents/start'
import { EAgentStatus } from '../../agents/status'
import { EReportKind } from '../../agents/report'
import { ELane } from '../../context/envelope'
import { EContextSlot } from '../../context/slot'
import {
  ECompactionAnchor,
  EDecision,
  ELocationChangeCause,
  EMessageOrigin,
  EOperatorInputOutcome,
  EPrEventKind,
  EPrVerdict,
  EWorktreeExit,
  type EventDraft,
  type EventType,
} from '../../events/body'
import { toCallId, toEventId, toThreadId } from '../../events/ids'
import { CORE_EVENT_TYPES } from '../../events/schema'
import { ERunFailureKind } from '../../events/run-failure'
import { EExecutionLocation } from '../../execution/location'
import { EModelWaitCause, EWaitEpisodeKind } from '../../model-recovery/waiting'
import { EClassifierMode, ETriage } from '../../policy/classifier/triage'
import { ERiskDimension } from '../../policy/classifier/dimension'
import { EGrantScope } from '../../policy/classifier/grant'
import { EJudgment } from '../../policy/classifier/verdict'
import { EQualityReviewStatus } from '../../quality/policy'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import {
  ESubscriptionActor,
  ESubscriptionEnd,
  ESubscriptionStatus,
} from '../../subscriptions/subscription'
import { assemble } from '../assemble'
import { defaultRules } from '../pipeline'
import { EMPTY_PROMPT } from '../rules/system-prompt'
import { contextFor, log } from './log-fixture'

const PROJECT_DIRECTORY = '/w'

const RESERVED_TAGS: readonly string[] = Object.values(ELane)

const CHILD = toThreadId('thread-child')
const CALL = toCallId('call-1')

type SampleOf<K extends EventType> = Extract<EventDraft, { type: K }>

const SAMPLE_ARGS = {
  provider: { id: 'fixture', modelId: 'fixture-model' },
  waiting: {
    episode: {
      kind: EWaitEpisodeKind.ControlPlane,
      code: 'outage',
      providerId: 'fixture',
      modelId: null,
    } as const,
    cause: EModelWaitCause.ControlPlane,
    providerId: 'fixture',
    accountId: null,
    modelId: null,
    reason: null,
    resetAt: null,
    affectedThreadIds: [],
  },
}

/**
 * One sample per core event type. Typed over `EventType`, so a new event type does not compile
 * until it is given a sample here — and everything it renders then has to pass the envelope check
 * below.
 */
const SAMPLES: { readonly [K in EventType]: SampleOf<K> } = {
  'user-said': { type: 'user-said', text: 'run the suite' },
  'assistant-said': { type: 'assistant-said', parts: [{ type: 'text', text: 'on it' }] },
  'tool-called': {
    type: 'tool-called',
    callId: CALL,
    name: 'read',
    input: { path: 'a' },
    ordinal: 0,
  },
  'tool-dispatched': { type: 'tool-dispatched', callId: CALL, name: 'read' },
  'tool-parked': { type: 'tool-parked', callId: CALL, name: 'read' },
  'tool-result': { type: 'tool-result', callId: CALL, name: 'read', output: 'ok', modelText: 'ok' },
  'tool-denied': { type: 'tool-denied', callId: CALL, name: 'read', reason: 'nope' },
  'approval-requested': { type: 'approval-requested', callId: CALL, reason: 'destructive' },
  'approval-answered': { type: 'approval-answered', callId: CALL, decision: EDecision.Allow },
  'context-loaded': {
    type: 'context-loaded',
    slot: EContextSlot.ProjectInstructions,
    key: '/w/CLAUDE.md',
    content: 'be brief',
  },
  nudge: { type: 'nudge', text: 'keep going', lifetimeSteps: 3 },
  'sandbox-setup-reported': { type: 'sandbox-setup-reported', text: 'installed', failed: false },
  'turn-failed': { type: 'turn-failed', message: 'provider said no' },
  'loop-watch-verdict': { type: 'loop-watch-verdict', consulted: true, looping: true, steps: 4 },
  'worktree-entered': { type: 'worktree-entered', path: '/w/tree', branch: 'dennis/envelope' },
  'worktree-exited': { type: 'worktree-exited', path: '/w/tree', action: EWorktreeExit.Keep },
  'location-changed': {
    type: 'location-changed',
    from: EExecutionLocation.Host,
    to: EExecutionLocation.Cloud,
    cause: ELocationChangeCause.SandboxExpired,
  },
  rotated: { type: 'rotated', predecessor: toThreadId('thread-old'), handoffPath: '/w/HANDOFF.md' },
  parked: {
    type: 'parked',
    reason: 'idle',
    turnRunning: false,
    childrenRunning: 0,
    shellsRunning: 0,
    servicesRunning: 0,
    clientsAttached: 0,
  },
  'operator-input-requested': {
    type: 'operator-input-requested',
    requestId: 'req-1',
    description: 'login',
    path: '/w/req',
  },
  'operator-input-resolved': {
    type: 'operator-input-resolved',
    requestId: 'req-1',
    outcome: EOperatorInputOutcome.Delivered,
  },
  'directory-changed': { type: 'directory-changed', path: '/w/next' },
  'checkout-observed': { type: 'checkout-observed', path: '/w', branch: 'main', detached: false },
  'history-compacted': {
    type: 'history-compacted',
    anchor: ECompactionAnchor.Prefix,
    fromSeq: 1,
    throughSeq: 9,
    summary: 'earlier work',
    replaced: 9,
  },
  'permission-revoked': { type: 'permission-revoked', grantId: 'grant-1' },
  'tldr-written': {
    type: 'tldr-written',
    anchorSeq: 1,
    throughSeq: 9,
    text: 'summary',
    modelId: 'fixture-model',
  },
  'agent-spawned': {
    type: 'agent-spawned',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'find the callers',
    mode: EAgentStart.Fresh,
  },
  'agent-ended': {
    type: 'agent-ended',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'find the callers',
    status: EAgentStatus.Finished,
    prose: 'done',
    turns: 2,
    toolCalls: 5,
  },
  'agent-restarted': {
    type: 'agent-restarted',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'find the callers',
    via: EAgentRestart.Message,
  },
  'agent-reported': {
    type: 'agent-reported',
    agentId: CHILD,
    agentType: 'explore',
    intent: 'find the callers',
    prose: 'three callers',
    kind: EReportKind.Done,
  },
  'model-fell-back': {
    type: 'model-fell-back',
    role: 'main',
    from: { ref: 'a', label: 'A' },
    to: { ref: 'b', label: 'B' },
    reason: EModelFallbackReason.ProviderNotConnected,
  },
  'background-shell-started': {
    type: 'background-shell-started',
    shellId: 'shell-1',
    command: 'bun test',
  },
  'background-shell-ended': {
    type: 'background-shell-ended',
    shellId: 'shell-1',
    command: 'bun test',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: 'green',
    droppedCharacters: 0,
    remainingCharacters: 0,
  },
  'background-shell-awaiting-input': {
    type: 'background-shell-awaiting-input',
    shellId: 'shell-1',
    command: 'bun dev',
    output: 'password:',
    droppedCharacters: 0,
    remainingCharacters: 0,
  },
  'background-shell-matched': {
    type: 'background-shell-matched',
    shellId: 'shell-1',
    command: 'bun dev',
    pattern: 'ready',
    lines: 'ready',
    matchCount: 1,
  },
  'background-shell-still-running': {
    type: 'background-shell-still-running',
    shellId: 'shell-1',
    command: 'bun test',
    runningForMs: 60000,
    silentForMs: 60000,
    checkInMs: 60000,
    tail: 'running',
  },
  'service-started': { type: 'service-started', serviceId: 'svc-1', command: 'bun dev' },
  'service-ended': {
    type: 'service-ended',
    serviceId: 'svc-1',
    command: 'bun dev',
    status: EServiceStatus.Exited,
    tail: 'done',
  },
  'classifier-judged': {
    type: 'classifier-judged',
    callId: CALL,
    mode: EClassifierMode.Nudge,
    triage: ETriage.Clear,
    judgment: EJudgment.Proceed,
    dimensions: [ERiskDimension.Irreversibility],
    signalIds: [],
    consulted: true,
    reason: 'reads only',
    elapsedMs: 12,
  },
  'permission-granted': {
    type: 'permission-granted',
    grantId: 'grant-1',
    dimensions: [ERiskDimension.Irreversibility],
    scope: EGrantScope.Thread,
    subject: 'bun test',
    reason: 'operator allowed it',
  },
  'subscription-created': {
    type: 'subscription-created',
    subscriptionId: 'sub-1',
    provider: 'github.pull-request',
    target: { number: 7 },
    label: 'PR #7',
    createdBy: ESubscriptionActor.Operator,
  },
  'subscription-changed': {
    type: 'subscription-changed',
    subscriptionId: 'sub-1',
    status: ESubscriptionStatus.Active,
    by: ESubscriptionActor.Operator,
  },
  'subscription-ended': {
    type: 'subscription-ended',
    subscriptionId: 'sub-1',
    reason: ESubscriptionEnd.Unsubscribed,
    by: ESubscriptionActor.Operator,
  },
  'pull-request-linked': {
    type: 'pull-request-linked',
    number: 12,
    url: 'https://example.com/pull/12',
    repo: 'github.com/owner/repo',
    branch: 'dennis/envelope',
  },
  'pr-event': {
    type: 'pr-event',
    repo: 'github.com/owner/repo',
    prNumber: 12,
    kind: EPrEventKind.Verdict,
    url: 'https://example.com/pull/12',
    verdict: EPrVerdict.Green,
  },
  'run-event': {
    type: 'run-event',
    repo: 'github.com/owner/repo',
    workflowRunId: 7,
    workflow: 'ci',
    branch: 'main',
    url: 'https://example.com/run/7',
    status: 'completed',
    conclusion: 'success',
  },
  'diagram-repaired': {
    type: 'diagram-repaired',
    messageId: toEventId('event-1'),
    original: 'a',
    repaired: 'b',
    modelId: 'fixture-model',
  },
  'code-quality-reviewed': {
    type: 'code-quality-reviewed',
    callId: CALL,
    workspaceNamespace: '/w',
    path: 'a.ts',
    beforeHash: null,
    afterHash: 'h',
    status: EQualityReviewStatus.Completed,
    assessments: [],
    findings: [],
    durationMs: 10,
  },
  'run-failed': {
    type: 'run-failed',
    failure: { kind: ERunFailureKind.Other, message: 'went wrong' },
  },
  'run-failure-dismissed': { type: 'run-failure-dismissed', failureSeq: 3 },
  'model-waiting': { type: 'model-waiting', waiting: SAMPLE_ARGS.waiting },
  'model-wait-cleared': {
    type: 'model-wait-cleared',
    episode: SAMPLE_ARGS.waiting.episode,
    cause: EModelWaitCause.ControlPlane,
  },
}

const userTextsOf = (drafts: readonly EventDraft[]): readonly string[] => {
  const { assembled } = assemble({
    rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
    ctx: contextFor({ events: log(drafts) }),
  })

  return assembled.messages
    .flatMap((entry) => (entry.message.role === 'user' ? entry.message.content : []))
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
}

const startsWithReservedTag = (text: string): boolean =>
  RESERVED_TAGS.some((tag) => text.startsWith(`<${tag}`))

const unenveloped = (drafts: readonly EventDraft[]): readonly string[] =>
  userTextsOf(drafts).filter((text) => !startsWithReservedTag(text))

describe('every core event type renders its model-visible text through an envelope', () => {
  it('has a sample for every core event type', () => {
    // The mapped type pins this at compile time; the runtime check catches a type that drifted.
    expect(Object.keys(SAMPLES).sort()).toEqual([...CORE_EVENT_TYPES].sort())
  })

  const offenders = Object.entries(SAMPLES).flatMap(([type, draft]) =>
    unenveloped([draft]).map((text) => `${type}: ${text.slice(0, 120)}`),
  )

  it('opens every user message part with a reserved tag, type by type', () => {
    expect(offenders).toEqual([])
  })

  // `history-compacted` and `rotated` cut the log, so they are checked one at a time above.
  const COMBINED: readonly EventDraft[] = Object.entries(SAMPLES)
    .filter(([type]) => type !== 'history-compacted' && type !== 'rotated')
    .map(([, draft]) => draft)

  it('opens every part of a combined log with a reserved tag', () => {
    expect(userTextsOf(COMBINED).length).toBeGreaterThan(15)
    expect(unenveloped(COMBINED)).toEqual([])
  })

  it('keeps assistant text bare, because the model wrote it', () => {
    const { assembled } = assemble({
      rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory: PROJECT_DIRECTORY }),
      ctx: contextFor({ events: log([SAMPLES['assistant-said']]) }),
    })

    const assistant = assembled.messages
      .flatMap((entry) => (entry.message.role === 'assistant' ? entry.message.content : []))
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))

    expect(assistant).toContain('on it')
  })

  it('renders nothing that a client-side lane has to explain away', () => {
    // A conversation the operator and a sub-agent both spoke into names its speakers in the lane.
    const texts = userTextsOf([
      { type: 'user-said', text: 'a sub-agent line', via: EMessageOrigin.ChildAgent },
      { type: 'user-said', text: 'a sibling session line', sender: { session: 'ses_2' } },
    ])

    expect(texts.filter((text) => !startsWithReservedTag(text))).toEqual([])
    expect(texts.some((text) => text.startsWith(`<${ELane.Agent}`))).toBe(true)
  })
})
