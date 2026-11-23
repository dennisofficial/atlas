import type {
  SessionBucketPageInput,
  SessionSubscribeInput,
  SessionSubscribeOutput,
  SessionUnsubscribeInput,
  SessionUnsubscribeOutput,
} from '@dltech/atlas-protocol'
import type { SessionPageInput } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

import type { SessionsApi } from './create-session'
import type { RetryApi } from './retry-session'
import type { RewindApi } from './session-rewind'
import type { StopApi } from './stop-session'
import type { WithdrawApi } from './withdraw-queued'

const V2_SESSIONS_LIMIT = 100

export const fetchV2Sessions = async () =>
  (await cloudCall(api.sessions.list.query({ limit: V2_SESSIONS_LIMIT }))).sessions

export const archiveV2Session = (args: { sessionId: string; archived: boolean }) =>
  cloudCall(api.sessions.archive.mutate(args))

export const markV2SessionRead = async (args: { sessionId: string; seq: number }) => {
  const { readSeq } = await cloudCall(api.sessions.markRead.mutate(args))
  return { readSeq }
}

export const fetchSessionPage = (input: SessionPageInput) =>
  cloudCall(api.sessions.page.query(input))

export const fetchV2BucketPage = (input: SessionBucketPageInput) =>
  cloudCall(api.sessions.bucketPage.query(input))

export type SubscriptionsApi = {
  subscribe(input: SessionSubscribeInput): Promise<SessionSubscribeOutput>
  unsubscribe(input: SessionUnsubscribeInput): Promise<SessionUnsubscribeOutput>
}

export const sessionsApi: SessionsApi &
  WithdrawApi &
  RetryApi &
  StopApi &
  RewindApi &
  SubscriptionsApi = {
  create: (input) => cloudCall(api.sessions.create.mutate(input)),
  post: (input) => cloudCall(api.sessions.post.mutate(input)),
  withdraw: (input) => cloudCall(api.sessions.withdraw.mutate(input)),
  retry: (input) => cloudCall(api.sessions.retry.mutate(input)),
  stop: (input) => cloudCall(api.sessions.stop.mutate(input)),
  command: (input) => cloudCall(api.sessions.command.mutate(input)),
  subscribe: (input) => cloudCall(api.sessions.subscribe.mutate(input)),
  unsubscribe: (input) => cloudCall(api.sessions.unsubscribe.mutate(input)),
}
