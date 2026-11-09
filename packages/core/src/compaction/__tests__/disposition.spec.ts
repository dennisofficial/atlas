import { describe, expect, it } from 'bun:test'

import { EAgentRestart } from '../../agents/restart'
import { EReportKind } from '../../agents/report'
import { EAgentStatus } from '../../agents/status'
import { ECompactionAnchor, EPrEventKind, EPrVerdict, type EventType } from '../../events/body'
import { toCallId, toThreadId } from '../../events/ids'
import { EExecutionLocation } from '../../execution/location'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import { ESubscriptionActor } from '../../subscriptions/subscription'
import {
  COMPACTION_DISPOSITION,
  ECompactionDisposition,
  KEPT_THROUGH_COMPACTION,
  keptThroughCompaction,
  type SummarisedType,
} from '../disposition'
import { transcriptOfRange } from '../render-range'
import { eventsFrom } from './fixture'

const SURVIVOR_MINIMAL = {
  'user-said': { type: 'user-said', text: 'hello there' },
  'assistant-said': { type: 'assistant-said', parts: [{ type: 'text', text: 'hi' }] },
  'tool-called': {
    type: 'tool-called',
    callId: toCallId('call-1'),
    name: 'bash',
    input: { command: 'ls' },
    ordinal: 0,
  },
  'tool-result': {
    type: 'tool-result',
    callId: toCallId('call-1'),
    name: 'bash',
    output: { ok: true },
  },
  'tool-denied': {
    type: 'tool-denied',
    callId: toCallId('call-1'),
    name: 'bash',
    reason: 'no',
  },
  'history-compacted': {
    type: 'history-compacted',
    anchor: ECompactionAnchor.Prefix,
    fromSeq: 1,
    throughSeq: 1,
    summary: 'earlier turns',
    replaced: 1,
  },
  'agent-ended': {
    type: 'agent-ended',
    agentId: toThreadId('thread-child'),
    agentType: 'explore',
    intent: 'find the callers',
    status: EAgentStatus.Finished,
    prose: 'found three callers',
    turns: 2,
    toolCalls: 4,
  },
  'agent-reported': {
    type: 'agent-reported',
    agentId: toThreadId('thread-child'),
    agentType: 'explore',
    intent: 'find the callers',
    prose: 'halfway through',
    kind: EReportKind.Progress,
  },
  'agent-restarted': {
    type: 'agent-restarted',
    agentId: toThreadId('thread-child'),
    agentType: 'explore',
    intent: 'find the callers',
    via: EAgentRestart.Resume,
  },
  'background-shell-ended': {
    type: 'background-shell-ended',
    shellId: 'shell-1',
    command: 'bun test',
    status: EShellStatus.Exited,
    exitCode: 0,
    output: '12 pass',
    droppedCharacters: 0,
    remainingCharacters: 7,
  },
  'background-shell-still-running': {
    type: 'background-shell-still-running',
    shellId: 'shell-1',
    command: 'bun test',
    runningForMs: 60_000,
    silentForMs: 5_000,
    checkInMs: 30_000,
    tail: 'running…',
  },
  'background-shell-matched': {
    type: 'background-shell-matched',
    shellId: 'shell-1',
    command: 'bun test',
    pattern: 'fail',
    lines: '1 fail',
    matchCount: 1,
  },
  'background-shell-awaiting-input': {
    type: 'background-shell-awaiting-input',
    shellId: 'shell-1',
    command: 'bun add',
    output: 'which package?',
    droppedCharacters: 0,
    remainingCharacters: 14,
  },
  'service-ended': {
    type: 'service-ended',
    serviceId: 'svc-1',
    command: 'bun run dev',
    status: EServiceStatus.Exited,
    tail: 'listening on 3000',
  },
  'pr-event': {
    type: 'pr-event',
    repo: 'dltech/atlas',
    prNumber: 42,
    kind: EPrEventKind.Verdict,
    url: 'https://github.com/dltech/atlas/pull/42',
    verdict: EPrVerdict.Green,
    headSha: 'abcdef1234567',
    settled: true,
  },
  'run-event': {
    type: 'run-event',
    repo: 'github.com/dltech/atlas',
    workflowRunId: 33522901117,
    workflow: 'Build',
    branch: 'dennis/subscriptions',
    url: 'https://github.com/dltech/atlas/actions/runs/33522901117',
    status: 'completed',
    conclusion: 'success',
  },
  nudge: { type: 'nudge', text: 'wrap up soon', lifetimeSteps: 2 },
  'sandbox-setup-reported': {
    type: 'sandbox-setup-reported',
    text: 'installed the toolchain',
    failed: false,
  },
  parked: {
    type: 'parked',
    reason: 'idle',
    turnRunning: false,
    childrenRunning: 0,
    shellsRunning: 0,
    servicesRunning: 0,
    clientsAttached: 0,
  },
} as const satisfies Record<SummarisedType, unknown>

const summarisedTypes = (Object.keys(COMPACTION_DISPOSITION) as EventType[]).filter(
  (type): type is SummarisedType =>
    COMPACTION_DISPOSITION[type] === ECompactionDisposition.Summarise,
)

describe('compaction disposition', () => {
  it('keeps exactly the types the table marks Keep', () => {
    const expected = (Object.keys(COMPACTION_DISPOSITION) as EventType[]).filter(
      (type) => COMPACTION_DISPOSITION[type] === ECompactionDisposition.Keep,
    )
    const kept: readonly string[] = KEPT_THROUGH_COMPACTION
    expect([...kept].sort()).toEqual([...expected].sort())
    for (const type of expected) expect(keptThroughCompaction(type)).toBe(true)
  })

  it('drops nothing below Keep', () => {
    for (const type of Object.keys(COMPACTION_DISPOSITION) as EventType[]) {
      if (COMPACTION_DISPOSITION[type] === ECompactionDisposition.Keep) continue
      expect(keptThroughCompaction(type)).toBe(false)
    }
  })

  it('renders a non-empty transcript line for every Summarise type', () => {
    for (const type of summarisedTypes) {
      const events = eventsFrom([SURVIVOR_MINIMAL[type]])
      const transcript = transcriptOfRange({ events, throughSeq: 1 })
      expect(transcript, `expected a transcript line for ${type}`).not.toBe('')
    }
  })

  it('leaves a Keep type out of the summariser transcript', () => {
    const events = eventsFrom([
      {
        type: 'subscription-created',
        subscriptionId: 'sub-1',
        provider: 'github.pull-request',
        target: '#1',
        label: 'the PR',
        createdBy: ESubscriptionActor.Agent,
      },
      {
        type: 'location-changed',
        from: EExecutionLocation.Host,
        to: EExecutionLocation.Cloud,
      },
    ])
    const transcript = transcriptOfRange({ events, throughSeq: 2 })
    expect(transcript).not.toContain('subscribed')
    expect(transcript).toContain('cloud sandbox')
  })
})
