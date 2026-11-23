import { describe, expect, it } from 'bun:test'

import {
  EQualityReviewStatus,
  EStage,
  EToolEffect,
  ToolDefinition,
  toCallId,
  toRunId,
  toThreadId,
  type CodeQualityReviewedBody,
  type EventDraft,
  type ThreadId,
  type ToolInvocation,
  type ToolOutcome,
} from '@dltech/atlas-core'
import { z } from 'zod'

import { HookChain } from '../../hooks/registry'
import type { QualityReviewOutcome, QualityStagePort } from '../quality-stage'
import { HookedToolDispatcher } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'

const THREAD = toThreadId('thread-1')
const CALL = toCallId('call-1')
const RUN = toRunId('run-1')

const dispatchArgs = {
  call: {
    callId: CALL,
    name: 'write',
    input: { path: '/repo/a.ts' },
    runId: RUN,
    threadId: THREAD,
  },
  signal: new AbortController().signal,
  projectDirectory: '/repo',
  events: [],
}

const change = { path: '/repo/a.ts', before: null, after: 'export const a = 1\n' }

const review: CodeQualityReviewedBody = {
  type: 'code-quality-reviewed',
  callId: CALL,
  workspaceNamespace: 'repo',
  path: 'a.ts',
  beforeHash: null,
  afterHash: 'h',
  status: EQualityReviewStatus.Completed,
  assessments: [],
  findings: [],
  durationMs: 3,
}

const nudge: EventDraft = { type: 'nudge', text: 'consider splitting', lifetimeSteps: 1 }

class FakeStage implements QualityStagePort {
  readonly reviewArgs: Parameters<QualityStagePort['review']>[0][] = []
  readonly captureThreads: ThreadId[] = []

  constructor(
    private readonly script: {
      capture?: boolean
      review?: QualityReviewOutcome
    } = {},
  ) {}

  captureEnabled({ threadId }: { threadId: ThreadId }): boolean {
    this.captureThreads.push(threadId)
    return this.script.capture ?? true
  }

  async review(args: Parameters<QualityStagePort['review']>[0]): Promise<QualityReviewOutcome> {
    this.reviewArgs.push(args)
    return this.script.review ?? { reviews: [review], nudge }
  }
}

class WriteTool extends ToolDefinition {
  readonly name = 'write'
  readonly description = 'write a file'
  readonly effect = EToolEffect.Write
  readonly inputSchema = z.object({ path: z.string() })
  readonly invocations: ToolInvocation[] = []

  constructor(private readonly outcome: ToolOutcome) {
    super()
  }

  async invoke(args: ToolInvocation): Promise<ToolOutcome> {
    this.invocations.push(args)
    return this.outcome
  }
}

const dispatcherOver = (args: {
  stage?: QualityStagePort
  tool?: WriteTool
  afterTool?: (() => Promise<{ drafts: readonly EventDraft[] }>)[]
}) => {
  const tool =
    args.tool ?? new WriteTool({ ok: true, output: {}, modelText: 'wrote', fileChanges: [change] })
  const dispatcher = new HookedToolDispatcher({
    registry: new InMemoryToolRegistry([tool]),
    hooks: new HookChain({
      afterTool: (args.afterTool ?? []).map((run, index) => ({
        name: `after-${index}`,
        order: { stage: EStage.Observe, nudge: 0 },
        run: async () => run(),
      })),
    }),
    ...(args.stage === undefined ? {} : { quality: args.stage }),
  })
  return { dispatcher, tool }
}

const reviewsOf = (drafts: readonly EventDraft[]): readonly CodeQualityReviewedBody[] => {
  const result = drafts.find((draft) => draft.type === 'tool-result')
  if (result === undefined || !('qualityReviews' in result)) return []
  return result.qualityReviews ?? []
}

describe('a dispatcher with a quality stage', () => {
  it('lands the review records on the tool result and the nudge last', async () => {
    const afterDraft: EventDraft = { type: 'nudge', text: 'from an after hook', lifetimeSteps: 1 }
    const stage = new FakeStage()
    const { dispatcher } = dispatcherOver({
      stage,
      afterTool: [async () => ({ drafts: [afterDraft] })],
    })

    const drafts = await dispatcher.dispatch(dispatchArgs)

    expect(drafts.map((draft) => draft.type)).toEqual(['tool-result', 'nudge', 'nudge'])
    expect(reviewsOf(drafts)).toEqual([review])
    expect(drafts[1]).toEqual(afterDraft)
    expect(drafts[2]).toEqual(nudge)
  })

  it('hands the stage the call, run, captured changes and directory', async () => {
    const stage = new FakeStage()

    await dispatcherOver({ stage }).dispatcher.dispatch(dispatchArgs)

    expect(stage.reviewArgs).toHaveLength(1)
    expect(stage.reviewArgs[0]).toMatchObject({
      call: { callId: CALL, name: 'write' },
      runId: RUN,
      projectDirectory: '/repo',
      events: [],
      result: { ok: true, fileChanges: [change] },
    })
  })

  it('asks the stage once per invocation whether to capture, by thread', async () => {
    const stage = new FakeStage()

    await dispatcherOver({ stage }).dispatcher.dispatch(dispatchArgs)

    expect(stage.captureThreads).toEqual([THREAD])
  })

  it('asks the tool for no captured text when the stage says capture is off', async () => {
    const stage = new FakeStage({ capture: false })
    const { dispatcher, tool } = dispatcherOver({ stage })

    await dispatcher.dispatch(dispatchArgs)

    expect('captureFileChanges' in (tool.invocations[0] ?? {})).toBe(false)
  })

  it('forwards no capture flag and reviews nothing with no stage wired', async () => {
    const { dispatcher, tool } = dispatcherOver({})

    const drafts = await dispatcher.dispatch(dispatchArgs)

    expect('captureFileChanges' in (tool.invocations[0] ?? {})).toBe(false)
    expect(reviewsOf(drafts)).toEqual([])
    expect(drafts).toHaveLength(1)
  })

  it('never reviews a write that failed', async () => {
    const stage = new FakeStage()
    const tool = new WriteTool({ ok: false, reason: 'disk full' })
    const { dispatcher } = dispatcherOver({ stage, tool })

    const drafts = await dispatcher.dispatch(dispatchArgs)

    expect(stage.reviewArgs).toHaveLength(1)
    expect(stage.reviewArgs[0]?.result).toEqual({ ok: false, reason: 'disk full' })
    expect(reviewsOf(drafts)).toEqual([])
  })
})
