import { toast } from 'sonner'

import type { ModelSelection } from './model-selection'
import type { ThreadSource } from './thread-source'
import type { useThreadModel } from './use-thread-model'

export function useThreadViewActions(args: {
  threadId: string
  source: Pick<ThreadSource, 'interrupt' | 'chooseModel'>
  model: Pick<ReturnType<typeof useThreadModel>, 'handleChange'>
  retryBoot: (threadId: string) => Promise<unknown>
  refresh: () => void
}) {
  const { threadId, source, model, retryBoot, refresh } = args
  const handleModelChange = (next: ModelSelection) =>
    void model.handleChange({ next, chooseLive: source.chooseModel })
  const handleRetryBoot = async () => {
    await retryBoot(threadId)
    refresh()
  }
  const handleStop = () => {
    if (source.interrupt()) return
    toast.error('Could not reach the sandbox to stop the turn')
  }
  return { handleModelChange, handleRetryBoot, handleStop }
}
