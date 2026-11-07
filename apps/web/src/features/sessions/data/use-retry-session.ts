import { toast } from 'sonner'

import { retrySession } from './retry-session'
import { sessionsApi } from './sessions-api'

export const retrySessionNow = (sessionId: string): Promise<void> =>
  retrySession({
    api: sessionsApi,
    sessionId,
    notify: (message) => toast.error(message),
  })
