import type { PlanStep } from '@dltech/atlas-ui/ai/plan'
import type { QueuedMessageEntry } from '@dltech/atlas-ui/ai/queued-messages'

import { Composer } from './composer'
import { useQueuedMessages } from './use-queued-messages'

export interface ThreadComposerProps {
  steps: PlanStep[]
  initialQueue: QueuedMessageEntry[]
  busy: boolean
}

export function ThreadComposer({ steps, initialQueue, busy }: ThreadComposerProps) {
  const { queued, handleAppend, handleSave, handleRemove } = useQueuedMessages(initialQueue)

  const handleSend = (text: string) => {
    if (busy) handleAppend(text)
  }

  return (
    <Composer
      steps={steps}
      queued={queued}
      busy={busy}
      onSaveQueued={handleSave}
      onRemoveQueued={handleRemove}
      onSend={handleSend}
    />
  )
}
