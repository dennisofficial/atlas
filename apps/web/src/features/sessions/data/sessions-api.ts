import type {
  DiagramRepairInput,
  DiagramRepairListInput,
  DiagramRepairListOutput,
  DiagramRepairOutput,
  SessionSubscribeInput,
  SessionSubscribeOutput,
  SessionUnsubscribeInput,
  SessionUnsubscribeOutput,
} from '@dltech/atlas-protocol'

import { api, cloudCall } from '@/lib/api-client'

import type { SessionsApi } from './create-session'
import type { RetryApi } from './retry-session'
import type { RewindApi, WithdrawApi } from '@dltech/atlas-client/session'
import type { StopApi } from './stop-session'

const SESSIONS_LIMIT = 100

export const fetchSessions = async () =>
  (await cloudCall(api.sessions.list.query({ limit: SESSIONS_LIMIT }))).sessions

export const archiveSession = (args: { sessionId: string; archived: boolean }) =>
  cloudCall(api.sessions.archive.mutate(args))

export const markSessionRead = async (args: { sessionId: string; seq: number }) => {
  const { readSeq } = await cloudCall(api.sessions.markRead.mutate(args))
  return { readSeq }
}

export type SubscriptionsApi = {
  subscribe(input: SessionSubscribeInput): Promise<SessionSubscribeOutput>
  unsubscribe(input: SessionUnsubscribeInput): Promise<SessionUnsubscribeOutput>
}

export type DiagramsApi = {
  repair(input: DiagramRepairInput): Promise<DiagramRepairOutput>
  list(input: DiagramRepairListInput): Promise<DiagramRepairListOutput>
}

export const diagramsApi: DiagramsApi = {
  repair: (input) => cloudCall(api.diagrams.repair.mutate(input)),
  list: (input) => cloudCall(api.diagrams.list.query(input)),
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
