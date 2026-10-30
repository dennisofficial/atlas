'use client'

import { useCallback } from 'react'

import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import {
  fetchProjectSettings,
  saveProjectSettings,
  type ProjectSettingValues,
  type SettingChanges,
} from './project-api'

export type ProjectSettingsResource = {
  query: CloudQuery<ProjectSettingValues>
  save: (changes: SettingChanges) => Promise<void>
}

export function useProjectSettings(projectId: string): ProjectSettingsResource {
  const load = useCallback(() => fetchProjectSettings(projectId), [projectId])
  const query = useCloudQuery({ key: `project-settings:${projectId}`, load })
  const { reload } = query
  const save = useCallback(
    async (changes: SettingChanges) => {
      await saveProjectSettings({ projectId, changes })
      reload()
    },
    [projectId, reload],
  )
  return { query, save }
}
