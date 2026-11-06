import { UNTITLED } from '@/features/threads/data/untitled'

import { mainThreadsOf, projectNameOf, type ProjectThreads } from './thread-partition'
import { threadStatusOf, type EThreadStatus } from './thread-status'
import { v2SessionHref } from './v2-rows'

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
      v2?: true
    }
  | { kind: ESearchKind.Project; id: string; label: string }

export function searchItemsOf(entries: readonly ProjectThreads[]): {
  threads: SearchItem[]
  projects: SearchItem[]
} {
  const threads: SearchItem[] = []
  const projects: SearchItem[] = []
  for (const { project, sessions } of entries) {
    if (project !== null) {
      projects.push({ kind: ESearchKind.Project, id: project.id, label: project.name })
    }
    for (const session of sessions) {
      for (const thread of mainThreadsOf([session])) {
        threads.push({
          kind: ESearchKind.Thread,
          id: thread.id,
          label: thread.title ?? UNTITLED,
          projectName: projectNameOf(project),
          status: threadStatusOf(thread),
          ...(session.v2 === true ? { v2: true as const } : {}),
        })
      }
    }
  }
  return { threads, projects }
}

export const searchHrefOf = (item: SearchItem): string =>
  item.kind === ESearchKind.Thread
    ? item.v2 === true
      ? v2SessionHref(item.id)
      : `/threads/${encodeURIComponent(item.id)}`
    : `/threads/new?project=${encodeURIComponent(item.id)}`

export const searchScoreOf = (args: { search: string; keywords: readonly string[] }): number => {
  const needle = args.search.trim().toLowerCase()
  if (needle.length === 0) return 1
  return args.keywords.some((keyword) => keyword.toLowerCase().includes(needle)) ? 1 : 0
}
