import type { AppThread } from './fixtures/app'

export function threadPath(threadId: string): string {
  return `/threads/${encodeURIComponent(threadId)}`
}

export function threadHref(thread: AppThread): string {
  return thread.href ?? threadPath(thread.id)
}

export function projectSettingsHref(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/settings/overview`
}
