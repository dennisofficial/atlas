import {
  hookOutcomeDrafts,
  orderHooks,
  type AfterShell,
  type AfterTool,
  type AfterTurn,
  type Assembled,
  type AssemblyTrace,
  type BeforeRequest,
  type BeforeStep,
  type BeforeTool,
  type BeforeTurn,
  type ThreadId,
  type Chunk,
  type EndedShell,
  type EventDraft,
  type HookOrder,
  type HookOutcome,
  type OnChunk,
  type OnThreadOpen,
  type ProviderPrompt,
} from '@dltech/atlas-core'
import { ESpan, spanWith, type TracePort } from '@dltech/atlas-observability'

import { withinBudget, type OnHookMishap } from './budget'

export enum EHookPhase {
  BeforeTurn = 'before-turn',
  ThreadOpen = 'thread-open',
  BeforeStep = 'before-step',
  BeforeRequest = 'before-request',
  AfterShell = 'after-shell',
  OnChunk = 'on-chunk',
  AfterTurn = 'after-turn',
}

export type RegisteredHook<TPhase> = {
  name: string
  order: HookOrder
  run: TPhase
  awaited?: true | undefined
}

/**
 * Anything the chain itself can depend on must hold it as a thunk: the chain resolves hooks, which
 * resolve tools, which resolve the shell registry, and reading it eagerly would close that circle.
 */
export type HookChainSource = () => HookChain

type OutcomeHook<TArgs> = (args: TArgs) => Promise<HookOutcome>

export type HookChainArgs = {
  beforeTurn?: readonly RegisteredHook<BeforeTurn>[] | undefined
  beforeStep?: readonly RegisteredHook<BeforeStep>[] | undefined
  beforeRequest?: readonly RegisteredHook<BeforeRequest>[] | undefined
  beforeTool?: readonly RegisteredHook<BeforeTool>[] | undefined
  afterTool?: readonly RegisteredHook<AfterTool>[] | undefined
  afterShell?: readonly RegisteredHook<AfterShell>[] | undefined
  onChunk?: readonly RegisteredHook<OnChunk>[] | undefined
  afterTurn?: readonly RegisteredHook<AfterTurn>[] | undefined
  onThreadOpen?: readonly RegisteredHook<OnThreadOpen>[] | undefined
  onMishap?: OnHookMishap | undefined
  budgetMs?: number | undefined
  trace?: TracePort | undefined
}

export type Bounds = {
  onMishap: OnHookMishap | undefined
  budgetMs: number | undefined
  trace?: TracePort | undefined
}

const NOTHING: HookOutcome = {}

function bounded<TValue>(args: {
  hook: { name: string; awaited?: true | undefined }
  phase: EHookPhase
  bounds: Bounds
  run: () => Promise<TValue>
  fallback: TValue
}): Promise<TValue> {
  return spanWith(args.bounds.trace, {
    name: ESpan.Hook,
    fields: { hook: args.hook.name, phase: args.phase },
    run: (span) =>
      withinBudget({
        label: args.hook.name,
        run: args.run,
        fallback: (mishap) => {
          span.set({ failureKind: mishap.kind })
          return args.fallback
        },
        budgetMs: args.bounds.budgetMs,
        awaited: args.hook.awaited,
        onMishap: args.bounds.onMishap,
      }),
  })
}

async function collectDrafts<TArgs>({
  hooks,
  phase,
  args,
  bounds,
}: {
  hooks: readonly RegisteredHook<OutcomeHook<TArgs>>[]
  phase: EHookPhase
  args: TArgs
  bounds: Bounds
}): Promise<readonly EventDraft[]> {
  const drafts: EventDraft[] = []
  for (const stage of stagesOf(hooks)) {
    const collected = await Promise.all(
      stage.map(async (hook) =>
        hookOutcomeDrafts({
          hookName: hook.name,
          outcome: await bounded({
            hook,
            phase,
            bounds,
            run: () => hook.run(args),
            fallback: NOTHING,
          }),
        }),
      ),
    )
    drafts.push(...collected.flat())
  }
  return drafts
}

const stagesOf = <THook extends { order: HookOrder }>(
  ordered: readonly THook[],
): readonly (readonly THook[])[] => {
  const stages: THook[][] = []
  for (const hook of ordered) {
    const current = stages.at(-1)
    if (current?.[0]?.order.stage === hook.order.stage) current.push(hook)
    else stages.push([hook])
  }
  return stages
}

export class HookChain {
  readonly beforeTool: readonly RegisteredHook<BeforeTool>[]
  readonly afterTool: readonly RegisteredHook<AfterTool>[]

  private readonly beforeTurnHooks: readonly RegisteredHook<BeforeTurn>[]
  private readonly beforeStepHooks: readonly RegisteredHook<BeforeStep>[]
  private readonly beforeRequestHooks: readonly RegisteredHook<BeforeRequest>[]
  private readonly afterShellHooks: readonly RegisteredHook<AfterShell>[]
  private readonly onChunkHooks: readonly RegisteredHook<OnChunk>[]
  private readonly afterTurnHooks: readonly RegisteredHook<AfterTurn>[]
  private readonly onThreadOpenHooks: readonly RegisteredHook<OnThreadOpen>[]
  readonly bounds: Bounds

  constructor(args: HookChainArgs) {
    this.bounds = { onMishap: args.onMishap, budgetMs: args.budgetMs, trace: args.trace }
    this.beforeTurnHooks = orderHooks(args.beforeTurn ?? [])
    this.beforeStepHooks = orderHooks(args.beforeStep ?? [])
    this.beforeRequestHooks = orderHooks(args.beforeRequest ?? [])
    this.beforeTool = orderHooks(args.beforeTool ?? [])
    this.afterTool = orderHooks(args.afterTool ?? [])
    this.afterShellHooks = orderHooks(args.afterShell ?? [])
    this.onChunkHooks = orderHooks(args.onChunk ?? [])
    this.afterTurnHooks = orderHooks(args.afterTurn ?? [])
    this.onThreadOpenHooks = orderHooks(args.onThreadOpen ?? [])
  }

  async beforeTurn(args: {
    threadId: ThreadId
    projectDirectory: string
  }): Promise<readonly EventDraft[]> {
    return collectDrafts({
      hooks: this.beforeTurnHooks,
      phase: EHookPhase.BeforeTurn,
      args,
      bounds: this.bounds,
    })
  }

  async onThreadOpen(args: {
    threadId: ThreadId
    projectDirectory: string
  }): Promise<readonly EventDraft[]> {
    return collectDrafts({
      hooks: this.onThreadOpenHooks,
      phase: EHookPhase.ThreadOpen,
      args,
      bounds: this.bounds,
    })
  }

  async beforeStep(args: { assembled: Assembled; trace: AssemblyTrace }): Promise<Assembled> {
    let assembled = args.assembled
    for (const hook of this.beforeStepHooks) {
      const carried = assembled
      assembled = await bounded({
        hook,
        bounds: this.bounds,
        phase: EHookPhase.BeforeStep,
        run: () => hook.run({ assembled: carried, trace: args.trace }),
        fallback: carried,
      })
    }
    return assembled
  }

  async beforeRequest(args: { prompt: ProviderPrompt }): Promise<ProviderPrompt> {
    let prompt = args.prompt
    for (const hook of this.beforeRequestHooks) {
      const carried = prompt
      prompt = await bounded({
        hook,
        bounds: this.bounds,
        phase: EHookPhase.BeforeRequest,
        run: () => hook.run(carried),
        fallback: carried,
      })
    }
    return prompt
  }

  /**
   * No turn is in flight when this runs, so the drafts go back to the shell registry rather than
   * into a log: they are delivered with the ending's notice or not at all.
   */
  async afterShell(args: {
    threadId: ThreadId
    shell: EndedShell
  }): Promise<readonly EventDraft[]> {
    return collectDrafts({
      hooks: this.afterShellHooks,
      phase: EHookPhase.AfterShell,
      args,
      bounds: this.bounds,
    })
  }

  async onChunk(args: { chunk: Chunk }): Promise<Chunk | null> {
    let chunk = args.chunk
    for (const hook of this.onChunkHooks) {
      const carried = chunk
      const kept = await bounded<Chunk | null>({
        hook,
        phase: EHookPhase.OnChunk,
        bounds: { ...this.bounds, trace: undefined },
        run: () => hook.run(carried),
        fallback: carried,
      })
      if (kept === null) return null
      chunk = kept
    }
    return chunk
  }

  async afterTurn(args: { threadId: ThreadId }): Promise<readonly EventDraft[]> {
    return collectDrafts({
      hooks: this.afterTurnHooks,
      phase: EHookPhase.AfterTurn,
      args,
      bounds: this.bounds,
    })
  }
}
