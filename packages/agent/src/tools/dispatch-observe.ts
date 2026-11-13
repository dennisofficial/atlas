import {
  hookOutcomeDrafts,
  type HookOutcome,
  type EventDraft,
  type ToolCall,
  type ToolOutcome,
} from '@dltech/atlas-core'

import { withinBudget, type OnHookMishap } from '../hooks/budget'
import type { HookChain } from '../hooks/registry'

const NO_OUTCOME: HookOutcome = {}

export const observeAfterTool = async (args: {
  hooks: HookChain
  onMishap: OnHookMishap | undefined
  call: ToolCall
  result: ToolOutcome
  projectDirectory: string
  signal: AbortSignal
}): Promise<EventDraft[]> => {
  const observed: EventDraft[] = []

  for (const hook of args.hooks.afterTool) {
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
      budgetMs: args.hooks.bounds.budgetMs,
      onMishap: args.onMishap,
    })
    observed.push(...hookOutcomeDrafts({ hookName: hook.name, outcome }))
  }

  return observed
}
