import { UNTITLED } from '@/features/threads/data/untitled'

import type { ProjectThreads } from './thread-partition'
import { threadStatusOf, type EThreadStatus } from './thread-status'

export enum ESearchKind {
  Thread = 'thread',
  Project = 'project',
}

export type SearchItem =
  | {
      kind: ESearchKind.Thread
      id: string
      label: string
      projectName: string
      status: EThreadStatus
    }
  | { kind: ESearchKind.Project; id: string; label: string }

export function searchItemsOf(entries: readonly ProjectThreads[]): {
  threads: SearchItem[]
  projects: SearchItem[]
} {
  const threads: SearchItem[] = []
  const projects: SearchItem[] = []
  for (const { project, threads: projectThreads } of entries) {
    projects.push({
      kind: ESearchKind.Project,
      id: project.id,
      label: project.name,
    })
    for (const thread of projectThreads) {
      threads.push({
        kind: ESearchKind.Thread,
        id: thread.id,
        label: thread.title ?? UNTITLED,
        projectName: project.name,
        status: threadStatusOf(thread),
      })
    }
  }
  return { threads, projects }
}

export const searchHrefOf = (item: SearchItem): string =>
  item.kind === ESearchKind.Thread
    ? `/threads/${encodeURIComponent(item.id)}`
    : `/threads/new?project=${encodeURIComponent(item.id)}`

export const searchScoreOf = (args: { search: string; keywords: readonly string[] }): number => {
  const needle = args.search.trim().toLowerCase()
  if (needle.length === 0) return 1
  return args.keywords.some((keyword) => keyword.toLowerCase().includes(needle)) ? 1 : 0
}
