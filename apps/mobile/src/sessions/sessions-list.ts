import type { ApiClient } from '@dltech/atlas-api-router'

export interface ISessionEntry {
  id: string
  title: string
  updatedAt: string
}

export const listSessions = async ({ api }: { api: ApiClient }): Promise<ISessionEntry[]> => {
  const projects = await api.projects.list.query()
  const lists = await Promise.all(
    projects.map((project) => api.threads.list.query({ projectId: project.id, limit: 50 })),
  )
  return lists
    .flat()
    .filter((thread) => thread.parent === undefined && thread.agent === undefined)
    .map((thread) => ({
      id: thread.id,
      title: thread.title === undefined || thread.title.length === 0 ? 'Untitled' : thread.title,
      updatedAt: thread.updatedAt,
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
}
