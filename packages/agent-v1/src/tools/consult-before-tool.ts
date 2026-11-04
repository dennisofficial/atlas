import {
  EBeforeToolDecision,
  type BeforeTool,
  type BeforeToolOutcome,
  type ConsultedHook,
  type Event,
  type RunId,
  type ToolCall,
} from '@dltech/atlas-core'

import { withinBudget, type OnHookMishap } from '../hooks/budget'
import type { HookChain, RegisteredHook } from '../hooks/registry'
import type { OnceLedger } from '../loop/once-ledger.port'
import { outcomeWhenAHookDidNotAnswerInTime } from './hook-silence'

export async function consultBeforeToolHooks(args: {
  hooks: HookChain
  onMishap: OnHookMishap | undefined
  call: ToolCall
  projectDirectory: string
  events: readonly Event[]
  signal: AbortSignal
  onceLedger: OnceLedger | undefined
  runId: RunId
}): Promise<ConsultedHook[]> {
  const consulted: ConsultedHook[] = []
  let input = args.call.input

  for (const hook of args.hooks.beforeTool) {
    const decide = () =>
      outcomeOf({
        hook,
        onMishap: args.onMishap,
        bounds: args.hooks.bounds,
        call: { ...args.call, input },
        projectDirectory: args.projectDirectory,
        events: args.events,
        signal: args.signal,
      })
    const outcome =
      args.onceLedger === undefined
        ? await decide()
        : await args.onceLedger.once({
            key: `hook:${hook.name}:${args.runId}:${args.call.callId}`,
            decide,
          })
    if (outcome.decision === EBeforeToolDecision.Allow) input = outcome.input
    consulted.push({ hookName: hook.name, outcome })
  }

  return consulted
}

function outcomeOf(args: {
  hook: RegisteredHook<BeforeTool>
  onMishap: OnHookMishap | undefined
  bounds: HookChain['bounds']
  call: ToolCall
  projectDirectory: string
  events: readonly Event[]
  signal: AbortSignal
}): Promise<BeforeToolOutcome> {
  return withinBudget({
    label: args.hook.name,
    run: () =>
      args.hook.run({
        call: args.call,
        projectDirectory: args.projectDirectory,
        events: args.events,
        signal: args.signal,
      }),
    fallback: (mishap) => outcomeWhenAHookDidNotAnswerInTime({ mishap, call: args.call }),
    budgetMs: args.bounds.budgetMs,
    onMishap: args.onMishap,
  })
}
