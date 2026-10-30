import { toast } from 'sonner'

import type { LiveRetry } from './live-thread-view'

export function useRetryRun(retry: LiveRetry): () => void {
  return () => {
    if (retry()) return
    toast.error('Could not reach the sandbox to retry the run')
  }
}
