'use client'

import { useCallback } from 'react'

import type { ProjectSandbox } from '@dltech/atlas-wire/web'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { fetchSandbox, saveSandbox } from './project-api'

export type SandboxResource = {
  query: CloudQuery<ProjectSandbox>
  save: (sandbox: ProjectSandbox) => Promise<void>
}

export function useSandbox(projectId: string): SandboxResource {
  const load = useCallback(() => fetchSandbox(projectId), [projectId])
  const query = useCloudQuery({ key: `sandbox:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (sandbox: ProjectSandbox) => {
      await saveSandbox({ projectId, sandbox })
      reload()
    },
    [projectId, reload],
  )
  return { query, save }
}
