import { api, cloudCall } from '@/lib/api-client'

import type { SessionsApi } from './create-session'

export const sessionsApi: SessionsApi = {
  create: (input) => cloudCall(api.sessions.create.mutate(input)),
  post: (input) => cloudCall(api.sessions.post.mutate(input)),
}
