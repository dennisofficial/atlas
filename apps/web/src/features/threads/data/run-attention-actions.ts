import type { RunAttention } from '@dltech/atlas-client/transcript'
import { ERunRemedy } from '@dltech/atlas-core'
import type { RunAttentionAction } from '@dltech/atlas-ui/ai/run-attention-strip'

export type RunRemedyHandlers = {
  retry: () => void
  resume: () => void
  fixCredential: () => void
  switchModel: () => void
  openAgent: (agentId: string) => void
  compact: () => void
}

const LABELS: Record<ERunRemedy, string> = {
  [ERunRemedy.Retry]: 'Retry',
  [ERunRemedy.Resume]: 'Resume',
  [ERunRemedy.FixCredential]: 'Update key',
  [ERunRemedy.SwitchModel]: 'Switch model',
  [ERunRemedy.OpenAgent]: 'View agent',
  [ERunRemedy.Compact]: 'Compact',
}

export function runAttentionActionsOf(args: {
  attention: RunAttention
  agentId: string | undefined
  handlers: RunRemedyHandlers
}): RunAttentionAction[] {
  const { attention, agentId, handlers } = args
  const selectors: Record<ERunRemedy, (() => void) | null> = {
    [ERunRemedy.Retry]: handlers.retry,
    [ERunRemedy.Resume]: handlers.resume,
    [ERunRemedy.FixCredential]: handlers.fixCredential,
    [ERunRemedy.SwitchModel]: handlers.switchModel,
    [ERunRemedy.OpenAgent]: agentId === undefined ? null : () => handlers.openAgent(agentId),
    [ERunRemedy.Compact]: handlers.compact,
  }
  return attention.remedies
    .flatMap((entry) => {
      const onSelect = selectors[entry.remedy]
      if (onSelect === null) return []
      return [{ id: entry.remedy, label: LABELS[entry.remedy], disabled: !entry.enabled, onSelect }]
    })
    .map((action, index) => ({ ...action, primary: index === 0 }))
}
