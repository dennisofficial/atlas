import { z } from 'zod'

import { decodeSettingValue, encodeSettingValue } from '@dltech/atlas-wire/web'

import { cloudJson, cloudSend, EHttpMethod } from '@/lib/cloud-api'
import { projectBase } from '@/features/settings/data/workspace/resource-api'

export const VERCEL_PROJECT_ID_KEY = 'sandbox.vercelProjectId'

const projectSettingListSchema = z.object({
  settings: z.array(z.object({ key: z.string(), value: z.string(), updatedAt: z.string() })),
})

const settingsPath = (projectId: string) => `${projectBase(projectId)}/settings`

export async function fetchVercelProjectId(projectId: string): Promise<string> {
  const body = await cloudJson({
    method: EHttpMethod.Get,
    path: settingsPath(projectId),
    schema: projectSettingListSchema,
  })
  const entry = body.settings.find((setting) => setting.key === VERCEL_PROJECT_ID_KEY)
  if (entry === undefined) return ''
  const value = decodeSettingValue(entry.value)
  return typeof value === 'string' ? value : ''
}

export function saveVercelProjectId({
  projectId,
  value,
}: {
  projectId: string
  value: string
}): Promise<void> {
  const trimmed = value.trim()
  const values: Record<string, string | null> = {
    [VERCEL_PROJECT_ID_KEY]: trimmed === '' ? null : encodeSettingValue(trimmed),
  }
  return cloudSend({
    method: EHttpMethod.Patch,
    path: settingsPath(projectId),
    body: { values },
  })
}
