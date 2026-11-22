import type { EPrEventKind, GithubPrEventPayload } from './github-realtime.types'

export type GithubWakePrEvent = {
  userId: string
  repoFullName: string
  prNumber: number
  kind: EPrEventKind
  payload: GithubPrEventPayload
  eventId?: string
}

export type GithubWakePrNotice = Pick<GithubWakePrEvent, 'userId' | 'repoFullName' | 'prNumber'> & {
  kind?: 'pull-request'
}

export type GithubWakeEventNotice =
  | GithubWakePrNotice
  | { kind: 'workflow-run'; userId: string; repoFullName: string }

export type GithubLegacyEffects = {
  threadChanged(args: { threadId: string }): void
  notifyEvent(notice: GithubWakeEventNotice, event?: GithubWakePrEvent): Promise<void>
}

export const LEGACY_OUTBOX_KINDS: readonly string[] = ['thread-signal', 'wake']

export const failureText = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)
