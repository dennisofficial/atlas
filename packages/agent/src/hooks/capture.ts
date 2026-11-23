import type { ToolCall } from '@dltech/atlas-core'

import { withinBudget, type OnHookMishap } from './budget'
import type { AfterToolHook } from './registry'

const asksToCapture = (args: {
  hook: AfterToolHook
  call: ToolCall
  signal: AbortSignal
  budgetMs: number | undefined
  onMishap: OnHookMishap | undefined
}): Promise<boolean> => {
  const predicate = args.hook.capturesFileChanges
  if (predicate === undefined) return Promise.resolve(false)

  return withinBudget({
    label: args.hook.name,
    run: () => predicate({ call: args.call, signal: args.signal }),
    fallback: () => false,
    budgetMs: args.budgetMs,
    onMishap: args.onMishap,
  })
}

export const capturesFileChangesOf = async (args: {
  hooks: readonly AfterToolHook[]
  call: ToolCall
  signal: AbortSignal
  budgetMs: number | undefined
  onMishap: OnHookMishap | undefined
}): Promise<boolean> => {
  const asked = await Promise.all(
    args.hooks.map((hook) =>
      asksToCapture({
        hook,
        call: args.call,
        signal: args.signal,
        budgetMs: args.budgetMs,
        onMishap: args.onMishap,
      }),
    ),
  )

  return asked.some(Boolean)
}
