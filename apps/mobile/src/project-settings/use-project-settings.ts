import type { ApiClient } from '@dltech/atlas-api-router'
import type { Project, ProjectUpdate } from '@dltech/atlas-wire/web'
import { useCallback, useEffect, useState } from 'react'

export enum EProjectLoad {
  Loading = 'loading',
  Ready = 'ready',
  Failed = 'failed',
}

export const useProjectSettings = ({
  api,
  projectId,
}: {
  api: ApiClient | undefined
  projectId: string
}): {
  project: Project | null
  load: EProjectLoad
  retry: () => void
  save: (payload: ProjectUpdate) => Promise<void>
} => {
  const [project, setProject] = useState<Project | null>(null)
  const [load, setLoad] = useState(EProjectLoad.Loading)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (api === undefined) return undefined
    let cancelled = false
    setLoad(EProjectLoad.Loading)
    api.projects.get
      .query({ projectId })
      .then((next) => {
        if (cancelled) return
        setProject(next)
        setLoad(EProjectLoad.Ready)
      })
      .catch(() => {
        if (!cancelled) setLoad(EProjectLoad.Failed)
      })
    return () => {
      cancelled = true
    }
  }, [api, projectId, attempt])

  const retry = useCallback(() => setAttempt((current) => current + 1), [])

  const save = useCallback(
    async (payload: ProjectUpdate) => {
      if (api === undefined) throw new Error('Not signed in')
      const updated = await api.projects.update.mutate(payload)
      setProject(updated)
    },
    [api],
  )

  return { project, load, retry, save }
}
