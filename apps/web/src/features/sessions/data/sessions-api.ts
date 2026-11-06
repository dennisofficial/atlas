import { api, cloudCall } from '@/lib/api-client'

import type { SessionsApi } from './create-session'
import type { WithdrawApi } from './withdraw-queued'

export const sessionsApi: SessionsApi & WithdrawApi = {
  create: (input) => cloudCall(api.sessions.create.mutate(input)),
  post: (input) => cloudCall(api.sessions.post.mutate(input)),
  withdraw: (input) => cloudCall(api.sessions.withdraw.mutate(input)),
}
