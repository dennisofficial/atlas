import type { EndedShell, EventDraft, ThreadId } from '@dltech/atlas-core'

import { withinBudget, type OnHookMishap } from '../hooks/budget'
import type { HookChainSource } from '../hooks/registry'
const NOTHING_DRAINED: readonly EventDraft[] = Object.freeze([])

export const AFTER_SHELL_BUDGET_MS = 5_000

export async function afterShellDrafts(args: {
  hooks: HookChainSource
  threadId: ThreadId
  shell: EndedShell
  budgetMs?: number | undefined
  onMishap?: OnHookMishap | undefined
}): Promise<readonly EventDraft[]> {
  return withinBudget({
    label: 'after-shell',
    run: () => args.hooks().afterShell({ threadId: args.threadId, shell: args.shell }),
    fallback: () => NOTHING_DRAINED,
    budgetMs: args.budgetMs ?? AFTER_SHELL_BUDGET_MS,
    onMishap: args.onMishap,
  })
}
