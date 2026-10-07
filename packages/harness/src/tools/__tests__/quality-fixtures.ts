import { z } from 'zod'

import {
  EQualityReviewStatus,
  EToolEffect,
  QualityReviewPort,
  toCallId,
  toRunId,
  toThreadId,
  type CapturedFileChange,
  type EventDraft,
  type LogPort,
  type QualityCoverageDiagnostic,
  type ToolDefinition,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher, type DispatchableCall } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'

export const writeCall: DispatchableCall = {
  callId: toCallId('call-w'),
  name: 'write',
  input: { path: '/workspace/a.ts' },
  runId: toRunId('run-1'),
  threadId: toThreadId('thread-1'),
}

export const change: CapturedFileChange = {
  path: '/workspace/a.ts',
  before: null,
  after: 'export const a = 1\n',
}

export type ReviewRecordDraft = Extract<EventDraft, { type: 'code-quality-reviewed' }>
export type NudgeDraft = Extract<EventDraft, { type: 'nudge' }>

export const reviewRecord: ReviewRecordDraft = {
  type: 'code-quality-reviewed',
  callId: writeCall.callId,
  workspaceNamespace: 'repo',
  path: 'a.ts',
  beforeHash: null,
  afterHash: 'h',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 3,
}

export const reviewNudge: NudgeDraft = {
  type: 'nudge',
  text: 'consider splitting',
  lifetimeSteps: 1,
}

export type ReviewArgs = Parameters<QualityReviewPort['review']>[0]

export class FakeQuality extends QualityReviewPort {
  reviews: ReviewArgs[] = []
  captureChecks = 0

  constructor(
    private readonly script: {
      capture?: () => boolean
      review?: (args: ReviewArgs) => Promise<readonly EventDraft[]>
    } = {},
  ) {
    super()
  }

  captureEnabled(): boolean {
    this.captureChecks += 1
    return this.script.capture?.() ?? true
  }

  async review(args: ReviewArgs): Promise<readonly EventDraft[]> {
    this.reviews.push(args)
    return this.script.review?.(args) ?? [reviewRecord, reviewNudge]
  }
}

export type ToolScript = {
  effect?: EToolEffect
  invoke?: (invocation: ToolInvocation) => Promise<ToolOutcome>
}

export const capturedWrite = (extra: {
  fileChanges?: readonly CapturedFileChange[]
  fileChangeFaults?: readonly QualityCoverageDiagnostic[]
}): ToolOutcome => ({
  ok: true,
  output: { bytes: 3 },
  modelText: 'wrote a.ts',
  ...extra,
})

export function qualityDispatcher(args: {
  quality?: QualityReviewPort
  tool?: ToolScript
  logPort?: LogPort
}): HookedToolDispatcher {
  const definition: ToolDefinition = {
    name: 'write',
    description: 'the write tool',
    effect: args.tool?.effect ?? EToolEffect.Write,
    inputSchema: z.object({ path: z.string() }),
    invoke: args.tool?.invoke ?? (async () => capturedWrite({ fileChanges: [change] })),
  }
  return new HookedToolDispatcher({
    registry: new InMemoryToolRegistry([definition]),
    hooks: new HookChain({}),
    ...(args.quality === undefined ? {} : { quality: args.quality }),
    ...(args.logPort === undefined ? {} : { logPort: args.logPort }),
  })
}

export const dispatchWrite = (dispatcher: HookedToolDispatcher, signal = new AbortController().signal) =>
  dispatcher.dispatch({
    call: writeCall,
    signal,
    projectDirectory: '/workspace',
    events: [],
  })
