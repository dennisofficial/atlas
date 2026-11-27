import type { JsonStore } from '../../storage/json-store'

export const NEW_SESSION_PROJECT_NAME = 'new-session-project.json'

const RECORD_VERSION = 1

export type NewSessionProject = {
  load: () => Promise<string | null>
  save: (projectId: string | null) => void
}

export const projectIdOf = (raw: unknown): string | null => {
  if (typeof raw !== 'object' || raw === null) return null
  const { version, projectId } = raw as { version?: unknown; projectId?: unknown }
  if (version !== RECORD_VERSION) return null
  if (typeof projectId !== 'string' || projectId.length === 0) return null
  return projectId
}

export const recordOf = (projectId: string | null): unknown =>
  projectId === null ? null : { version: RECORD_VERSION, projectId }

export const newSessionProjectOf = (store: JsonStore): NewSessionProject => {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    load: () => store.read(NEW_SESSION_PROJECT_NAME).then(projectIdOf, () => null),
    save: (projectId) => {
      tail = tail
        .then(() =>
          projectId === null
            ? store.remove(NEW_SESSION_PROJECT_NAME)
            : store.write(NEW_SESSION_PROJECT_NAME, recordOf(projectId)),
        )
        .catch(() => undefined)
    },
  }
}
