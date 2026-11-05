import {
  EBeforeToolDecision,
  hookOutcomeDrafts,
  resolveBeforeTool,
  type ActiveWorktree,
  type CallId,
  type Event,
  type EventDraft,
  type RunId,
  type ThreadId,
  type ToolCall,
  type ToolDefinition,
  type ToolOutcome,
  type OnToolOutput,
  type WorkspacePort,
  type HookOutcome,
} from '@dltech/atlas-core'

import { logFieldsOf } from '@dltech/atlas-observability'
import { withinBudget, type OnHookMishap } from '../hooks/budget'
import type { HookChain } from '../hooks/registry'
import type { OnceLedger } from '../loop/once-ledger.port'
import { consultBeforeToolHooks } from './consult-before-tool'
import {
  invalidInputDraft,
  markDispatchStarted,
  markerFailureDraft,
  unknownToolDraft,
} from './dispatch-drafts'
import { NO_QUALITY_STAGE, type QualityStagePort } from './quality-stage'
import type { ToolRegistry } from './registry'
import { resultDraft } from './tool-result-draft'
import {
  ESpan,
  ESpanOutcome,
  spanWith,
  type LogPort,
  type TracePort,
} from '@dltech/atlas-observability'

export type DispatchableCall = {
  callId: CallId
  name: string
  input: unknown
  runId: RunId
  threadId: ThreadId
}

export type DispatchArgs = {
  call: DispatchableCall
  signal: AbortSignal
  projectDirectory: string
  homeDirectory?: string | undefined
  events: readonly Event[]
  activeWorktree?: ActiveWorktree | undefined
  onOutput?: OnToolOutput | undefined
  onDispatchStarted?: ((draft: EventDraft) => Promise<void>) | undefined
  onceLedger?: OnceLedger | undefined
}

export abstract class ToolDispatcher {
  abstract dispatch(args: DispatchArgs): Promise<readonly EventDraft[]>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const NO_OUTCOME: HookOutcome = {}

const outcomeOf = (drafts: readonly EventDraft[]): ESpanOutcome => {
  if (drafts.some((draft) => draft.type === 'tool-denied')) return ESpanOutcome.Denied
  const failed = drafts.some((draft) => draft.type === 'tool-result' && draft.error !== undefined)
  return failed ? ESpanOutcome.Error : ESpanOutcome.Ok
}

export class HookedToolDispatcher extends ToolDispatcher {
  private readonly registry: ToolRegistry
  private readonly hooks: HookChain
  private readonly workspace: WorkspacePort | undefined
  private readonly onMishap: OnHookMishap | undefined
  private readonly logPort: LogPort | undefined
  private readonly quality: QualityStagePort
  private readonly trace: TracePort | undefined

  constructor(args: {
    registry: ToolRegistry
    hooks: HookChain
    workspace?: WorkspacePort | undefined
    onMishap?: OnHookMishap | undefined
    logPort?: LogPort | undefined
    quality?: QualityStagePort | undefined
    trace?: TracePort | undefined
  }) {
    super()
    this.registry = args.registry
    this.hooks = args.hooks
    this.workspace = args.workspace
    this.onMishap = args.onMishap ?? args.hooks.bounds.onMishap
    this.logPort = args.logPort
    this.quality = args.quality ?? NO_QUALITY_STAGE
    this.trace = args.trace
  }

  dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const { call } = args
    return spanWith(this.trace, {
      name: ESpan.Tool,
      fields: { threadId: call.threadId, runId: call.runId, callId: call.callId, tool: call.name },
      run: async (span) => {
        const drafts = await this.dispatchTraced(args)
        span.set({ outcome: outcomeOf(drafts) })
        return drafts
      },
    })
  }

  private async dispatchTraced(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const {
      call,
      signal,
      projectDirectory,
      homeDirectory,
      activeWorktree,
      events,
      onOutput,
      onDispatchStarted,
    } = args
    const definition = this.registry.find(call.name)
    if (definition === undefined) {
      const available = this.registry.declarations().map((declaration) => declaration.name)
      return [unknownToolDraft({ call, available })]
    }

    const parsed = definition.inputSchema.safeParse(call.input)
    if (!parsed.success) return [invalidInputDraft({ call, issues: parsed.error.issues })]

    const candidate: ToolCall = {
      callId: call.callId,
      name: call.name,
      input: parsed.data,
      effect: definition.effect,
      threadId: call.threadId,
    }

    const { outcome, drafts } = resolveBeforeTool({
      call: candidate,
      outcomes: await spanWith(this.trace, {
        name: ESpan.ToolHooks,
        run: () =>
          consultBeforeToolHooks({
            hooks: this.hooks,
            onMishap: this.onMishap,
            call: candidate,
            projectDirectory,
            events,
            signal,
            onceLedger: args.onceLedger,
            runId: call.runId,
          }),
      }),
    })

    if (outcome.decision === EBeforeToolDecision.Deny) {
      return [
        ...drafts,
        { type: 'tool-denied', callId: call.callId, name: call.name, reason: outcome.reason },
      ]
    }

    const allowed: ToolCall = { ...candidate, input: outcome.input }
    const idempotencyKey = `${call.runId}:${call.callId}`
    const markerFailure = await markDispatchStarted({
      onDispatchStarted,
      call,
      logPort: this.logPort,
    })
    if (markerFailure !== undefined) {
      return [
        ...drafts,
        markerFailureDraft({ callId: call.callId, name: call.name, failure: markerFailure }),
      ]
    }
    const result = await spanWith(this.trace, {
      name: ESpan.ToolInvoke,
      run: () =>
        this.invokeTool({
          definition,
          call: allowed,
          signal,
          idempotencyKey,
          projectDirectory,
          homeDirectory,
          activeWorktree,
          threadId: call.threadId,
          onOutput,
          captureFileChanges: this.quality.captureEnabled({ threadId: call.threadId }),
        }),
    })

    const qualityOutcome = await spanWith(this.trace, {
      name: ESpan.ToolQuality,
      run: () =>
        this.quality.review({
          call: allowed,
          runId: call.runId,
          result,
          events,
          projectDirectory,
          signal,
        }),
    })
    const afterTool = await spanWith(this.trace, {
      name: ESpan.ToolAfterHooks,
      run: () => this.observeAfterTool({ call: allowed, result, projectDirectory, signal }),
    })

    return [
      ...drafts,
      resultDraft({
        call: allowed,
        result,
        interrupted: signal.aborted,
        qualityReviews: qualityOutcome.reviews,
      }),
      ...afterTool,
      ...(qualityOutcome.nudge === undefined ? [] : [qualityOutcome.nudge]),
    ]
  }

  private async invokeTool(args: {
    definition: ToolDefinition
    call: ToolCall
    signal: AbortSignal
    idempotencyKey: string
    projectDirectory: string
    homeDirectory: string | undefined
    activeWorktree: ActiveWorktree | undefined
    threadId: ThreadId
    onOutput: OnToolOutput | undefined
    captureFileChanges: boolean
  }): Promise<ToolOutcome> {
    try {
      return await args.definition.invoke({
        input: args.call.input,
        signal: args.signal,
        idempotencyKey: args.idempotencyKey,
        projectDirectory: args.projectDirectory,
        homeDirectory: args.homeDirectory,
        activeWorktree: args.activeWorktree,
        threadId: args.threadId,
        onOutput: args.onOutput,
        ...(args.captureFileChanges ? { captureFileChanges: true } : {}),
      })
    } catch (error) {
      this.logPort?.error({
        source: 'tools.dispatch',
        message: `the ${args.call.name} tool threw`,
        threadId: args.threadId,
        data: { tool: args.call.name },
        ...logFieldsOf({ error }),
      })
      return { ok: false, reason: `the ${args.call.name} tool threw: ${messageOf(error)}` }
    }
  }

  private async observeAfterTool(args: {
    call: ToolCall
    result: ToolOutcome
    projectDirectory: string
    signal: AbortSignal
  }): Promise<EventDraft[]> {
    const observed: EventDraft[] = []

    for (const hook of this.hooks.afterTool) {
      const outcome = await withinBudget({
        label: hook.name,
        run: () =>
          hook.run({
            call: args.call,
            result: args.result,
            projectDirectory: args.projectDirectory,
            signal: args.signal,
          }),
        fallback: () => NO_OUTCOME,
        budgetMs: this.hooks.bounds.budgetMs,
        onMishap: this.onMishap,
      })
      observed.push(...hookOutcomeDrafts({ hookName: hook.name, outcome }))
    }

    return observed
  }
}
