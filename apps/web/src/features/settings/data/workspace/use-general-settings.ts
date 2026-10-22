'use client'

import { useCallback, useMemo } from 'react'
import { z } from 'zod'

import { EWorkspaceRegion } from '@dltech/atlas-wire/web'

import { ESettingsTarget, useCloudSettings } from '@/lib/cloud-settings'
import { useCloudQuery, type CloudQuery } from '@/lib/use-cloud-query'

import { combineGeneralQueries } from './general-query'
import { modelOfSetting, type GeneralDraft, type GeneralSave } from './general-mapping'
import {
  checkSlug,
  deleteOrganization,
  fetchOrganizationDetails,
  updateOrganization,
  type OrganizationDetails,
} from './organization-details'

const regionSchema = z.enum(EWorkspaceRegion)
const modelSchema = z.string()

export type GeneralSettings = {
  query: CloudQuery<{ details: OrganizationDetails; saved: GeneralDraft }>
  save: (plan: GeneralSave) => Promise<void>
  destroy: () => Promise<void>
}

export function useGeneralSettings(organizationId: string): GeneralSettings {
  const settings = useCloudSettings({ kind: ESettingsTarget.Workspace, organizationId })
  const load = useCallback(() => fetchOrganizationDetails(organizationId), [organizationId])
  const detailsQuery = useCloudQuery({ key: `org-details:${organizationId}`, load })
  const { reload: reloadDetails } = detailsQuery
  const { reload: reloadSettings } = settings.query
  const reload = useCallback(() => {
    reloadDetails()
    reloadSettings()
  }, [reloadDetails, reloadSettings])

  const query = useMemo<GeneralSettings['query']>(
    () =>
      combineGeneralQueries({
        details: detailsQuery,
        settings: settings.query,
        reload,
        build: ({ details }) => ({
          details,
          saved: {
            name: details.name,
            slug: details.slug,
            region: settings.read({ key: 'workspace.defaultRegion', schema: regionSchema }),
            model: modelOfSetting(
              settings.read({ key: 'workspace.defaultModel', schema: modelSchema }),
            ),
          },
        }),
      }),
    [detailsQuery, settings, reload],
  )

  const { save: saveSettings } = settings
  const save = useCallback(
    async (plan: GeneralSave) => {
      if (plan.organization !== null) {
        if (plan.organization.slug !== undefined) await checkSlug(plan.organization.slug)
        await updateOrganization({ organizationId, data: plan.organization })
        reloadDetails()
      }
      if (Object.keys(plan.settings).length > 0) await saveSettings(plan.settings)
    },
    [organizationId, reloadDetails, saveSettings],
  )
  const destroy = useCallback(() => deleteOrganization(organizationId), [organizationId])
  return { query, save, destroy }
}
