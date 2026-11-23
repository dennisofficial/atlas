import {
  EBeforeToolDecision,
  isDeferredDeclaration,
  isParkedOutcome,
  modelFacingDeclarationsOf,
  parametersOf,
  resolveBeforeTool,
  typedDeferredInputOf,
  type ActiveWorktree,
  type CallId,
  type Event,
  type EventDraft,
  type RunId,
  type ThreadId,
  type ToolCall,
  type OnToolOutput,
  type WorkspacePort,
} from '@dltech/atlas-core'

import type { OnHookMishap } from '../hooks/budget'
import type { HookChain } from '../hooks/registry'
import type { OnceLedger } from '../loop/once-ledger.port'
import { consultBeforeToolHooks } from './consult-before-tool'
import {
  invalidInputDraft,
  markDispatchStarted,
  markerFailureDraft,
  unknownToolDraft,
} from './dispatch-drafts'
import { observeAfterTool } from './dispatch-observe'
import { invokeTool } from './invoke-tool'
import type { ToolRegistry } from './registry'
import { parkedDraftOf, resultDraft } from './tool-result-draft'
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
  private readonly trace: TracePort | undefined

  constructor(args: {
    registry: ToolRegistry
    hooks: HookChain
    workspace?: WorkspacePort | undefined
    onMishap?: OnHookMishap | undefined
    logPort?: LogPort | undefined
    trace?: TracePort | undefined
  }) {
    super()
    this.registry = args.registry
    this.hooks = args.hooks
    this.workspace = args.workspace
    this.onMishap = args.onMishap ?? args.hooks.bounds.onMishap
    this.logPort = args.logPort
    this.trace = args.trace
  }

  dispatch(args: DispatchArgs): Promise<readonly EventDraft[]> {
    const { call } = args
    return spanWith(this.trace, {
      name: ESpan.Tool,
      fields: {
        threadId: call.threadId,
        runId: call.runId,
        callId: call.callId,
        tool: call.name,
      },
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
      onceLedger,
    } = args
    const declaration = this.registry.declarations().find((declared) => declared.name === call.name)
    const definition = this.registry.find(call.name)
    if (definition === undefined || declaration === undefined) {
      const available = modelFacingDeclarationsOf(this.registry.declarations()).map(
        (declared) => declared.name,
      )
      return [unknownToolDraft({ call, available })]
    }

    const input = isDeferredDeclaration(declaration)
      ? typedDeferredInputOf({ declaration, input: call.input })
      : call.input
    const parsed = definition.inputSchema.safeParse(input)
    if (!parsed.success) {
      return [
        invalidInputDraft({
          call,
          toolName: call.name,
          issues: parsed.error.issues,
          parameters: parametersOf({
            inputSchema: definition.inputSchema,
            jsonSchema: declaration.jsonSchema,
          }),
        }),
      ]
    }

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
            onceLedger,
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
    const captureFileChanges = await this.hooks.capturesFileChanges({ call: allowed, signal })

    const result = await spanWith(this.trace, {
      name: ESpan.ToolInvoke,
      run: () =>
        invokeTool({
          logPort: this.logPort,
          definition,
          call: allowed,
          signal,
          idempotencyKey,
          projectDirectory,
          homeDirectory,
          activeWorktree,
          threadId: call.threadId,
          onOutput,
          captureFileChanges,
        }),
    })

    if (isParkedOutcome(result)) {
      return [...drafts, parkedDraftOf({ call, result })]
    }

    const afterTool = await spanWith(this.trace, {
      name: ESpan.ToolAfterHooks,
      run: () =>
        observeAfterTool({
          hooks: this.hooks,
          onMishap: this.onMishap,
          call: allowed,
          result,
          projectDirectory,
          signal,
        }),
    })

    return [
      ...drafts,
      resultDraft({
        call: { ...allowed, callId: call.callId, name: call.name },
        result,
        interrupted: signal.aborted,
      }),
      ...afterTool,
    ]
  }
}
